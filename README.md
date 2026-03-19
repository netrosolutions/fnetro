# FNetro

> Full-stack [Hono](https://hono.dev) framework powered by **SolidJS v1.9+** —
> SSR · SPA · SEO · server & client middleware · multi-runtime · TypeScript-first.

[![CI](https://github.com/netrosolutions/fnetro/actions/workflows/ci.yml/badge.svg)](https://github.com/netrosolutions/fnetro/actions/workflows/ci.yml)
[![npm @netrojs/fnetro](https://img.shields.io/npm/v/@netrojs/fnetro?label=%40netrojs%2Ffnetro)](https://www.npmjs.com/package/@netrojs/fnetro)
[![npm create-fnetro](https://img.shields.io/npm/v/@netrojs/create-fnetro?label=%40netrojs%2Fcreate-fnetro)](https://www.npmjs.com/package/@netrojs/create-fnetro)
[![license](https://img.shields.io/npm/l/@netrojs/fnetro)](./LICENSE)

---

## Table of contents

1. [Packages](#packages)
2. [Quick start](#quick-start)
3. [How it works](#how-it-works)
4. [Routing](#routing)
   - [definePage](#definepage)
   - [defineGroup](#definegroup)
   - [defineLayout](#definelayout)
   - [defineApiRoute](#defineapiroute)
5. [Loaders](#loaders)
6. [SEO](#seo)
7. [Middleware](#middleware)
   - [Server middleware](#server-middleware)
   - [Client middleware](#client-middleware)
8. [SolidJS reactivity](#solidjs-reactivity)
9. [Navigation](#navigation)
10. [Asset handling](#asset-handling)
11. [Multi-runtime serve()](#multi-runtime-serve)
12. [Vite plugin](#vite-plugin)
13. [Project structure](#project-structure)
14. [TypeScript](#typescript)
15. [create-fnetro CLI](#create-fnetro-cli)
16. [API reference](#api-reference)
17. [Monorepo development](#monorepo-development)
18. [Publishing & releases](#publishing--releases)

---

## Packages

| Package | Description |
|---|---|
| [`@netrojs/fnetro`](./packages/fnetro) | Core framework — SSR renderer, SPA routing, SEO, middleware, Vite plugin |
| [`@netrojs/create-fnetro`](./packages/create-fnetro) | Interactive project scaffolding CLI |

---

## Quick start

```bash
npm create @netrojs/fnetro@latest my-app
cd my-app
npm install
npm run dev
```

Or with other package managers:

```bash
pnpm create @netrojs/fnetro@latest my-app
bun create @netrojs/fnetro my-app
deno run -A npm:create-fnetro my-app
```

---

## How it works

```
Browser                              Server (Hono)
────────────────────────────────     ─────────────────────────────────────
                                     Global middleware
                                     ↓
                                     Route match ([id], [...slug], *)
                                     ↓
                                     Route middleware
                                     ↓
                                     Loader (async, type-safe)
                                     ↓
                         SSR ──────  SolidJS renderToStringAsync()
                          │          ↓
HTML + hydration script ◄─┘          SEO <head> injection
                                     ↓
                                     HTML shell (state + params + seo embedded)
                                     ↓
                         SPA ──────  JSON payload (state + seo only)
                          │
hydrate() ◄───────────────┘
↓
Client middleware chain
↓
SolidJS reactive component tree
(module-level signals persist across navigations)
```

---

## Routing

### `definePage`

Define a route with an optional SSR loader, SEO config, and a SolidJS component.

```tsx
// app/routes/post.tsx
import { definePage } from '@netrojs/fnetro'

export default definePage({
  path: '/posts/[slug]',

  loader: async (c) => {
    const slug = c.req.param('slug')
    const post = await db.posts.findBySlug(slug)
    if (!post) return c.notFound()
    return { post }
  },

  seo: (data) => ({
    title:       `${data.post.title} — My Blog`,
    description: data.post.excerpt,
    ogImage:     data.post.coverUrl,
    twitterCard: 'summary_large_image',
  }),

  Page({ post, url, params }) {
    return <article>{post.title}</article>
  },
})
```

**Path patterns:**

| Pattern | Matches | `params` |
|---|---|---|
| `/posts/[slug]` | `/posts/hello-world` | `{ slug: 'hello-world' }` |
| `/files/[...rest]` | `/files/a/b/c` | `{ rest: 'a/b/c' }` |
| `/shop/*` | `/shop/anything` | *(positional)* |

---

### `defineGroup`

Group routes under a shared URL prefix, layout, and middleware.

```ts
import { defineGroup } from '@netrojs/fnetro'

export const adminGroup = defineGroup({
  prefix:     '/admin',
  layout:     AdminLayout,   // optional — overrides app default
  middleware: [requireAuth, auditLog],
  routes:     [dashboard, users, settings],
})
```

Groups nest arbitrarily:

```ts
defineGroup({
  prefix: '/api',
  routes: [
    defineGroup({ prefix: '/v1', routes: [v1] }),
    defineGroup({ prefix: '/v2', routes: [v2] }),
  ],
})
```

---

### `defineLayout`

Wrap every page with a shared shell (nav, footer, providers).

```tsx
import { defineLayout } from '@netrojs/fnetro'
import { createSignal } from 'solid-js'

// Module-level signal — persists across SPA navigations
const [sidebarOpen, setSidebarOpen] = createSignal(false)

export const RootLayout = defineLayout(({ children, url, params }) => (
  <div class="app">
    <nav>
      <a href="/" class={url === '/' ? 'active' : ''}>Home</a>
      <a href="/about" class={url === '/about' ? 'active' : ''}>About</a>
    </nav>
    <main>{children}</main>
    <footer>© 2025</footer>
  </div>
))
```

**Per-page override:**

```ts
// Use a different layout
definePage({ path: '/landing', layout: LandingLayout, Page: ... })

// Disable layout entirely
definePage({ path: '/embed',   layout: false,         Page: ... })
```

---

### `defineApiRoute`

Mount raw Hono sub-routes. Full Hono API — REST, RPC, WebSocket, streaming.

```ts
import { defineApiRoute } from '@netrojs/fnetro'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

export const api = defineApiRoute('/api', (app) => {
  app.get('/health', (c) =>
    c.json({ status: 'ok', ts: Date.now() }),
  )

  app.get('/users/:id', async (c) => {
    const user = await db.users.find(c.req.param('id'))
    return user ? c.json(user) : c.json({ error: 'not found' }, 404)
  })

  app.post(
    '/items',
    zValidator('json', z.object({ name: z.string().min(1) })),
    async (c) => {
      const item = await db.items.create(c.req.valid('json'))
      return c.json(item, 201)
    },
  )
})
```

---

## Loaders

Loaders run **on the server on every request** — both initial SSR and SPA navigations. The return value is JSON-serialised and injected as page props.

```ts
definePage({
  path: '/dashboard',

  loader: async (c) => {
    // Full Hono Context — headers, cookies, query params, env bindings
    const session = getCookie(c, 'session')
    if (!session) return c.redirect('/login')

    const user  = await auth.verify(session)
    const stats = await db.stats.forUser(user.id)
    return { user, stats }
  },

  Page({ user, stats }) { /* typed */ },
})
```

**Type-safe loaders:**

```ts
interface DashboardData { user: User; stats: Stats }

definePage<DashboardData>({
  loader: async (c): Promise<DashboardData> => ({
    user:  await getUser(c),
    stats: await getStats(c),
  }),
  Page({ user, stats }) { /* DashboardData & { url, params } */ },
})
```

---

## SEO

Every page can declare `seo` as a **static object** or a **function of loader data**.
App-level `seo` provides global defaults; page-level values override them.

```ts
// app.ts — global defaults applied to every page
createFNetro({
  seo: {
    ogType:      'website',
    ogSiteName:  'My App',
    twitterCard: 'summary_large_image',
    twitterSite: '@myapp',
    robots:      'index, follow',
    themeColor:  '#0d0f14',
  },
  routes: [...],
})
```

```ts
// app/routes/post.tsx — page overrides (merged with app defaults)
definePage({
  path: '/posts/[slug]',
  loader: (c) => ({ post: await getPost(c.req.param('slug')) }),

  seo: (data, params) => ({
    title:            `${data.post.title} — My Blog`,
    description:      data.post.excerpt,
    canonical:        `https://example.com/posts/${params.slug}`,
    ogTitle:          data.post.title,
    ogDescription:    data.post.excerpt,
    ogImage:          data.post.coverUrl,
    ogImageWidth:     '1200',
    ogImageHeight:    '630',
    twitterTitle:     data.post.title,
    twitterImage:     data.post.coverUrl,
    jsonLd: {
      '@context':    'https://schema.org',
      '@type':       'Article',
      headline:      data.post.title,
      author:        { '@type': 'Person', name: data.post.authorName },
      datePublished: data.post.publishedAt,
      image:         data.post.coverUrl,
    },
    extra: [
      { name: 'article:author', content: data.post.authorName },
    ],
  }),

  Page({ post }) { ... },
})
```

### All SEO fields

| Field | `<head>` output |
|---|---|
| `title` | `<title>` |
| `description` | `<meta name="description">` |
| `keywords` | `<meta name="keywords">` |
| `author` | `<meta name="author">` |
| `robots` | `<meta name="robots">` |
| `canonical` | `<link rel="canonical">` |
| `themeColor` | `<meta name="theme-color">` |
| `ogTitle` | `<meta property="og:title">` |
| `ogDescription` | `<meta property="og:description">` |
| `ogImage` | `<meta property="og:image">` |
| `ogImageAlt` | `<meta property="og:image:alt">` |
| `ogImageWidth` | `<meta property="og:image:width">` |
| `ogImageHeight` | `<meta property="og:image:height">` |
| `ogUrl` | `<meta property="og:url">` |
| `ogType` | `<meta property="og:type">` |
| `ogSiteName` | `<meta property="og:site_name">` |
| `ogLocale` | `<meta property="og:locale">` |
| `twitterCard` | `<meta name="twitter:card">` |
| `twitterSite` | `<meta name="twitter:site">` |
| `twitterCreator` | `<meta name="twitter:creator">` |
| `twitterTitle` | `<meta name="twitter:title">` |
| `twitterDescription` | `<meta name="twitter:description">` |
| `twitterImage` | `<meta name="twitter:image">` |
| `twitterImageAlt` | `<meta name="twitter:image:alt">` |
| `jsonLd` | `<script type="application/ld+json">` |
| `extra` | Arbitrary `<meta>` tags |

On SPA navigation, all `<meta>` tags and `document.title` are updated automatically — no full reload.

---

## Middleware

### Server middleware

Hono middleware at three levels — global, group, and page.

```ts
import { createFNetro } from '@netrojs/fnetro/server'
import { cors }         from 'hono/cors'
import { logger }       from 'hono/logger'
import { bearerAuth }   from 'hono/bearer-auth'

const fnetro = createFNetro({
  // 1. Global — runs on every request
  middleware: [logger(), cors({ origin: 'https://example.com' })],

  routes: [
    // 2. Group-level — runs for every route in the group
    defineGroup({
      prefix:     '/admin',
      middleware: [bearerAuth({ token: process.env.API_KEY! })],
      routes: [
        // 3. Page-level — runs for this route only
        definePage({
          path:       '/reports',
          middleware: [rateLimiter({ max: 10, window: '1m' })],
          Page:       Reports,
        }),
      ],
    }),
  ],
})
```

Middleware can short-circuit by returning a `Response`:

```ts
const requireAuth: HonoMiddleware = async (c, next) => {
  const session = getCookie(c, 'session')
  if (!session) return c.redirect('/login')
  c.set('user', await verifySession(session))
  await next()
}
```

---

### Client middleware

Runs before every **SPA navigation**. Register with `useClientMiddleware()` **before** `boot()`.

```ts
// client.ts
import { boot, useClientMiddleware, navigate } from '@netrojs/fnetro/client'

// Analytics — fires after navigation completes
useClientMiddleware(async (url, next) => {
  await next()
  analytics.page({ url })
})

// Auth guard — redirects before navigation
useClientMiddleware(async (url, next) => {
  if (!isLoggedIn() && url.startsWith('/dashboard')) {
    await navigate('/login?redirect=' + encodeURIComponent(url))
    return  // cancel the original navigation
  }
  await next()
})

// Loading indicator
useClientMiddleware(async (url, next) => {
  NProgress.start()
  try   { await next() }
  finally { NProgress.done() }
})

boot({ routes, layout })
```

The chain runs in registration order: `mw1 → mw2 → ... → fetch + render`. Omitting `next()` in any middleware cancels the navigation.

---

## SolidJS reactivity

Use SolidJS primitives directly — no FNetro wrappers.

**Module-level signals** persist across SPA navigations (they live for the lifetime of the page JS):

```tsx
import { createSignal, createMemo, createEffect, For } from 'solid-js'
import { definePage } from '@netrojs/fnetro'

const [count, setCount] = createSignal(0)
const doubled = createMemo(() => count() * 2)

export default definePage({
  path: '/counter',
  Page() {
    createEffect(() => { document.title = `Count: ${count()}` })
    return (
      <div>
        <p>{count()} × 2 = {doubled()}</p>
        <button onClick={() => setCount(n => n + 1)}>+</button>
      </div>
    )
  },
})
```

**Stores** for structured reactive state:

```tsx
import { createStore, produce } from 'solid-js/store'

interface Todo { id: number; text: string; done: boolean }
const [todos, setTodos] = createStore<{ items: Todo[] }>({ items: [] })

function toggle(id: number) {
  setTodos('items', t => t.id === id, produce(t => { t.done = !t.done }))
}

export default definePage({
  path: '/todos',
  Page() {
    return (
      <For each={todos.items}>
        {(todo) => (
          <li
            style={{ 'text-decoration': todo.done ? 'line-through' : 'none' }}
            onClick={() => toggle(todo.id)}
          >
            {todo.text}
          </li>
        )}
      </For>
    )
  },
})
```

---

## Navigation

### Links — automatic interception

Any `<a href="...">` pointing to a registered route is intercepted automatically. No special component needed.

```tsx
<a href="/about">About</a>             {/* → SPA navigation */}
<a href="/posts/hello">Post</a>        {/* → SPA navigation */}
<a href="/legacy" data-no-spa>Legacy</a>   {/* → full page load */}
<a href="https://example.com" rel="external">External</a>  {/* → full page load */}
```

### Programmatic navigation

```ts
import { navigate } from '@netrojs/fnetro/client'

await navigate('/about')                          // push history
await navigate('/login', { replace: true })       // replace history entry
await navigate('/modal', { scroll: false })       // skip scroll-to-top
```

### Prefetch

```ts
import { prefetch } from '@netrojs/fnetro/client'

prefetch('/about')   // warm the loader cache on hover / focus
```

Hover-based prefetching is automatic when `prefetchOnHover: true` (the default) is set in `boot()`.

---

## Asset handling

### Development

`@hono/vite-dev-server` injects Vite's dev client and HMR scripts automatically. No asset config needed.

### Production

`vite build` produces a `manifest.json` alongside the hashed client bundle. The server reads the manifest at startup to resolve the correct filenames.

```ts
// app.ts
createFNetro({
  routes,
  assets: {
    manifestDir:   'dist/assets',  // directory containing manifest.json
    manifestEntry: 'client.ts',    // key in the manifest (your client entry)
  },
})
```

**Manual override** (edge runtimes / CDN-hosted assets):

```ts
createFNetro({
  assets: {
    scripts: ['https://cdn.example.com/client-abc123.js'],
    styles:  ['https://cdn.example.com/style-def456.css'],
  },
})
```

**Public directory** — truly static files in `public/` (favicon, `robots.txt`, images that don't need processing) are served as-is at `/` by the Node.js `serve()` helper. CSS and JS that need Vite processing (HMR, bundling, hashing) must be **imported from JavaScript** — put them in `app/` and import from `client.ts`.

```ts
// client.ts — CSS imported here so Vite handles it in dev (HMR) and prod (bundle)
import './app/style.css'
```

---

## Multi-runtime serve()

```ts
import { serve } from '@netrojs/fnetro/server'

// Auto-detects Node.js, Bun, or Deno
await serve({ app: fnetro })

// Explicit configuration
await serve({
  app:       fnetro,
  port:      3000,
  hostname:  '0.0.0.0',
  runtime:   'node',       // 'node' | 'bun' | 'deno' | 'edge'
  staticDir: './dist',     // root for /assets/* and /* static files
})
```

**Edge runtimes** (Cloudflare Workers, Deno Deploy, Fastly, etc.):

```ts
// server.ts
import { fnetro } from './app'

// Export the Hono fetch handler — the platform calls it directly
export default { fetch: fnetro.handler }
```

---

## Vite plugin

```ts
// vite.config.ts
import { defineConfig }     from 'vite'
import { fnetroVitePlugin } from '@netrojs/fnetro/vite'
import devServer            from '@hono/vite-dev-server'

export default defineConfig({
  plugins: [
    // Handles: SolidJS JSX transform, SSR server build, client bundle + manifest
    fnetroVitePlugin({
      serverEntry:    'server.ts',    // default: 'server.ts'
      clientEntry:    'client.ts',    // default: 'client.ts'
      serverOutDir:   'dist/server',  // default: 'dist/server'
      clientOutDir:   'dist/assets',  // default: 'dist/assets'
      serverExternal: ['@myorg/db'],  // extra server-bundle externals
      solidOptions:   {},             // forwarded to vite-plugin-solid
    }),

    // Dev: serves the FNetro app through Vite with hot-reload
    // app.ts default export must be the Hono *instance* (fnetro.app),
    // NOT fnetro.handler (plain function, no .fetch property).
    devServer({ entry: 'app.ts' }),
  ],
})
```

### Build output

```
dist/
├── server/
│   └── server.js            # SSR server bundle (ESM)
└── assets/
    ├── manifest.json        # Vite asset manifest (for hashed URL resolution)
    ├── client-[hash].js     # Hydration + SPA bundle
    └── style-[hash].css     # CSS (when imported from JS)
```

---

## Project structure

```
my-app/
│
├── app.ts              # Shared FNetro app — used by dev server AND server.ts
│                       # Default export must be fnetro.app (Hono instance)
│
├── server.ts           # Production entry — imports app.ts, calls serve()
├── client.ts           # Browser entry — registers middleware, calls boot()
│
├── app/
│   ├── layouts.tsx     # defineLayout() — root shell (nav, footer)
│   ├── style.css       # Global CSS — imported by client.ts, processed by Vite
│   └── routes/
│       ├── home.tsx    # definePage({ path: '/' })
│       ├── about.tsx   # definePage({ path: '/about' })
│       ├── api.ts      # defineApiRoute('/api', fn)
│       └── posts/
│           ├── index.tsx       # /posts
│           └── [slug].tsx      # /posts/:slug
│
├── public/
│   └── favicon.ico     # Truly static assets (favicon, robots.txt, etc.)
│
├── vite.config.ts
├── tsconfig.json
└── package.json
```

### `app.ts` vs `server.ts`

| File | Purpose |
|---|---|
| `app.ts` | Creates the FNetro app. Exports `fnetro` (named) and `fnetro.app` (default). Used by `@hono/vite-dev-server` in dev and imported by `server.ts` in production. |
| `server.ts` | Production-only entry point. Imports from `app.ts` and calls `serve()`. Never imported by the dev server. |

---

## TypeScript

`tsconfig.json` for any FNetro project:

```json
{
  "compilerOptions": {
    "target":                     "ES2022",
    "module":                     "ESNext",
    "moduleResolution":           "bundler",
    "lib":                        ["ES2022", "DOM"],
    "jsx":                        "preserve",
    "jsxImportSource":            "solid-js",
    "strict":                     true,
    "skipLibCheck":               true,
    "noEmit":                     true,
    "allowImportingTsExtensions": true,
    "resolveJsonModule":          true,
    "isolatedModules":            true,
    "verbatimModuleSyntax":       true
  }
}
```

> **Important:** `jsxImportSource` must be `"solid-js"` — not `"hono/jsx"`. FNetro v0.2+ uses SolidJS for all rendering.

---

## create-fnetro CLI

Scaffold a new project interactively or from CI:

```bash
npm create @netrojs/fnetro@latest [project-name] [flags]
```

### Interactive mode

Running without flags opens a step-by-step prompt:

```
  ⬡  create-fnetro
  Full-stack Hono + SolidJS — SSR · SPA · SEO · TypeScript

  ✔ Project name: … my-app
  ✔ Target runtime: › Node.js
  ✔ Template: › Minimal
  ✔ Package manager: › npm
  ✔ Install dependencies now? … yes
  ✔ Initialize a git repository? … yes
```

### CLI flags (non-interactive / CI)

| Flag | Values | Default |
|---|---|---|
| `--ci` | — | `false` |
| `--runtime` | `node` `bun` `deno` `cloudflare` `generic` | `node` |
| `--template` | `minimal` `full` | `minimal` |
| `--pkg-manager` | `npm` `pnpm` `yarn` `bun` `deno` | `npm` |
| `--no-install` | — | installs |
| `--no-git` | — | initialises |

```bash
# Non-interactive CI scaffold
npm create @netrojs/fnetro@latest my-app \
  --ci \
  --runtime node \
  --template full \
  --pkg-manager pnpm \
  --no-git
```

### Templates

**`minimal`** — production-ready starter:
```
app.ts  server.ts  client.ts
app/layouts.tsx
app/style.css               # Imported by client.ts — Vite bundles + HMR
app/routes/home.tsx     # GET /
app/routes/about.tsx    # GET /about
app/routes/api.ts       # GET /api/health  GET /api/hello
```

**`full`** — includes SolidJS signal demo, dynamic routes, and shared store:
```
(everything in minimal, plus)
app/store.ts                      # createSignal + createStore examples
app/routes/counter.tsx            # GET /counter — signals demo
app/routes/posts/index.tsx        # GET /posts  — SSR list
app/routes/posts/[slug].tsx       # GET /posts/:slug — dynamic SSR + SEO
```

### Supported runtimes

| Runtime | Dev command | Prod server |
|---|---|---|
| `node` | `vite` (via `@hono/vite-dev-server`) | `@hono/node-server` |
| `bun` | `bun --bun vite` | `Bun.serve` |
| `deno` | `deno run -A npm:vite` | `Deno.serve` |
| `cloudflare` | `wrangler dev` | Cloudflare Workers |
| `generic` | `vite` | WinterCG `export default { fetch }` |

---

## API reference

### `@netrojs/fnetro` (core)

**Functions:**

| Export | Signature | Description |
|---|---|---|
| `definePage` | `<T>(def) → PageDef<T>` | Define a page route |
| `defineGroup` | `(def) → GroupDef` | Group routes under a prefix |
| `defineLayout` | `(Component) → LayoutDef` | Wrap pages in a shared shell |
| `defineApiRoute` | `(path, register) → ApiRouteDef` | Mount raw Hono sub-routes |
| `compilePath` | `(path) → CompiledPath` | Compile a path pattern to a regex |
| `matchPath` | `(compiled, pathname) → params \| null` | Match a compiled path |
| `resolveRoutes` | `(routes, opts) → { pages, apis }` | Flatten a route tree |

**Constants:** `SPA_HEADER` · `STATE_KEY` · `PARAMS_KEY` · `SEO_KEY`

**Types:** `AppConfig` · `PageDef<T>` · `GroupDef` · `LayoutDef` · `ApiRouteDef` · `Route` · `PageProps<T>` · `LayoutProps` · `SEOMeta` · `HonoMiddleware` · `LoaderCtx` · `ClientMiddleware` · `ResolvedRoute` · `CompiledPath`

---

### `@netrojs/fnetro/server`

**Functions:**

| Export | Signature | Description |
|---|---|---|
| `createFNetro` | `(config: FNetroOptions) → FNetroApp` | Build the Hono app |
| `serve` | `(opts: ServeOptions) → Promise<void>` | Start server for Node/Bun/Deno |
| `detectRuntime` | `() → Runtime` | Auto-detect the current JS runtime |
| `fnetroVitePlugin` | `(opts?) → Plugin[]` | Vite plugin for dual build |

**`FNetroOptions`** (extends `AppConfig`):

```ts
interface FNetroOptions {
  layout?:     LayoutDef           // default layout for all pages
  seo?:        SEOMeta             // global SEO defaults
  middleware?: HonoMiddleware[]    // global Hono middleware
  routes:      Route[]             // top-level routes
  notFound?:   Component           // 404 component
  htmlAttrs?:  Record<string,string> // attributes on <html>
  head?:       string              // raw HTML appended to <head>
  assets?:     AssetConfig         // production asset config
}
```

**`AssetConfig`:**

```ts
interface AssetConfig {
  scripts?:       string[]   // explicit script URLs
  styles?:        string[]   // explicit stylesheet URLs
  manifestDir?:   string     // directory containing manifest.json
  manifestEntry?: string     // manifest key for client entry (default: 'client.ts')
}
```

**`ServeOptions`:**

```ts
interface ServeOptions {
  app:        FNetroApp
  port?:      number          // default: process.env.PORT ?? 3000
  hostname?:  string          // default: '0.0.0.0'
  runtime?:   Runtime         // default: auto-detected
  staticDir?: string          // default: './dist'
}
```

**`FNetroPluginOptions`:**

```ts
interface FNetroPluginOptions {
  serverEntry?:    string    // default: 'server.ts'
  clientEntry?:    string    // default: 'client.ts'
  serverOutDir?:   string    // default: 'dist/server'
  clientOutDir?:   string    // default: 'dist/assets'
  serverExternal?: string[]  // extra server-bundle externals
  solidOptions?:   object    // passed to vite-plugin-solid
}
```

---

### `@netrojs/fnetro/client`

**Functions:**

| Export | Signature | Description |
|---|---|---|
| `boot` | `(opts: BootOptions) → Promise<void>` | Hydrate SSR and start SPA |
| `navigate` | `(to, opts?) → Promise<void>` | Programmatic navigation |
| `prefetch` | `(url) → void` | Warm loader cache |
| `useClientMiddleware` | `(fn: ClientMiddleware) → void` | Register nav middleware |

**`BootOptions`** (extends `AppConfig`):

```ts
interface BootOptions extends AppConfig {
  prefetchOnHover?: boolean   // default: true
}
```

**`NavigateOptions`:**

```ts
interface NavigateOptions {
  replace?: boolean   // replaceState instead of pushState
  scroll?:  boolean   // scroll to top after navigation (default: true)
}
```

**`ClientMiddleware`:**

```ts
type ClientMiddleware = (
  url:  string,
  next: () => Promise<void>,
) => Promise<void>
```

---

## Monorepo development

```bash
# Clone and install
git clone https://github.com/netrosolutions/fnetro.git
cd fnetro
npm install                  # hoists all workspace deps to root node_modules

# Build both packages
npm run build

# Typecheck both packages
npm run typecheck

# Clean all dist/ directories
npm run clean

# Watch mode (fnetro package)
npm run build:watch --workspace=packages/fnetro
```

### Workspace structure

```
fnetro/                           root (private monorepo)
├── packages/
│   ├── fnetro/                   @netrojs/fnetro
│   │   ├── core.ts               Shared types, path matching, constants
│   │   ├── server.ts             Hono factory, SSR renderer, Vite plugin, serve()
│   │   ├── client.ts             SolidJS hydration, SPA router, client middleware
│   │   └── tsup.config.ts        Build config (3 separate entry points)
│   └── create-fnetro/            @netrojs/create-fnetro
│       └── src/index.ts          CLI scaffolding tool
├── .changeset/                   Changeset version files
│   └── config.json
└── .github/
    └── workflows/
        ├── ci.yml                Typecheck, build, scaffold smoke tests
        └── release.yml           Changeset-driven versioning + npm publish
```

---

## Publishing & releases

This monorepo uses [Changesets](https://github.com/changesets/changesets) for versioning and publishing.

### Day-to-day workflow

**1. Make changes** to `packages/fnetro` and/or `packages/create-fnetro`.

**2. Add a changeset** describing the change:
```bash
npm run changeset
# → prompts you to select packages and bump type (patch/minor/major)
# → writes a .changeset/*.md file — commit this with your changes
```

**3. Open a PR.** CI runs typecheck, build, and scaffold smoke tests on Node 18 / 20 / 22 / 24.

**4. Merge to `main`.** The `release.yml` workflow runs automatically:
- If `.changeset/*.md` files exist → opens / updates a **"Version Packages"** PR that bumps versions and updates `CHANGELOG.md`
- If the "Version Packages" PR is merged → **publishes both packages to npm** with provenance attestation and creates a GitHub Release

### Manual release

```bash
# Dry run — see what would be published
npm run release:dry

# Full release (build + changeset publish)
npm run release
```

### Secrets required

| Secret | Description |
|---|---|
| `NPM_TOKEN` | npm automation token (requires publish permission for `@netrojs`) |
| `GITHUB_TOKEN` | Provided automatically by GitHub Actions |

---

## License

MIT © [Netro Solutions](https://netrosolutions.com)
