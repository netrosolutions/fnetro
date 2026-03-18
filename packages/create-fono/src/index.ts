#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
//  create-fono · Interactive project scaffolding CLI
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execSync } from 'node:child_process'
import prompts from 'prompts'
import { bold, cyan, green, red, yellow, dim, magenta } from 'kolorist'

// ══════════════════════════════════════════════════════════════════════════════
//  § 0  Top-level configuration — edit here when versions or names change
// ══════════════════════════════════════════════════════════════════════════════

const CFG = {
  /** npm package name for the framework */
  FONO_PKG: '@mdakashdeveloper/fono',

  /** Scaffolded app's default fono dependency version */
  FONO_VERSION: '^0.1.1',

  /** Hono peer dep version used in scaffolded apps */
  HONO_VERSION: '^4.12.8',

  /** Vite version used in scaffolded apps */
  VITE_VERSION: '^8.0.0',

  /** TypeScript version used in scaffolded apps */
  TS_VERSION: '^5.9.3',

  /** @hono/node-server version for Node runtime */
  HONO_NODE_VERSION: '^1.19.11',

  /** Wrangler version for Cloudflare runtime */
  WRANGLER_VERSION: '^3.0.0',

  /** Docs / repo URL shown in CLI output and generated READMEs */
  DOCS_URL: 'https://github.com/mdakashdeveloper/fono',

  /** Default port written into generated server entries */
  DEFAULT_PORT: 3000,

  /** Git commit message used when --git-init is chosen */
  GIT_INIT_COMMIT: 'chore: initial fono scaffold',
} as const

// ══════════════════════════════════════════════════════════════════════════════
//  § 1  Types
// ══════════════════════════════════════════════════════════════════════════════

type Runtime  = 'node' | 'bun' | 'deno' | 'cloudflare' | 'generic'
type PkgMgr   = 'npm' | 'pnpm' | 'bun' | 'yarn' | 'deno'
type Template = 'minimal' | 'full'

