#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
//  create-fnetro · Interactive project scaffolding CLI
//  npm create @netrojs/fnetro@latest [project-name]
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { execSync } from 'node:child_process'
import prompts from 'prompts'
import { bold, cyan, green, red, yellow, dim, magenta, blue } from 'kolorist'

// ══════════════════════════════════════════════════════════════════════════════
//  § 0  Central configuration
// ══════════════════════════════════════════════════════════════════════════════

const CFG = {
  FNETRO_PKG:         '@netrojs/fnetro',
  FNETRO_VERSION:     '^0.2.2.1',
  SOLID_VERSION:      '^1.9.11',
  HONO_VERSION:       '^4.12.8',
  VITE_VERSION:       '^8.0.1',
  VITE_SOLID_VERSION: '^2.11.11',
  TS_VERSION:         '^5.9.3',
  HONO_NODE_VERSION:  '^1.19.11',
  HONO_VDS_VERSION:   '^0.25.0',
  WRANGLER_VERSION:   '^3.0.0',
  DOCS_URL:           'https://github.com/netrosolutions/fnetro',
  DEFAULT_PORT:       3000,
  GIT_COMMIT:         'chore: initial fnetro scaffold',
} as const

// ══════════════════════════════════════════════════════════════════════════════
//  § 1  Types
// ══════════════════════════════════════════════════════════════════════════════

type Runtime  = 'node' | 'bun' | 'deno' | 'cloudflare' | 'generic'
type PkgMgr   = 'npm' | 'pnpm' | 'bun' | 'yarn' | 'deno'
type Template = 'minimal' | 'full'

interface Answers {
  projectName: string
  runtime:     Runtime
  pkgManager:  PkgMgr
  template:    Template
  gitInit:     boolean
  installDeps: boolean
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 2  Utilities
// ══════════════════════════════════════════════════════════════════════════════

function banner(): void {
  console.log()
  console.log(bold(cyan('  ⬡  create-fnetro')))
  console.log(dim('  Full-stack Hono + SolidJS — SSR · SPA · SEO · TypeScript'))
  console.log()
}

function validateName(name: string): string | true {
  if (!name.trim()) return 'Project name is required'
  if (!/^[a-z0-9@._/-]+$/i.test(name)) return 'Use only letters, numbers, -, _ and .'
  return true
}

function isDirEmpty(dir: string): boolean {
  if (!existsSync(dir)) return true
  try {
    const items = readdirSync(dir)
    return items.length === 0 || (items.length === 1 && items[0] === '.git')
  } catch { return true }
}

function write(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, 'utf-8')
}

/** Build a package sub-path string, e.g. pkg('server') → '@netrojs/fnetro/server' */
function pkg(sub?: string): string {
  return sub ? `${CFG.FNETRO_PKG}/${sub}` : CFG.FNETRO_PKG
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 3  File generators
// ══════════════════════════════════════════════════════════════════════════════

// ── app.ts ────────────────────────────────────────────────────────────────────

function genAppEntry(template: Template): string {
  const extraImports = template === 'full'
    ? `import counter from './app/routes/counter'\nimport posts from './app/routes/posts/index'\nimport postDetail from './app/routes/posts/[slug]'\n`
    : ''
  const extraRoutes = template === 'full'
    ? `, counter, posts, postDetail` : ''

  return `import { createFNetro } from '${pkg('server')}'
import { RootLayout } from './app/layouts'
import home from './app/routes/home'
import about from './app/routes/about'
import { apiRoutes } from './app/routes/api'
${extraImports}
export const fnetro = createFNetro({
  layout: RootLayout,
  seo: {
    ogType:      'website',
    twitterCard: 'summary_large_image',
  },
  routes: [apiRoutes, home, about${extraRoutes}],
})

fnetro.app.onError((err, c) => {
  console.error('[app error]', err)
  return c.json({ error: err.message }, 500)
})

// @hono/vite-dev-server expects a Hono instance as the default export.
// Do NOT export fnetro.handler here — it is a plain function, not a Hono instance.
export default fnetro.app
`
}

// ── server.ts ─────────────────────────────────────────────────────────────────

function genServerEntry(runtime: Runtime): string {
  const port = CFG.DEFAULT_PORT

  const entries: Record<Runtime, string> = {
    node: `import { serve } from '${pkg('server')}'
import { fnetro } from './app'

await serve({
  app:      fnetro,
  port:     Number(process.env['PORT'] ?? ${port}),
  runtime:  'node',
  staticDir:'./dist',
})
`,
    bun: `import { serve } from '${pkg('server')}'
import { fnetro } from './app'

await serve({
  app:     fnetro,
  port:    Number(process.env['PORT'] ?? ${port}),
  runtime: 'bun',
})
`,
    deno: `import { serve } from '${pkg('server')}'
import { fnetro } from './app'

await serve({
  app:     fnetro,
  port:    Number(Deno.env.get('PORT') ?? ${port}),
  runtime: 'deno',
})
`,
    cloudflare: `import handler from './app'

// Cloudflare Workers — platform calls fetch() directly
export default { fetch: handler }
`,
    generic: `import { fnetro } from './app'

// WinterCG-compatible — export the Hono fetch handler
export default { fetch: fnetro.handler }
export { fnetro }
`,
  }

  return entries[runtime]
}

// ── client.ts ─────────────────────────────────────────────────────────────────

function genClientEntry(template: Template): string {
  const extraImports = template === 'full'
    ? `import counter from './app/routes/counter'\nimport posts from './app/routes/posts/index'\nimport postDetail from './app/routes/posts/[slug]'\n`
    : ''
  const extraRoutes = template === 'full'
    ? `, counter, posts, postDetail` : ''

  return `import { boot, useClientMiddleware } from '${pkg('client')}'
import { RootLayout } from './app/layouts'
import home from './app/routes/home'
import about from './app/routes/about'
${extraImports}// CSS is imported here so Vite handles it in both dev (HMR) and production
// (bundled + hashed into manifest.json for server-side injection).
import './app/style.css'
// ── Client middleware ─────────────────────────────────────────────────────────
// Runs before every SPA navigation.  Must be registered before boot().
// Examples:
//
// Analytics:
// useClientMiddleware(async (url, next) => {
//   await next()
//   analytics.page({ url })
// })
//
// Auth guard:
// useClientMiddleware(async (url, next) => {
//   if (!isLoggedIn() && url.startsWith('/dashboard')) {
//     await navigate('/login?redirect=' + encodeURIComponent(url))
//     return                      // cancel original navigation
//   }
//   await next()
// })
//
// Loading bar:
// useClientMiddleware(async (url, next) => {
//   NProgress.start()
//   try   { await next() }
//   finally { NProgress.done() }
// })

boot({
  layout:          RootLayout,
  prefetchOnHover: true,
  routes:          [home, about${extraRoutes}],
})
`
}

// ── app/layouts.tsx ───────────────────────────────────────────────────────────

function genRootLayout(template: Template): string {
  const extraLinks = template === 'full'
    ? `\n          <a href="/counter" class={\`nav-link\${url === '/counter' ? ' active' : ''}\`}>Counter</a>\n          <a href="/posts" class={\`nav-link\${url.startsWith('/posts') ? ' active' : ''}\`}>Posts</a>`
    : ''

  return `import { defineLayout } from '${pkg('core')}'
import { createSignal } from 'solid-js'

const [mobileOpen, setMobileOpen] = createSignal(false)

export const RootLayout = defineLayout(function RootLayout({ children, url }) {
  return (
    <div class="app">
      <nav class="nav">
        <a href="/" class="logo">⬡ FNetro</a>
        <div class={\`nav-links \${mobileOpen() ? 'open' : ''}\`}>
          <a href="/" class={\`nav-link\${url === '/' ? ' active' : ''}\`}>Home</a>
          <a href="/about" class={\`nav-link\${url === '/about' ? ' active' : ''}\`}>About</a>${extraLinks}
        </div>
        <button class="burger" onClick={() => setMobileOpen(o => !o)} aria-label="Toggle menu">
          {mobileOpen() ? '✕' : '☰'}
        </button>
      </nav>
      <main class="main">{children}</main>
      <footer class="footer">
        Built with <a href="${CFG.DOCS_URL}" rel="external">⬡ FNetro</a>
      </footer>
    </div>
  )
})
`
}

// ── app/routes/home.tsx ───────────────────────────────────────────────────────

function genHomeRoute(): string {
  return `import { definePage } from '${pkg('core')}'

export default definePage({
  path: '/',
  seo: {
    title:       'Home — FNetro',
    description: 'Full-stack SolidJS + Hono framework with SSR, SPA, and SEO.',
    ogTitle:     'FNetro — Home',
  },
  loader: () => ({
    message:  'Hello from FNetro!',
    features: [
      '⚡ SolidJS v1.9 SSR + hydration',
      '🔒 Type-safe loaders & page props',
      '🔍 Full SEO — OG, Twitter, JSON-LD',
      '🛡️  Server & client middleware',
      '🚀 Node · Bun · Deno · Edge runtimes',
    ],
  }),
  Page({ message, features }) {
    return (
      <div class="page">
        <h1>⬡ FNetro</h1>
        <p class="lead">{message}</p>
        <ul class="feature-list">
          {features.map(f => <li key={f}>{f}</li>)}
        </ul>
        <p class="hint">
          Edit <code>app/routes/home.tsx</code> and save to see changes.
        </p>
        <a href="/about" class="btn">About →</a>
      </div>
    )
  },
})
`
}

// ── app/routes/about.tsx ──────────────────────────────────────────────────────

function genAboutRoute(): string {
  return `import { definePage } from '${pkg('core')}'

export default definePage({
  path: '/about',
  seo: {
    title:       'About — FNetro',
    description: 'Learn about the FNetro framework — SolidJS + Hono.',
  },
  loader: () => ({ version: '0.2.2.1' }),
  Page({ version }) {
    return (
      <div class="page">
        <h1>About FNetro</h1>
        <p>
          FNetro v{version} is a full-stack framework built on{' '}
          <a href="https://hono.dev" rel="external">Hono</a> and{' '}
          <a href="https://solidjs.com" rel="external">SolidJS</a>.
        </p>
        <p>
          It gives you server-side rendering, SPA navigation, fine-grained
          reactivity, automatic SEO, and middleware at every level — all in a
          tiny, TypeScript-first package.
        </p>
        <a href="/" class="btn">← Home</a>
      </div>
    )
  },
})
`
}

// ── app/routes/api.ts ─────────────────────────────────────────────────────────

function genApiRoute(): string {
  return `import { defineApiRoute } from '${pkg('core')}'

export const apiRoutes = defineApiRoute('/api', (app) => {
  // Health check
  app.get('/health', (c) =>
    c.json({ status: 'ok', ts: Date.now(), version: '0.2.2.1' }),
  )

  // Echo endpoint
  app.get('/hello', (c) => {
    const name = c.req.query('name') ?? 'world'
    return c.json({ message: \`Hello, \${name}!\` })
  })

  // Post body example
  app.post('/echo', async (c) => {
    const body = await c.req.json().catch(() => null)
    return c.json({ echo: body }, body ? 200 : 400)
  })
})
`
}

// ── app/style.css ─────────────────────────────────────────────────────────────

function genAppCss(): string {
  return `/* ── Reset ──────────────────────────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { color-scheme: dark; }
body {
  font-family: system-ui, -apple-system, sans-serif;
  background: #0d0f14;
  color: #e8eaf2;
  line-height: 1.65;
  -webkit-font-smoothing: antialiased;
}

/* ── Layout ─────────────────────────────────────────────────────────────── */
.app { display: flex; flex-direction: column; min-height: 100vh; }

/* ── Navbar ─────────────────────────────────────────────────────────────── */
.nav {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0 1.5rem;
  height: 54px;
  background: #111318;
  border-bottom: 1px solid #22263a;
  position: sticky;
  top: 0;
  z-index: 100;
}
.logo { font-weight: 700; font-size: 1.05rem; color: #e8eaf2; text-decoration: none; }
.nav-links { display: flex; gap: 2px; flex: 1; }
.nav-link {
  padding: .35rem .7rem;
  border-radius: 6px;
  color: #7b829a;
  text-decoration: none;
  font-size: .9rem;
  transition: color .15s, background .15s;
}
.nav-link:hover { color: #e8eaf2; background: #1a1e2a; }
.nav-link.active { color: #e8eaf2; background: #1e2235; }
.burger {
  display: none;
  background: none;
  border: 1px solid #22263a;
  color: #e8eaf2;
  font-size: 1rem;
  padding: .3rem .5rem;
  border-radius: 6px;
  cursor: pointer;
}

/* ── Main ───────────────────────────────────────────────────────────────── */
.main {
  flex: 1;
  max-width: 840px;
  width: 100%;
  margin: 0 auto;
  padding: 3rem 1.5rem;
}

/* ── Footer ─────────────────────────────────────────────────────────────── */
.footer {
  text-align: center;
  padding: 1rem;
  color: #555972;
  font-size: .82rem;
  border-top: 1px solid #22263a;
}
.footer a { color: #6b8cff; text-decoration: none; }
.footer a:hover { text-decoration: underline; }

/* ── Page typography ─────────────────────────────────────────────────────── */
.page h1 { font-size: 2.2rem; font-weight: 700; margin-bottom: .75rem; letter-spacing: -.02em; }
.page .lead { font-size: 1.1rem; color: #9da3b8; margin-bottom: 1.5rem; }
.page p { margin-bottom: .75rem; color: #b0b6cc; }
.page a { color: #6b8cff; }
.page a:hover { text-decoration: underline; }

/* ── Feature list ────────────────────────────────────────────────────────── */
.feature-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: .4rem;
  margin-bottom: 1.75rem;
}
.feature-list li { color: #9da3b8; font-size: .95rem; }

/* ── Button ─────────────────────────────────────────────────────────────── */
.btn {
  display: inline-block;
  padding: .5rem 1.1rem;
  border-radius: 8px;
  background: #1e2235;
  color: #e8eaf2;
  text-decoration: none;
  font-size: .9rem;
  border: 1px solid #2a2f3d;
  transition: background .15s, border-color .15s;
}
.btn:hover { background: #252a3e; border-color: #3a405a; }

/* ── Hint ────────────────────────────────────────────────────────────────── */
.hint { font-size: .88rem; color: #555972; margin-bottom: 1.25rem; }

code {
  background: #181b26;
  color: #9da3b8;
  padding: .15rem .4rem;
  border-radius: 4px;
  font-family: ui-monospace, 'Cascadia Code', monospace;
  font-size: .85em;
  border: 1px solid #22263a;
}

/* ── Mobile ──────────────────────────────────────────────────────────────── */
@media (max-width: 600px) {
  .nav-links { display: none; }
  .nav-links.open {
    display: flex;
    flex-direction: column;
    position: fixed;
    top: 54px;
    left: 0;
    right: 0;
    background: #111318;
    padding: .5rem 1rem 1rem;
    border-bottom: 1px solid #22263a;
  }
  .burger { display: block; margin-left: auto; }
}
`
}

// ── vite.config.ts ────────────────────────────────────────────────────────────

function genViteConfig(runtime: Runtime): string {
  const adapterImports: Record<Runtime, string> = {
    node:       `import devServer from '@hono/vite-dev-server'`,
    bun:        `import devServer from '@hono/vite-dev-server'\nimport bunAdapter from '@hono/vite-dev-server/bun'`,
    deno:       `import devServer from '@hono/vite-dev-server'\nimport denoAdapter from '@hono/vite-dev-server/deno'`,
    cloudflare: ``,
    generic:    `import devServer from '@hono/vite-dev-server'`,
  }

  const devPlugins: Record<Runtime, string> = {
    node:       `    // Dev: @hono/vite-dev-server routes requests through the FNetro app.\n    //      app.ts default export must be a Hono *instance* (fnetro.app), NOT fnetro.handler.\n    devServer({ entry: 'app.ts' }),`,
    bun:        `    devServer({ adapter: bunAdapter, entry: 'app.ts' }),`,
    deno:       `    devServer({ adapter: denoAdapter, entry: 'app.ts' }),`,
    cloudflare: `    // Use 'wrangler dev' for local development with Cloudflare Workers.`,
    generic:    `    devServer({ entry: 'app.ts' }),`,
  }

  return `import { defineConfig } from 'vite'
import { fnetroVitePlugin } from '${pkg('vite')}'
${adapterImports[runtime] ? adapterImports[runtime] + '\n' : ''}
export default defineConfig({
  plugins: [
    // fnetroVitePlugin:
    //  - Applies vite-plugin-solid (SSR-aware JSX transform)
    //  - 'vite build' → server bundle (dist/server/server.js) then
    //                    client bundle (dist/assets/client-[hash].js + manifest.json)
    fnetroVitePlugin({
      serverEntry:  'server.ts',
      clientEntry:  'client.ts',
      serverOutDir: 'dist/server',
      clientOutDir: 'dist/assets',
    }),
${devPlugins[runtime]}
  ],
  server: {
    watch: {
      // Don't watch the build output — Vite manages it
      ignored: ['**/dist/**'],
    },
  },
})
`
}

// ── package.json ──────────────────────────────────────────────────────────────

function genPackageJson(name: string, runtime: Runtime): string {
  const devCmds: Record<Runtime, string> = {
    node:       'vite',
    bun:        'bun --bun vite --host',
    deno:       'deno run -A npm:vite',
    cloudflare: 'wrangler dev',
    generic:    'vite',
  }
  const buildCmds: Record<Runtime, string> = {
    node:       'vite build',
    bun:        'bun --bun vite build',
    deno:       'deno run -A npm:vite build',
    cloudflare: 'vite build',
    generic:    'vite build',
  }
  const startCmds: Partial<Record<Runtime, string>> = {
    node:    'node dist/server/server.js',
    bun:     'bun dist/server/server.js',
    deno:    'deno run -A dist/server/server.js',
    generic: 'node dist/server/server.js',
  }

  const scripts: Record<string, string> = {
    dev:       devCmds[runtime],
    build:     buildCmds[runtime],
    typecheck: 'tsc --noEmit',
    ...(startCmds[runtime] ? { start: startCmds[runtime]! } : {}),
    ...(runtime === 'cloudflare' ? { deploy: 'wrangler deploy' } : {}),
  }

  const deps: Record<string, string> = {
    [CFG.FNETRO_PKG]: CFG.FNETRO_VERSION,
    'solid-js':        CFG.SOLID_VERSION,
    hono:              CFG.HONO_VERSION,
  }

  const devDeps: Record<string, string> = {
    vite:                    CFG.VITE_VERSION,
    'vite-plugin-solid':     CFG.VITE_SOLID_VERSION,
    typescript:              CFG.TS_VERSION,
    '@hono/vite-dev-server': CFG.HONO_VDS_VERSION,
  }

  if (runtime === 'node')       devDeps['@hono/node-server'] = CFG.HONO_NODE_VERSION
  if (runtime === 'bun')        devDeps['@types/bun']        = 'latest'
  if (runtime === 'cloudflare') devDeps['wrangler']          = CFG.WRANGLER_VERSION

  return JSON.stringify(
    { name, version: '0.0.1', type: 'module', private: true, scripts, dependencies: deps, devDependencies: devDeps },
    null, 2,
  ) + '\n'
}

// ── tsconfig.json ─────────────────────────────────────────────────────────────

function genTsConfig(): string {
  return JSON.stringify({
    compilerOptions: {
      target:                     'ESNext',
      module:                     'ESNext',
      moduleResolution:           'bundler',
      lib:                        ['ESNext', 'DOM'],
      jsx:                        'preserve',
      jsxImportSource:            'solid-js',
      strict:                     true,
      skipLibCheck:               true,
      noEmit:                     true,
      allowImportingTsExtensions: true,
      resolveJsonModule:          true,
      isolatedModules:            true,
      verbatimModuleSyntax:       true,
      forceConsistentCasingInFileNames: true,
    },
    include: ['**/*.ts', '**/*.tsx'],
    exclude: ['node_modules', 'dist'],
  }, null, 2) + '\n'
}

// ── .gitignore ────────────────────────────────────────────────────────────────

function genGitignore(): string {
  return [
    'node_modules', 'dist', '.env', '.env.local',
    '*.local', '.DS_Store', 'Thumbs.db', '.wrangler', '',
  ].join('\n')
}

// ── .env.example ──────────────────────────────────────────────────────────────

function genEnvExample(runtime: Runtime): string {
  const lines = [
    '# Copy to .env and fill in values',
    `PORT=${CFG.DEFAULT_PORT}`,
    'NODE_ENV=development',
  ]
  if (runtime === 'cloudflare') lines.push('# Use wrangler.toml for Cloudflare config')
  return lines.join('\n') + '\n'
}

// ── deno.json ─────────────────────────────────────────────────────────────────

function genDenoJson(name: string): string {
  return JSON.stringify({
    name,
    version: '0.0.1',
    tasks: {
      dev:   'vite',
      build: 'vite build',
      start: 'deno run -A dist/server/server.js',
    },
    imports: {
      [CFG.FNETRO_PKG]: `npm:${CFG.FNETRO_PKG}@${CFG.FNETRO_VERSION}`,
      'solid-js':         `npm:solid-js@${CFG.SOLID_VERSION}`,
      hono:               `npm:hono@${CFG.HONO_VERSION}`,
    },
  }, null, 2) + '\n'
}

// ── wrangler.toml ─────────────────────────────────────────────────────────────

function genWranglerToml(name: string): string {
  return `name = "${name.replace(/[^a-z0-9-]/g, '-')}"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]
main = "dist/server/server.js"

[build]
command = "npm run build"

[[rules]]
type = "ESModule"
globs = ["**/*.js"]
`
}

// ── README.md ─────────────────────────────────────────────────────────────────

function genReadme(a: Answers): string {
  const pm = a.pkgManager
  const cmds: Record<PkgMgr, { install: string; dev: string; build: string; start: string }> = {
    npm:  { install: 'npm install',  dev: 'npm run dev',   build: 'npm run build',  start: 'npm start' },
    pnpm: { install: 'pnpm install', dev: 'pnpm dev',      build: 'pnpm build',     start: 'pnpm start' },
    bun:  { install: 'bun install',  dev: 'bun run dev',   build: 'bun run build',  start: 'bun start' },
    yarn: { install: 'yarn',         dev: 'yarn dev',      build: 'yarn build',     start: 'yarn start' },
    deno: { install: 'deno install', dev: 'deno task dev', build: 'deno task build',start: 'deno task start' },
  }
  const { install, dev, build, start } = cmds[pm]

  return `# ${a.projectName}

A [FNetro](${CFG.DOCS_URL}) project — SolidJS SSR + SPA + SEO on [Hono](https://hono.dev).

## Development

\`\`\`bash
${install}
${dev}
\`\`\`

The dev server uses \`@hono/vite-dev-server\` — no build step needed. Edit files and see changes instantly.

## Production

\`\`\`bash
${build}
${start}
\`\`\`

## Project structure

\`\`\`
app.ts              # Shared app — used by dev server + server.ts
server.ts           # Production entry — calls serve()
client.ts           # Browser entry — calls boot()
app/
  layouts.tsx       # Root layout (nav, footer)
  style.css         # Global styles (imported by client.ts, processed by Vite)
  routes/
    home.tsx        # GET /
    about.tsx       # GET /about
    api.ts          # GET /api/health, /api/hello
public/
  favicon.ico       # Static assets served as-is (favicon, robots.txt, etc.)
vite.config.ts
tsconfig.json
\`\`\`

## Key APIs

| API | Description |
|---|---|
| \`definePage({ path, loader, seo, Page })\` | Route + SSR data + SEO + component |
| \`defineGroup({ prefix, middleware, routes })\` | Group routes under a prefix |
| \`defineLayout(Component)\` | Shared layout (nav, footer) |
| \`defineApiRoute(path, fn)\` | Raw Hono routes |
| \`useClientMiddleware(fn)\` | Client navigation hooks |
| \`createSignal\` / \`createMemo\` | SolidJS reactive primitives |

## Runtime

**${a.runtime}** — see \`server.ts\` for the configuration.

## Docs

${CFG.DOCS_URL}
`
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 4  Full template — extra files
// ══════════════════════════════════════════════════════════════════════════════

function genStore(): string {
  return `// app/store.ts — module-level shared state (persists across SPA navigations)
import { createSignal, createMemo } from 'solid-js'
import { createStore, produce } from 'solid-js/store'

// ── Theme ──────────────────────────────────────────────────────────────────
export const [theme, setTheme] = createSignal<'dark' | 'light'>('dark')
export const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark')

// ── Cart ───────────────────────────────────────────────────────────────────
export interface CartItem { id: string; name: string; qty: number; price: number }

export const [cart, setCart] = createStore<{ items: CartItem[] }>({ items: [] })
export const cartCount = createMemo(() => cart.items.reduce((s, i) => s + i.qty, 0))
export const cartTotal = createMemo(() => cart.items.reduce((s, i) => s + i.qty * i.price, 0))

export function addToCart(item: Omit<CartItem, 'qty'>): void {
  const idx = cart.items.findIndex(i => i.id === item.id)
  if (idx >= 0) setCart('items', idx, produce(i => { i.qty++ }))
  else          setCart('items', l => [...l, { ...item, qty: 1 }])
}

export function removeFromCart(id: string): void {
  setCart('items', items => items.filter(i => i.id !== id))
}

export function clearCart(): void {
  setCart('items', [])
}
`
}

function genCounterRoute(): string {
  return `import { definePage } from '${pkg('core')}'
import { createSignal, createMemo } from 'solid-js'

// Module-level — persists across SPA navigations
const [count, setCount] = createSignal(0)
const doubled  = createMemo(() => count() * 2)
const isEven   = createMemo(() => count() % 2 === 0)

export default definePage({
  path: '/counter',
  seo: { title: 'Counter — FNetro', description: 'SolidJS signals demo.' },
  Page() {
    return (
      <div class="page">
        <h1>Counter</h1>
        <p class="lead">
          Count: <strong>{count()}</strong> — Doubled: <strong>{doubled()}</strong>
        </p>
        <p>The number is {isEven() ? 'even' : 'odd'}.</p>
        <div style={{ display: 'flex', gap: '.5rem', 'margin-top': '1.5rem' }}>
          <button class="btn" onClick={() => setCount(n => n - 1)}>−</button>
          <button class="btn" onClick={() => setCount(n => n + 1)}>+</button>
          <button class="btn" onClick={() => setCount(0)}>Reset</button>
        </div>
        <p class="hint" style={{ 'margin-top': '1.25rem' }}>
          Navigate away and back — the count persists (module-level signal).
        </p>
      </div>
    )
  },
})
`
}

function genPostsIndexRoute(): string {
  return `import { definePage } from '${pkg('core')}'
import { For } from 'solid-js'

interface PostSummary { slug: string; title: string; date: string; excerpt: string }

const POSTS: PostSummary[] = [
  { slug: 'hello-fnetro',   title: 'Hello FNetro',      date: '2025-01-01', excerpt: 'Getting started with the FNetro framework.' },
  { slug: 'solidjs-primer', title: 'SolidJS Primer',    date: '2025-01-08', excerpt: 'Fine-grained reactivity without a virtual DOM.' },
  { slug: 'seo-tips',       title: 'SEO with FNetro',   date: '2025-01-15', excerpt: 'Automatic OG, Twitter cards, and JSON-LD.' },
]

export default definePage({
  path: '/posts',
  seo: {
    title:       'Posts — FNetro',
    description: 'Articles about FNetro, SolidJS, and full-stack development.',
  },
  loader: async (): Promise<{ posts: PostSummary[] }> => ({ posts: POSTS }),
  Page({ posts }) {
    return (
      <div class="page">
        <h1>Posts</h1>
        <ul class="post-list" style={{ 'list-style': 'none', 'margin-top': '1.5rem' }}>
          <For each={posts}>
            {post => (
              <li style={{ 'margin-bottom': '1.5rem' }}>
                <a href={\`/posts/\${post.slug}\`} style={{ 'font-size': '1.1rem', 'font-weight': '600' }}>
                  {post.title}
                </a>
                <p style={{ color: '#555972', 'font-size': '.82rem', margin: '.15rem 0 .35rem' }}>
                  {post.date}
                </p>
                <p style={{ color: '#9da3b8', 'font-size': '.92rem' }}>{post.excerpt}</p>
              </li>
            )}
          </For>
        </ul>
      </div>
    )
  },
})
`
}

function genPostDetailRoute(): string {
  return `import { definePage } from '${pkg('core')}'
import { Show } from 'solid-js'

interface Post { title: string; body: string; date: string; author: string }

const POSTS: Record<string, Post> = {
  'hello-fnetro': {
    title:  'Hello FNetro',
    date:   '2025-01-01',
    author: 'Netro Team',
    body:   'FNetro is a full-stack framework built on Hono and SolidJS. It provides SSR, SPA navigation, automatic SEO, and middleware at every level — all in a tiny, TypeScript-first package.',
  },
  'solidjs-primer': {
    title:  'SolidJS Primer',
    date:   '2025-01-08',
    author: 'Netro Team',
    body:   'SolidJS achieves fine-grained reactivity by compiling JSX to direct DOM updates. Unlike React, there is no virtual DOM and no reconciliation. Signals update only the exact DOM nodes that depend on them.',
  },
  'seo-tips': {
    title:  'SEO with FNetro',
    date:   '2025-01-15',
    author: 'Netro Team',
    body:   'Every FNetro page can declare a seo property with title, description, Open Graph, Twitter cards, and JSON-LD structured data. On SPA navigation, all meta tags update automatically.',
  },
}

export default definePage<{ post: Post | null; slug: string }>({
  path: '/posts/[slug]',
  seo: (data, params) => ({
    title:       data.post ? \`\${data.post.title} — FNetro\` : 'Post not found',
    description: data.post?.body.slice(0, 160),
    ogType:      'article',
  }),
  loader: (c): { post: Post | null; slug: string } => {
    const slug = (c.req as any).param('slug') as string
    return { post: POSTS[slug] ?? null, slug }
  },
  Page({ post, slug }) {
    return (
      <Show
        when={post}
        fallback={
          <div class="page">
            <h1>Post not found</h1>
            <p>No post with slug <code>{slug}</code> exists.</p>
            <a href="/posts" class="btn">← All posts</a>
          </div>
        }
      >
        {(p) => (
          <article class="page">
            <a href="/posts" class="btn" style={{ 'margin-bottom': '1.5rem', display: 'inline-block' }}>← Posts</a>
            <h1>{p().title}</h1>
            <p style={{ color: '#555972', 'font-size': '.85rem', margin: '.4rem 0 1.25rem' }}>
              {p().date} · {p().author}
            </p>
            <p style={{ 'line-height': '1.8', color: '#b0b6cc' }}>{p().body}</p>
          </article>
        )}
      </Show>
    )
  },
})
`
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 5  Scaffold — assemble all files
// ══════════════════════════════════════════════════════════════════════════════

function scaffold(dir: string, a: Answers): void {
  const { runtime, template } = a

  // Create directories
  mkdirSync(join(dir, 'app/routes'), { recursive: true })
  mkdirSync(join(dir, 'app/components'), { recursive: true })
  mkdirSync(join(dir, 'public'), { recursive: true })

  // Root config files
  write(join(dir, 'package.json'),   genPackageJson(a.projectName, runtime))
  write(join(dir, 'tsconfig.json'),  genTsConfig())
  write(join(dir, 'vite.config.ts'), genViteConfig(runtime))
  write(join(dir, '.gitignore'),     genGitignore())
  write(join(dir, '.env.example'),   genEnvExample(runtime))

  // Runtime-specific extras
  if (runtime === 'deno')       write(join(dir, 'deno.json'),     genDenoJson(a.projectName))
  if (runtime === 'cloudflare') write(join(dir, 'wrangler.toml'), genWranglerToml(a.projectName))

  // Entry points
  write(join(dir, 'app.ts'),    genAppEntry(template))
  write(join(dir, 'server.ts'), genServerEntry(runtime))
  write(join(dir, 'client.ts'), genClientEntry(template))

  // App files (minimal)
  write(join(dir, 'app/layouts.tsx'),      genRootLayout(template))
  write(join(dir, 'app/routes/home.tsx'),  genHomeRoute())
  write(join(dir, 'app/routes/about.tsx'), genAboutRoute())
  write(join(dir, 'app/routes/api.ts'),    genApiRoute())
  write(join(dir, 'app/style.css'),      genAppCss())

  // Full template extras
  if (template === 'full') {
    write(join(dir, 'app/store.ts'),                       genStore())
    write(join(dir, 'app/routes/counter.tsx'),             genCounterRoute())
    write(join(dir, 'app/routes/posts/index.tsx'),         genPostsIndexRoute())
    write(join(dir, 'app/routes/posts/[slug].tsx'),        genPostDetailRoute())
  }

  write(join(dir, 'README.md'), genReadme(a))
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 6  Install / git helpers
// ══════════════════════════════════════════════════════════════════════════════

const INSTALL: Record<PkgMgr, string> = {
  npm: 'npm install', pnpm: 'pnpm install', bun: 'bun install', yarn: 'yarn', deno: 'deno install',
}
const DEV: Record<PkgMgr, string> = {
  npm: 'npm run dev', pnpm: 'pnpm dev', bun: 'bun run dev', yarn: 'yarn dev', deno: 'deno task dev',
}
const BUILD: Record<PkgMgr, string> = {
  npm: 'npm run build', pnpm: 'pnpm build', bun: 'bun run build', yarn: 'yarn build', deno: 'deno task build',
}
const START: Record<PkgMgr, string> = {
  npm: 'npm start', pnpm: 'pnpm start', bun: 'bun start', yarn: 'yarn start', deno: 'deno task start',
}

function runInstall(mgr: PkgMgr, dir: string): void {
  execSync(INSTALL[mgr], { cwd: dir, stdio: 'inherit' })
}

function runGitInit(dir: string): void {
  execSync('git init',                              { cwd: dir, stdio: 'inherit' })
  execSync('git add -A',                            { cwd: dir, stdio: 'inherit' })
  execSync(`git commit -m "${CFG.GIT_COMMIT}"`,     { cwd: dir, stdio: 'inherit' })
}

function printNextSteps(name: string, a: Answers): void {
  const inCwd = name === '.'
  const lines = [
    '',
    '  ' + green('Next steps:'),
    ...(inCwd ? [] : [`    ${cyan('cd')} ${name}`]),
    ...(a.installDeps ? [] : [`    ${cyan(INSTALL[a.pkgManager])}`]),
    `    ${cyan(DEV[a.pkgManager])}  ${dim('← starts dev server (no build needed)')}`,
    '',
    `  ${dim('Production:')}`,
    `    ${cyan(BUILD[a.pkgManager])} ${dim('&&')} ${cyan(START[a.pkgManager])}`,
    '',
    `  ${dim('Docs:')} ${cyan(CFG.DOCS_URL)}`,
    '',
  ]
  console.log(lines.join('\n'))
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 7  CLI flags
// ══════════════════════════════════════════════════════════════════════════════

interface CliFlags {
  ci:         boolean
  runtime:    Runtime  | undefined
  template:   Template | undefined
  pkgManager: PkgMgr   | undefined
  noInstall:  boolean
  noGit:      boolean
}

function parseFlags(argv: string[]): CliFlags {
  const get = (f: string) => { const i = argv.indexOf(f); return i !== -1 ? argv[i + 1] : undefined }
  const has = (f: string) => argv.includes(f)
  const RUNTIMES:  Runtime[]  = ['node', 'bun', 'deno', 'cloudflare', 'generic']
  const TEMPLATES: Template[] = ['minimal', 'full']
  const MANAGERS:  PkgMgr[]   = ['npm', 'pnpm', 'yarn', 'bun', 'deno']
  const r  = get('--runtime')    as Runtime  | undefined
  const t  = get('--template')   as Template | undefined
  const pm = (get('--pkg-manager') ?? get('--pkgManager')) as PkgMgr | undefined
  return {
    ci:         has('--ci') || process.env['CI'] === 'true',
    runtime:    r  && RUNTIMES.includes(r)   ? r  : undefined,
    template:   t  && TEMPLATES.includes(t)  ? t  : undefined,
    pkgManager: pm && MANAGERS.includes(pm)  ? pm : undefined,
    noInstall:  has('--no-install'),
    noGit:      has('--no-git'),
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 8  Main
// ══════════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  banner()

  const argv    = process.argv.slice(2)
  const argName = argv.find(a => !a.startsWith('-'))
  const flags   = parseFlags(argv)

  // ── CI / non-interactive ───────────────────────────────────────────────────
  if (flags.ci) {
    const name = argName ?? 'my-fnetro-app'
    const a: Answers = {
      projectName: name,
      runtime:     flags.runtime    ?? 'node',
      template:    flags.template   ?? 'minimal',
      pkgManager:  flags.pkgManager ?? 'npm',
      installDeps: !flags.noInstall,
      gitInit:     !flags.noGit,
    }
    const dir = resolve(process.cwd(), name)
    mkdirSync(dir, { recursive: true })
    console.log(`  Scaffolding ${bold(cyan(name))} [CI]…\n`)
    scaffold(dir, a)
    if (a.installDeps) {
      try   { runInstall(a.pkgManager, dir) }
      catch { console.log(yellow('\n  Install failed — run it manually.\n')) }
    }
    if (a.gitInit) { try { runGitInit(dir) } catch { /* git not available */ } }
    console.log(green('  Done! 🎉'))
    printNextSteps(name, a)
    return
  }

  // ── Interactive ────────────────────────────────────────────────────────────
  let cancelled = false

  const answers = await prompts(
    [
      {
        type:     'text',
        name:     'projectName',
        message:  'Project name:',
        initial:  argName ?? 'my-fnetro-app',
        validate: validateName,
      },
      {
        type: (prev: string) => {
          const d = resolve(process.cwd(), prev)
          return existsSync(d) && !isDirEmpty(d) ? 'confirm' : (null as unknown as 'confirm')
        },
        name:    'overwrite',
        message: (prev: string) => `${yellow('!')} "${prev}" is not empty. Overwrite?`,
        initial: false,
      },
      {
        type: (_: unknown, v: Partial<Answers & { overwrite: boolean }>) => {
          if (v.overwrite === false) cancelled = true
          return null as unknown as 'text'
        },
        name: '_guard', message: '',
      },
      {
        type:    'select',
        name:    'runtime',
        message: 'Target runtime:',
        choices: [
          { title: `${green('Node.js')}            ${dim('@hono/node-server')}`,         value: 'node' },
          { title: `${magenta('Bun')}              ${dim('Bun.serve — fast startup')}`,  value: 'bun' },
          { title: `${blue('Deno')}             ${dim('Deno.serve — permissions')}`,     value: 'deno' },
          { title: `${yellow('Cloudflare Workers')} ${dim('edge — wrangler')}`,           value: 'cloudflare' },
          { title: `${dim('Generic WinterCG')}    ${dim('export handler')}`,             value: 'generic' },
        ],
      },
      {
        type:    'select',
        name:    'template',
        message: 'Template:',
        choices: [
          { title: `${green('Minimal')}  ${dim('Home · About · /api/health')}`,                         value: 'minimal' },
          { title: `${cyan('Full')}     ${dim('+ Counter (signals) · Posts [slug] · store.ts')}`,       value: 'full' },
        ],
      },
      {
        type:    'select',
        name:    'pkgManager',
        message: 'Package manager:',
        choices: (_: unknown, v: Partial<Answers>) => {
          const base = [
            { title: 'npm',  value: 'npm' },
            { title: 'pnpm', value: 'pnpm' },
            { title: 'yarn', value: 'yarn' },
          ]
          if (v.runtime === 'bun')  return [{ title: 'bun',  value: 'bun' },  ...base]
          if (v.runtime === 'deno') return [{ title: 'deno', value: 'deno' }, ...base]
          return base
        },
      },
      {
        type:    'confirm',
        name:    'installDeps',
        message: 'Install dependencies now?',
        initial: true,
      },
      {
        type:    'confirm',
        name:    'gitInit',
        message: 'Initialize a git repository?',
        initial: true,
      },
    ],
    { onCancel(): void { cancelled = true } },
  )

  if (cancelled) {
    console.log(red('\nCancelled.\n'))
    process.exit(1)
  }

  const a   = answers as Answers
  const dir = resolve(process.cwd(), a.projectName)
  mkdirSync(dir, { recursive: true })

  console.log()
  console.log(`  Scaffolding ${bold(cyan(a.projectName))}…`)
  console.log()

  scaffold(dir, a)

  if (a.installDeps) {
    console.log(`  Installing with ${bold(a.pkgManager)}…\n`)
    try   { runInstall(a.pkgManager, dir) }
    catch { console.log(yellow('\n  Install failed — run it manually.\n')) }
  }

  if (a.gitInit) { try { runGitInit(dir) } catch { /* git not available */ } }

  console.log()
  console.log(`  ${green('Done!')} 🎉`)
  printNextSteps(a.projectName, a)
}

main().catch((e: unknown) => {
  console.error(red(`\n  Error: ${e instanceof Error ? e.message : String(e)}\n`))
  process.exit(1)
})