interface Answers {
  projectName: string
  runtime: Runtime
  pkgManager: PkgMgr
  template: Template
  gitInit: boolean
  installDeps: boolean
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 2  Utilities
// ══════════════════════════════════════════════════════════════════════════════

function banner(): void {
  console.log()
  console.log(bold(cyan('  ⬡  Fono')))
  console.log(dim('  Full-stack Hono framework — SSR + SPA + Reactivity'))
  console.log()
}

function validateName(name: string): string | true {
  if (!name.trim()) return 'Project name is required'
  if (!/^[a-z0-9@._/-]+$/i.test(name)) return 'Invalid project name'
  return true
}

function isDirEmpty(dir: string): boolean {
  if (!existsSync(dir)) return true
  let items: string[] = []
  try { items = readdirSync(dir) } catch { return true }
  return items.length === 0 || (items.length === 1 && items[0] === '.git')
}

/** Write a file, creating all parent directories as needed. */
function writeFile(filePath: string, content: string): void {
  const dir = filePath.substring(0, filePath.lastIndexOf('/'))
  if (dir) mkdirSync(dir, { recursive: true })
  writeFileSync(filePath, content, 'utf-8')
}

/** Build a package sub-path: pkg('server') → '@mdakashdeveloper/fono/server' */
function pkg(subpath?: string): string {
  return subpath ? `${CFG.FONO_PKG}/${subpath}` : CFG.FONO_PKG
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 3  Template generators — TypeScript source strings
// ══════════════════════════════════════════════════════════════════════════════

function genServerEntry(runtime: Runtime): string {
  const port = CFG.DEFAULT_PORT

  const shared = `import { createFono } from '${pkg('server')}'
import { RootLayout } from './app/layouts'
import home from './app/routes/home'
import about from './app/routes/about'
import { apiRoutes } from './app/routes/api'

const fono = createFono({
  layout: RootLayout,
  routes: [apiRoutes, home, about],
})

fono.app.onError((err, c) => {
  console.error(err)
  return c.json({ error: err.message }, 500)
})`

  const serveLines: Record<Runtime, string> = {
    node:       `\nimport { serve } from '${pkg('server')}'\nawait serve({ app: fono, port: ${port} })\n`,
    bun:        `\nimport { serve } from '${pkg('server')}'\nawait serve({ app: fono, port: ${port}, runtime: 'bun' })\n`,
    deno:       `\nimport { serve } from '${pkg('server')}'\nawait serve({ app: fono, port: ${port}, runtime: 'deno' })\n`,
    cloudflare: `\n// Cloudflare Workers — export the fetch handler\nexport default { fetch: fono.handler }\n`,
    generic:    `\n// WinterCG-compatible — export the fetch handler\nexport default { fetch: fono.handler }\nexport const handler = fono.handler\n`,
  }

  return shared + serveLines[runtime]
}

function genClientEntry(): string {
  return `import { boot } from '${pkg('client')}'
import { RootLayout } from './app/layouts'
import home from './app/routes/home'
import about from './app/routes/about'

boot({
  layout: RootLayout,
  prefetchOnHover: true,
  routes: [home, about],
})
`
}

function genRootLayout(): string {
  return `import { defineLayout, use, ref } from '${pkg('core')}'

const menuOpen = ref(false)

export const RootLayout = defineLayout(function Layout({ children, url }) {
  const open = use(menuOpen)

  return (
    <div class="app">
      <nav class="nav">
        <a class="logo" href="/">⬡ Fono</a>
        <div class={\`nav-links \${open ? 'open' : ''}\`}>
          <a href="/" class={\`nav-link\${url === '/' ? ' active' : ''}\`}>Home</a>
          <a href="/about" class={\`nav-link\${url === '/about' ? ' active' : ''}\`}>About</a>
        </div>
        <button class="burger" onClick={() => { menuOpen.value = !open }}>
          {open ? '✕' : '☰'}
        </button>
      </nav>
      <main class="main">{children}</main>
      <footer class="footer">Built with ⬡ Fono</footer>
    </div>
  )
})
`
}

function genHomeRoute(): string {
  return `import { definePage } from '${pkg('core')}'

export default definePage({
  path: '/',
  loader: () => ({ message: 'Hello from Fono!' }),
  Page({ message }) {
    return (
      <div class="page">
        <h1>⬡ Fono</h1>
        <p>{message}</p>
        <p>
          Edit <code>app/routes/home.tsx</code> and save to see changes.
        </p>
        <a href="/about">About →</a>
      </div>
    )
  },
})
`
}

function genAboutRoute(): string {
  return `import { definePage } from '${pkg('core')}'

export default definePage({
  path: '/about',
  loader: () => ({ version: '0.1.0' }),
  Page({ version }) {
    return (
      <div class="page">
        <h1>About</h1>
        <p>Fono v{version} — SSR + SPA + Vue-like reactivity on Hono.</p>
        <a href="/">← Home</a>
      </div>
    )
  },
})
`
}

function genApiRoute(): string {
  return `import { defineApiRoute } from '${pkg('core')}'

export const apiRoutes = defineApiRoute('/api', (app) => {
  app.get('/health', (c) => c.json({ status: 'ok', ts: Date.now() }))

  app.get('/hello', (c) => {
    const name = c.req.query('name') ?? 'world'
    return c.json({ message: \`Hello, \${name}!\` })
  })
})
`
}

function genAppCss(): string {
  return `*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, sans-serif; background: #0d0f14; color: #e8eaf2; line-height: 1.6; }
.app { display: flex; flex-direction: column; min-height: 100vh; }
.nav { display: flex; align-items: center; gap: 1rem; padding: 0 1.5rem; height: 52px; background: #151820; border-bottom: 1px solid #2a2f3d; }
.logo { font-weight: 700; color: #e8eaf2; text-decoration: none; }
.nav-links { display: flex; gap: .25rem; flex: 1; }
.nav-link { padding: .35rem .75rem; border-radius: 6px; color: #7b829a; text-decoration: none; }
.nav-link:hover, .nav-link.active { color: #e8eaf2; background: #1d2130; }
.burger { display: none; background: none; border: none; color: #e8eaf2; font-size: 1.1rem; cursor: pointer; }
.main { flex: 1; max-width: 800px; width: 100%; margin: 0 auto; padding: 3rem 1.5rem; }
.footer { text-align: center; padding: 1rem; color: #7b829a; font-size: .8rem; border-top: 1px solid #2a2f3d; }
.page h1 { font-size: 2rem; font-weight: 700; margin-bottom: 1rem; }
.page a { color: #6b8cff; }
code { background: #1d2130; padding: .1rem .4rem; border-radius: 4px; font-family: monospace; font-size: .9em; }
`
}

function genViteConfig(runtime: Runtime): string {
  const isEdge = runtime === 'cloudflare' || runtime === 'generic'
  const extras = isEdge ? `\n      serverExternal: [],` : ''
  return `import { fonoVitePlugin } from '${pkg('vite')}'

export default {
  plugins: [
    fonoVitePlugin({
      serverEntry: 'server.ts',
      clientEntry:  'client.ts',${extras}
    }),
  ],
}
`
}

function genPackageJson(name: string, runtime: Runtime): string {
  const scripts: Record<string, string> = {
    build:     'vite build',
    typecheck: 'tsc --noEmit',
  }

  if (runtime === 'bun') {
    scripts.start = 'bun dist/server/server.js'
    scripts.dev   = 'bun --watch dist/server/server.js'
  } else if (runtime === 'deno') {
    scripts.start = 'deno run -A dist/server/server.js'
    scripts.dev   = 'deno run --watch -A dist/server/server.js'
  } else if (runtime === 'cloudflare') {
    scripts.dev    = 'wrangler dev'
    scripts.deploy = 'wrangler deploy'
  } else {
    scripts.start = 'node dist/server/server.js'
    scripts.dev   = 'node --watch dist/server/server.js'
  }

  const dependencies: Record<string, string> = {
    [CFG.FONO_PKG]: CFG.FONO_VERSION,
    hono:           CFG.HONO_VERSION,
  }

  const devDependencies: Record<string, string> = {
    vite:       CFG.VITE_VERSION,
    typescript: CFG.TS_VERSION,
  }

  if (runtime === 'node')       devDependencies['@hono/node-server'] = CFG.HONO_NODE_VERSION
  if (runtime === 'cloudflare') devDependencies['wrangler']           = CFG.WRANGLER_VERSION

  return JSON.stringify(
    { name, version: '0.0.1', type: 'module', private: true, scripts, dependencies, devDependencies },
    null, 2
  ) + '\n'
}

function genTsConfig(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target:                     'ESNext',
        module:                     'ESNext',
        moduleResolution:           'bundler',
        lib:                        ['ESNext', 'DOM'],
        jsx:                        'react-jsx',
        jsxImportSource:            'hono/jsx',
        strict:                     true,
        skipLibCheck:               true,
        noEmit:                     true,
        allowImportingTsExtensions: true,
        resolveJsonModule:          true,
        isolatedModules:            true,
        verbatimModuleSyntax:       true,
      },
      include: ['**/*.ts', '**/*.tsx'],
      exclude: ['node_modules', 'dist'],
    },
    null, 2
  ) + '\n'
}

function genGitignore(): string {
  return ['node_modules', 'dist', '.env', '.env.local', '*.local', '.DS_Store', 'Thumbs.db', ''].join('\n')
}

function genEnvExample(): string {
  return `# Copy this to .env and fill in your values\nPORT=${CFG.DEFAULT_PORT}\nNODE_ENV=development\n`
}

function genDenoJson(name: string): string {
  return JSON.stringify(
    {
      name,
      version: '0.0.1',
      tasks: {
        build: 'vite build',
        start: 'deno run -A dist/server/server.js',
        dev:   'deno run --watch -A dist/server/server.js',
      },
      imports: {
        [CFG.FONO_PKG]: `npm:${CFG.FONO_PKG}@${CFG.FONO_VERSION}`,
        hono:            `npm:hono@${CFG.HONO_VERSION}`,
      },
    },
    null, 2
  ) + '\n'
}

function genWranglerToml(name: string): string {
  return `name = "${name}"
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

// ── Full template extras ──────────────────────────────────────────────────────

function genStore(): string {
  return `import { ref, reactive, computed } from '${pkg('core')}'

export const theme = ref<'dark' | 'light'>('dark')
export const toggleTheme = (): void => {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
}

export interface CartItem {
  id: string
  name: string
  qty: number
  price: number
}

export const cart      = reactive<{ items: CartItem[] }>({ items: [] })
export const cartCount = computed(() => cart.items.reduce((s, i) => s + i.qty, 0))
export const cartTotal = computed(() => cart.items.reduce((s, i) => s + i.qty * i.price, 0))

export function addToCart(item: Omit<CartItem, 'qty'>): void {
  const existing = cart.items.find((i) => i.id === item.id)
  if (existing) { existing.qty++; return }
  cart.items.push({ ...item, qty: 1 })
}

export function removeFromCart(id: string): void {
  cart.items = cart.items.filter((i) => i.id !== id)
}
`
}

function genCounterRoute(): string {
  return `import { definePage, ref, computed, use } from '${pkg('core')}'

// Module-level — value persists across SPA navigations
const count   = ref(0)
const doubled = computed(() => count.value * 2)

export default definePage({
  path: '/counter',
  loader: () => ({}),
  Page() {
    const n = use(count)
    const d = use(doubled)

    return (
      <div class="page">
        <h1>Counter — {n}</h1>
        <p>Doubled (computed): {d}</p>
        <div style="display:flex;gap:.5rem;margin-top:1rem">
          <button onClick={() => { count.value-- }}>−</button>
          <button onClick={() => { count.value++ }}>+</button>
          <button onClick={() => { count.value = 0 }}>reset</button>
        </div>
        <p style="margin-top:1rem;color:#7b829a;font-size:.875rem">
          Navigate away and back — the count persists.
        </p>
      </div>
    )
  },
})
`
}

function genPostsIndexRoute(): string {
  return `import { definePage } from '${pkg('core')}'

interface PostSummary {
  slug: string
  title: string
  date: string
}

const POSTS: PostSummary[] = [
  { slug: 'hello-fono', title: 'Hello Fono',       date: '2025-01-01' },
  { slug: 'signals',    title: 'How signals work',  date: '2025-01-08' },
]

export default definePage({
  path: '/posts',
  loader: async (): Promise<{ posts: PostSummary[] }> => ({ posts: POSTS }),
  Page({ posts }) {
    return (
      <div class="page">
        <h1>Posts</h1>
        <ul style="list-style:none;display:flex;flex-direction:column;gap:.5rem;margin-top:1rem">
          {posts.map((p) => (
            <li key={p.slug}>
              <a href={\`/posts/\${p.slug}\`}>{p.title}</a>
              <span style="color:#7b829a;font-size:.85rem"> — {p.date}</span>
            </li>
          ))}
        </ul>
      </div>
    )
  },
})
`
}

function genPostDetailRoute(): string {
  return `import { definePage } from '${pkg('core')}'

interface Post {
  title: string
  body: string
}

const POSTS: Record<string, Post> = {
  'hello-fono': {
    title: 'Hello Fono',
    body:  'Fono is a full-stack framework built on Hono — SSR, SPA, and Vue-like signals in 3 files.',
  },
  signals: {
    title: 'How signals work',
    body:  'Signals are reactive values that notify only the components subscribed to them — no virtual DOM diffing needed.',
  },
}

export default definePage<{ post: Post | null; slug: string }>({
  path: '/posts/[slug]',
  loader: (c): { post: Post | null; slug: string } => {
    const slug = (c.req as any).param('slug') as string
    return { post: POSTS[slug] ?? null, slug }
  },
  Page({ post, slug }) {
    if (!post) {
      return (
        <div class="page">
          <h1>Post not found: {slug}</h1>
          <a href="/posts">← Posts</a>
        </div>
      )
    }
    return (
      <article class="page">
        <a href="/posts">← Posts</a>
        <h1 style="margin-top:.75rem">{post.title}</h1>
        <p style="margin-top:1rem;line-height:1.8">{post.body}</p>
      </article>
    )
  },
})
`
}

function genProjectReadme(a: Answers): string {
  const cmds: Record<PkgMgr, { install: string; build: string; start: string }> = {
    npm:  { install: 'npm install',   build: 'npm run build',    start: 'npm start' },
    pnpm: { install: 'pnpm install',  build: 'pnpm build',       start: 'pnpm start' },
    bun:  { install: 'bun install',   build: 'bun run build',    start: 'bun start' },
    yarn: { install: 'yarn',          build: 'yarn build',       start: 'yarn start' },
    deno: { install: 'deno install',  build: 'deno task build',  start: 'deno task start' },
  }
  const { install, build, start } = cmds[a.pkgManager]

  return `# ${a.projectName}

A [Fono](${CFG.DOCS_URL}) app — SSR + SPA + Vue-like reactivity on [Hono](https://hono.dev).

## Getting started

\`\`\`bash
${install}
${build}
${start}
\`\`\`

## Project structure

\`\`\`
server.ts            # Server entry — createFono() + serve()
client.ts            # Client entry — boot()
app/
  layouts.tsx        # Root layout (nav, footer)
  routes/
    home.tsx         # GET /
    about.tsx        # GET /about
    api.ts           # GET /api/health, GET /api/hello
public/
  style.css
vite.config.ts
tsconfig.json
\`\`\`

## Key Fono APIs used

| API | What it does |
|---|---|
| \`definePage\` | Route + SSR loader + Page component in one file |
| \`defineLayout\` | Shared wrapper (nav, footer) rendered around every page |
| \`defineApiRoute\` | Raw Hono routes — REST, RPC, WebSocket |
| \`ref\` / \`use\` | Reactive value that persists across SPA navigations |

## Runtime

**${a.runtime}** — see \`server.ts\` for the serve configuration.

## Learn more

- Docs: ${CFG.DOCS_URL}
- Hono: https://hono.dev
`
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 4  Scaffold — write all files to disk
// ══════════════════════════════════════════════════════════════════════════════

function scaffold(dir: string, answers: Answers): void {
  const { runtime, template } = answers

  // Core directories
  mkdirSync(join(dir, 'app/routes'), { recursive: true })
  mkdirSync(join(dir, 'app/components'), { recursive: true })
  mkdirSync(join(dir, 'public'), { recursive: true })

  // Root config files
  writeFile(join(dir, 'package.json'),   genPackageJson(answers.projectName, runtime))
  writeFile(join(dir, 'tsconfig.json'),  genTsConfig())
  writeFile(join(dir, 'vite.config.ts'), genViteConfig(runtime))
  writeFile(join(dir, '.gitignore'),     genGitignore())
  writeFile(join(dir, '.env.example'),   genEnvExample())

  // Runtime-specific config files
  if (runtime === 'deno')       writeFile(join(dir, 'deno.json'),     genDenoJson(answers.projectName))
  if (runtime === 'cloudflare') writeFile(join(dir, 'wrangler.toml'), genWranglerToml(answers.projectName))

  // App entry points
  writeFile(join(dir, 'server.ts'), genServerEntry(runtime))
  writeFile(join(dir, 'client.ts'), genClientEntry())

  // Shared app files
  writeFile(join(dir, 'app/layouts.tsx'),      genRootLayout())
  writeFile(join(dir, 'app/routes/home.tsx'),  genHomeRoute())
  writeFile(join(dir, 'app/routes/about.tsx'), genAboutRoute())
  writeFile(join(dir, 'app/routes/api.ts'),    genApiRoute())
  writeFile(join(dir, 'public/style.css'),     genAppCss())

  // Full template extras
  if (template === 'full') {
    writeFile(join(dir, 'app/store.ts'),                genStore())
    writeFile(join(dir, 'app/routes/counter.tsx'),      genCounterRoute())
    writeFile(join(dir, 'app/routes/posts/index.tsx'),  genPostsIndexRoute())
    writeFile(join(dir, 'app/routes/posts/[slug].tsx'), genPostDetailRoute())
  }

  // Project README
  writeFile(join(dir, 'README.md'), genProjectReadme(answers))
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 5  Install & git helpers
// ══════════════════════════════════════════════════════════════════════════════

const INSTALL_CMD: Record<PkgMgr, string> = {
  npm:  'npm install',
  pnpm: 'pnpm install',
  bun:  'bun install',
  yarn: 'yarn',
  deno: 'deno install',
}

const BUILD_CMD: Record<PkgMgr, string> = {
  npm:  'npm run build',
  pnpm: 'pnpm build',
  bun:  'bun run build',
  yarn: 'yarn build',
  deno: 'deno task build',
}

const START_CMD: Record<PkgMgr, string> = {
  npm:  'npm start',
  pnpm: 'pnpm start',
  bun:  'bun start',
  yarn: 'yarn start',
  deno: 'deno task start',
}

function runInstall(mgr: PkgMgr, dir: string): void {
  execSync(INSTALL_CMD[mgr], { cwd: dir, stdio: 'inherit' })
}

function runGitInit(dir: string): void {
  execSync('git init',                                    { cwd: dir, stdio: 'inherit' })
  execSync('git add -A',                                  { cwd: dir, stdio: 'inherit' })
  execSync(`git commit -m "${CFG.GIT_INIT_COMMIT}"`,     { cwd: dir, stdio: 'inherit' })
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 6  Next-steps display
// ══════════════════════════════════════════════════════════════════════════════

function printNextSteps(projectName: string, answers: Answers): void {
  const inCurrentDir = projectName === '.'
  const lines: string[] = ['', '  Next steps:']

  if (!inCurrentDir)          lines.push(`    ${cyan('cd')} ${projectName}`)
  if (!answers.installDeps)   lines.push(`    ${cyan(INSTALL_CMD[answers.pkgManager])}`)
  lines.push(`    ${cyan(BUILD_CMD[answers.pkgManager])}`)
  lines.push(`    ${cyan(START_CMD[answers.pkgManager])}`)
  lines.push('')
  lines.push(`  Docs: ${cyan(CFG.DOCS_URL)}`)
  lines.push('')

  console.log(lines.join('\n'))
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 7  CLI flag parser — used for --ci mode
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
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag)
    return idx !== -1 ? argv[idx + 1] : undefined
  }
  const has = (flag: string): boolean => argv.includes(flag)

  const RUNTIMES:  Runtime[]  = ['node', 'bun', 'deno', 'cloudflare', 'generic']
  const TEMPLATES: Template[] = ['minimal', 'full']
  const MANAGERS:  PkgMgr[]   = ['npm', 'pnpm', 'yarn', 'bun', 'deno']

  const runtimeArg    = get('--runtime')    as Runtime  | undefined
  const templateArg   = get('--template')   as Template | undefined
  const pkgManagerArg = (get('--pkg-manager') ?? get('--pkgManager')) as PkgMgr | undefined

  return {
    ci:         has('--ci') || process.env['CI'] === 'true',
    runtime:    runtimeArg    && RUNTIMES.includes(runtimeArg)    ? runtimeArg    : undefined,
    template:   templateArg   && TEMPLATES.includes(templateArg)  ? templateArg   : undefined,
    pkgManager: pkgManagerArg && MANAGERS.includes(pkgManagerArg as PkgMgr) ? pkgManagerArg : undefined,
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
  const argName = argv.find((a) => !a.startsWith('--'))
  const flags   = parseFlags(argv)

  // ── CI / non-interactive mode ──────────────────────────────────────────────
  // Activated by --ci flag or CI=true env var. Skips all prompts and uses
  // flag values with sensible defaults. Used by GitHub Actions scaffold test.
  if (flags.ci) {
    const projectName = argName ?? 'my-fono-app'
    const ciAnswers: Answers = {
      projectName,
      runtime:    flags.runtime    ?? 'node',
      template:   flags.template   ?? 'minimal',
      pkgManager: flags.pkgManager ?? 'npm',
      installDeps: !flags.noInstall,
      gitInit:     !flags.noGit,
    }

    const projectDir = resolve(process.cwd(), projectName)
    mkdirSync(projectDir, { recursive: true })

    console.log(`  Scaffolding ${bold(cyan(projectName))} [CI mode]…`)
    console.log()
    scaffold(projectDir, ciAnswers)

    if (ciAnswers.installDeps) {
      console.log(`  Installing with ${bold(ciAnswers.pkgManager)}…\n`)
      try { runInstall(ciAnswers.pkgManager, projectDir) }
      catch { console.log(yellow('\n  Install failed — run it manually.\n')) }
    }

    if (ciAnswers.gitInit) {
      try { runGitInit(projectDir) } catch { /* git not available */ }
    }

    console.log(green('  Done! 🎉'))
    printNextSteps(projectName, ciAnswers)
    return
  }

  // ── Interactive mode ───────────────────────────────────────────────────────
  let cancelled = false

  const answers = await prompts(
    [
      // ── Project name ───────────────────────────────────────────────────────
      {
        type:     'text',
        name:     'projectName',
        message:  'Project name:',
        initial:  argName ?? 'my-fono-app',
        validate: validateName,
      },

      // ── Overwrite guard ────────────────────────────────────────────────────
      {
        type: (prev: string) => {
          const dir = resolve(process.cwd(), prev)
          return existsSync(dir) && !isDirEmpty(dir)
            ? 'confirm'
            : (null as unknown as 'confirm')
        },
        name:    'overwrite',
        message: (prev: string) =>
          `${yellow('!')} "${prev}" is not empty. Overwrite?`,
        initial: false,
      },
      {
        type: (_: unknown, values: Partial<Answers & { overwrite: boolean }>) => {
          if (values.overwrite === false) cancelled = true
          return null as unknown as 'text'
        },
        name:    '_guard',
        message: '',
      },

      // ── Runtime ────────────────────────────────────────────────────────────
      {
        type:    'select',
        name:    'runtime',
        message: 'Target runtime:',
        choices: [
          { title: `${green('Node.js')}            ${dim('@hono/node-server')}`,       value: 'node' },
          { title: `${magenta('Bun')}              ${dim('Bun.serve, fast startup')}`, value: 'bun' },
          { title: `${cyan('Deno')}             ${dim('Deno.serve, permissions')}`,   value: 'deno' },
          { title: `${yellow('Cloudflare Workers')} ${dim('edge, wrangler')}`,         value: 'cloudflare' },
          { title: `${dim('Generic')}            ${dim('WinterCG, export handler')}`, value: 'generic' },
        ],
      },

      // ── Template ───────────────────────────────────────────────────────────
      {
        type:    'select',
        name:    'template',
        message: 'Template:',
        choices: [
          {
            title: `${green('Minimal')}  ${dim('Home + About + /api/health')}`,
            value: 'minimal',
          },
          {
            title: `${cyan('Full')}     ${dim('+ Counter (signals) + Posts [slug] + store')}`,
            value: 'full',
          },
        ],
      },

      // ── Package manager ────────────────────────────────────────────────────
      {
        type:    'select',
        name:    'pkgManager',
        message: 'Package manager:',
        choices: (_: unknown, values: Partial<Answers>) => {
          const base = [
            { title: 'npm',  value: 'npm' },
            { title: 'pnpm', value: 'pnpm' },
            { title: 'yarn', value: 'yarn' },
          ]
          if (values.runtime === 'bun')  return [{ title: 'bun',  value: 'bun'  }, ...base]
          if (values.runtime === 'deno') return [{ title: 'deno', value: 'deno' }, ...base]
          return base
        },
      },

      // ── Install + git ──────────────────────────────────────────────────────
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

  const typedAnswers = answers as Answers
  const projectDir   = resolve(process.cwd(), typedAnswers.projectName)

  mkdirSync(projectDir, { recursive: true })

  console.log()
  console.log(`  Scaffolding ${bold(cyan(typedAnswers.projectName))}…`)
  console.log()

  scaffold(projectDir, typedAnswers)

  if (typedAnswers.installDeps) {
    console.log(`  Installing with ${bold(typedAnswers.pkgManager)}…\n`)
    try {
      runInstall(typedAnswers.pkgManager, projectDir)
    } catch {
      console.log(yellow('\n  Install failed — run it manually.\n'))
    }
  }

  if (typedAnswers.gitInit) {
    try { runGitInit(projectDir) } catch { /* git not available */ }
  }

  console.log()
  console.log(green('  Done! 🎉'))
  printNextSteps(typedAnswers.projectName, typedAnswers)
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e)
  console.error(red(`\n  Error: ${msg}\n`))
  process.exit(1)
})