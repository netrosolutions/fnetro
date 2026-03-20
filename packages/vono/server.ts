// ─────────────────────────────────────────────────────────────────────────────
//  Vono · server.ts
//  Hono app factory · Vue 3 streaming SSR · SEO head · asset manifest
//  Vite plugin (dual-bundle: server SSR + client SPA)
// ─────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono'
import { createSSRApp, defineComponent, h, type Component } from 'vue'
import { createRouter, createMemoryHistory, RouterView } from 'vue-router'
import { renderToString, renderToWebStream } from '@vue/server-renderer'
import {
  resolveRoutes, compilePath, matchPath, toVueRouterPath, isAsyncLoader,
  SPA_HEADER, STATE_KEY, PARAMS_KEY, SEO_KEY, DATA_KEY,
  type AppConfig, type ResolvedRoute, type LayoutDef, type SEOMeta,
} from './core'
import { build, type Plugin, type InlineConfig, type UserConfig } from 'vite'

// ── HTML helpers ──────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── SEO → <head> HTML ─────────────────────────────────────────────────────────

function buildHeadMeta(seo: SEOMeta, extraHead = ''): string {
  const m  = (n: string, v?: string)  => v ? `<meta name="${n}" content="${esc(v)}">` : ''
  const p  = (pr: string, v?: string) => v ? `<meta property="${pr}" content="${esc(v)}">` : ''
  const lk = (rel: string, href: string) => `<link rel="${rel}" href="${esc(href)}">`
  const parts: string[] = []

  if (seo.description) parts.push(m('description', seo.description))
  if (seo.keywords)    parts.push(m('keywords',    seo.keywords))
  if (seo.author)      parts.push(m('author',       seo.author))
  if (seo.robots)      parts.push(m('robots',       seo.robots))
  if (seo.themeColor)  parts.push(m('theme-color',  seo.themeColor))
  if (seo.canonical)   parts.push(lk('canonical',   seo.canonical))

  if (seo.ogTitle)       parts.push(p('og:title',       seo.ogTitle))
  if (seo.ogDescription) parts.push(p('og:description', seo.ogDescription))
  if (seo.ogImage)       parts.push(p('og:image',       seo.ogImage))
  if (seo.ogImageAlt)    parts.push(p('og:image:alt',   seo.ogImageAlt))
  if (seo.ogUrl)         parts.push(p('og:url',         seo.ogUrl))
  if (seo.ogType)        parts.push(p('og:type',        seo.ogType))
  if (seo.ogSiteName)    parts.push(p('og:site_name',   seo.ogSiteName))

  if (seo.twitterCard)        parts.push(m('twitter:card',        seo.twitterCard))
  if (seo.twitterSite)        parts.push(m('twitter:site',        seo.twitterSite))
  if (seo.twitterTitle)       parts.push(m('twitter:title',       seo.twitterTitle))
  if (seo.twitterDescription) parts.push(m('twitter:description', seo.twitterDescription))
  if (seo.twitterImage)       parts.push(m('twitter:image',       seo.twitterImage))

  const ld = seo.jsonLd
  if (ld) {
    const schemas = Array.isArray(ld) ? ld : [ld]
    for (const s of schemas) {
      parts.push(`<script type="application/ld+json">${JSON.stringify(s)}</script>`)
    }
  }

  if (extraHead) parts.push(extraHead)
  return parts.join('\n')
}

function mergeSEO(base?: SEOMeta, override?: SEOMeta): SEOMeta {
  return { ...(base ?? {}), ...(override ?? {}) }
}

// ── Asset resolution ──────────────────────────────────────────────────────────

export interface AssetConfig {
  scripts?:       string[]
  styles?:        string[]
  /** Directory containing the Vite-built assets and .vite/manifest.json. */
  manifestDir?:   string
  manifestEntry?: string
}

interface ResolvedAssets { scripts: string[]; styles: string[] }

// Process-level cache — resolved once on first production request.
let _assetsCache: ResolvedAssets | null = null

async function resolveAssets(cfg: AssetConfig, defaultEntry: string): Promise<ResolvedAssets> {
  if (_assetsCache) return _assetsCache

  if (cfg.manifestDir) {
    try {
      const [{ readFileSync }, { join }] = await Promise.all([
        import('node:fs'),
        import('node:path'),
      ])
      // Vite 5+ writes manifest to <outDir>/.vite/manifest.json
      const raw      = readFileSync(join(cfg.manifestDir, '.vite', 'manifest.json'), 'utf-8')
      const manifest = JSON.parse(raw) as Record<string, { file: string; css?: string[] }>
      const key      = cfg.manifestEntry
        ?? Object.keys(manifest).find(k => k.endsWith(defaultEntry))
        ?? defaultEntry
      const entry = manifest[key]
      if (entry) {
        _assetsCache = {
          scripts: [`/assets/${entry.file}`],
          styles:  (entry.css ?? []).map((f: string) => `/assets/${f}`),
        }
        return _assetsCache
      }
    } catch { /* manifest missing or malformed — fall through */ }
  }

  _assetsCache = {
    scripts: cfg.scripts ?? ['/assets/client.js'],
    styles:  cfg.styles  ?? [],
  }
  return _assetsCache
}

// ── HTML shell parts ──────────────────────────────────────────────────────────

interface ShellParts {
  head: string  // everything up to and including the opening <div id="vono-app">
  tail: string  // everything after the closing </div>
}

function buildShellParts(
  title:      string,
  metaHtml:   string,
  stateJson:  string,
  paramsJson: string,
  seoJson:    string,
  scripts:    string[],
  styles:     string[],
  htmlAttrs?: Record<string, string>,
): ShellParts {
  const attrs      = Object.entries(htmlAttrs ?? { lang: 'en' })
    .map(([k, v]) => `${k}="${esc(v)}"`)
    .join(' ')
  const styleLinks = styles.map(href => `<link rel="stylesheet" href="${esc(href)}">`).join('\n')
  const scriptTags = scripts.map(src => `<script type="module" src="${esc(src)}"></script>`).join('\n')

  const head = [
    '<!DOCTYPE html>',
    `<html ${attrs}>`,
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${esc(title)}</title>`,
    metaHtml,
    styleLinks,
    '</head>',
    '<body>',
    '<div id="vono-app">',
  ].filter(Boolean).join('\n')

  const tail = [
    '</div>',
    '<script>',
    `window.${STATE_KEY}=${stateJson};`,
    `window.${PARAMS_KEY}=${paramsJson};`,
    `window.${SEO_KEY}=${seoJson};`,
    '</script>',
    scriptTags,
    '</body>',
    '</html>',
  ].join('\n')

  return { head, tail }
}

// ── Async component resolution ────────────────────────────────────────────────

/** On the server: await the loader to get the real component before rendering. */
async function resolveComponent(comp: Component | ((...a: unknown[]) => unknown)): Promise<Component> {
  if (isAsyncLoader(comp)) {
    const mod = await (comp as () => Promise<unknown>)()
    return ((mod as any).default ?? mod) as Component
  }
  return comp as Component
}

// ── Vue SSR renderer (streaming) ──────────────────────────────────────────────

/**
 * Builds a fresh Vue SSR app + router per request (required — no shared state
 * across requests) and streams HTML output.
 *
 * The memory history is initialised at the request URL *before* the router is
 * created.  This ensures the router's internal startup navigation resolves
 * against the correct route and never emits a spurious
 * "[Vue Router warn]: No match found for location with path '/'" warning.
 */
/**
 * Builds a fresh Vue SSR app + router per request and renders the page body.
 *
 * DEV MODE  — returns a `string` via `renderToString`.
 *   `@hono/vite-dev-server` proxies requests through Vite's Connect middleware
 *   pipeline.  That pipeline does not flush a `ReadableStream` — the browser
 *   hangs waiting for bytes that never arrive, then reports
 *   "localhost refused to connect" after the idle timeout fires.
 *   `renderToString` buffers the full HTML and returns it as a plain string
 *   which Hono serialises to a normal HTTP response — no streaming needed.
 *
 * PRODUCTION — returns a `ReadableStream<Uint8Array>` via `renderToWebStream`.
 *   Lower TTFB: the browser receives `<head>` (CSS links, preload hints,
 *   critical scripts) while Vue is still rendering the `<body>`.
 *
 * Vue Router warning fix:
 *   `createMemoryHistory()` starts at '/'.  The router performs an internal
 *   startup navigation to that initial location before any routes are matched.
 *   If the only registered route is e.g. '/about', Vue Router emits:
 *     "[Vue Router warn]: No match found for location with path '/'"
 *   Fix: call `memHistory.replace(url)` BEFORE constructing the router so its
 *   startup navigation always resolves against the correct, matched route.
 */
async function renderPage(
  route:     ResolvedRoute,
  data:      object,
  url:       string,
  params:    Record<string, string>,
  appLayout: LayoutDef | undefined,
  dev:       boolean,
): Promise<ReadableStream<Uint8Array> | string> {
  const layout = route.layout !== undefined ? route.layout : appLayout

  // Resolve async component loaders — critical for SSR correctness
  const PageComp = await resolveComponent(route.page.component)

  const routeComp: Component = layout
    ? defineComponent({
        name:  'VonoRoute',
        setup: () => () => h(layout.component as Component, null, {
          default: () => h(PageComp),
        }),
      })
    : PageComp

  // Create a fresh app + router per request (SSR safety — no shared state)
  const app = createSSRApp({ render: () => h(RouterView) })
  app.provide(DATA_KEY, data)

  // Initialise history at the request URL before creating the router so its
  // startup navigation resolves immediately without a "[Vue Router warn]".
  const memHistory = createMemoryHistory()
  memHistory.replace(url)

  const router = createRouter({
    history: memHistory,
    routes:  [{ path: toVueRouterPath(route.fullPath), component: routeComp }],
  })
  app.use(router)

  await router.isReady()

  // Dev: buffered string — works correctly inside @hono/vite-dev-server.
  // Prod: streaming — flushes <head> to the browser before <body> is ready.
  if (dev) return renderToString(app)
  return renderToWebStream(app)
}

/** Prepend `head` and append `tail` around Vue's streaming body. */
function buildResponseStream(
  headHtml:   string,
  bodyStream: ReadableStream<Uint8Array>,
  tailHtml:   string,
): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()

  ;(async () => {
    const writer = writable.getWriter()
    try {
      await writer.write(enc.encode(headHtml))
      const reader = bodyStream.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        await writer.write(value)
      }
      await writer.write(enc.encode(tailHtml))
      await writer.close()
    } catch (err) {
      await writer.abort(err)
    }
  })()

  return readable
}

// ── createVono ──────────────────────────────────────────────────────────────

export interface VonoOptions extends AppConfig {
  assets?: AssetConfig
}

export interface VonoApp {
  /** The Hono instance — attach extra routes, error handlers, middleware. */
  app:     Hono
  /** WinterCG-compatible fetch handler for edge runtimes. */
  handler: typeof Hono.prototype.fetch
}

export function createVono(config: VonoOptions): VonoApp {
  const app = new Hono()

  // Global middleware (runs before every route)
  for (const mw of config.middleware ?? []) app.use('*', mw)

  const { pages, apis } = resolveRoutes(config.routes, {
    ...(config.layout !== undefined && { layout: config.layout }),
    middleware: [],
  })

  // Pre-compile path patterns — avoids recompiling on every request
  const compiled = pages.map(r => ({ route: r, cp: compilePath(r.fullPath) }))

  // Register API sub-apps before the catch-all page handler
  for (const api of apis) {
    const sub = new Hono()
    api.register(sub, config.middleware ?? [])
    app.route(api.path, sub)
  }

  app.all('*', async (c) => {
    const url      = new URL(c.req.url)
    const pathname = url.pathname
    const isSPA    = c.req.header(SPA_HEADER) === '1'
    const isDev    = process.env['NODE_ENV'] !== 'production'

    // Route matching
    let matched: { route: ResolvedRoute; params: Record<string, string> } | null = null
    for (const { route, cp } of compiled) {
      const params = matchPath(cp, pathname)
      if (params !== null) { matched = { route, params }; break }
    }

    if (!matched) {
      if (config.notFound) {
        const html = await renderToString(createSSRApp(config.notFound))
        return c.html(`<!DOCTYPE html><html lang="en"><body>${html}</body></html>`, 404)
      }
      return c.text('Not Found', 404)
    }

    const { route, params } = matched

    // Expose dynamic params through c.req.param()
    const origParam = c.req.param.bind(c.req);
    (c.req as any)['param'] = (key?: string) =>
      key != null
        ? (params[key] ?? origParam(key))
        : { ...origParam(), ...params }

    // Route-level middleware chain (run in order, short-circuit on early response)
    let earlyResponse: Response | undefined
    let idx = 0
    const runNext = async (): Promise<void> => {
      const mw = route.middleware[idx++]
      if (!mw) return
      const res = await mw(c, runNext)
      if (res instanceof Response && !earlyResponse) earlyResponse = res
    }
    await runNext()
    if (earlyResponse) return earlyResponse

    // Run loader
    const rawData = route.page.loader ? await route.page.loader(c) : {}
    const data    = (rawData ?? {}) as object

    // ── SPA navigation: return JSON only ─────────────────────────────────────
    if (isSPA) {
      const pageSEO = typeof route.page.seo === 'function'
        ? route.page.seo(data as any, params)
        : route.page.seo
      return c.json({
        state:  data,
        params,
        url:    pathname,
        seo:    mergeSEO(config.seo, pageSEO),
      })
    }

    // ── Full SSR: stream HTML response ────────────────────────────────────────
    const clientEntry = config.assets?.manifestEntry ?? 'client.ts'
    const assets = isDev
      ? { scripts: [`/${clientEntry}`], styles: [] as string[] }
      : await resolveAssets(config.assets ?? {}, clientEntry)

    const pageSEO = typeof route.page.seo === 'function'
      ? route.page.seo(data as any, params)
      : route.page.seo
    const seo   = mergeSEO(config.seo, pageSEO)
    const title = seo.title ?? 'Vono'

    const { head, tail } = buildShellParts(
      title,
      buildHeadMeta(seo, config.head),
      JSON.stringify({ [pathname]: data }),
      JSON.stringify(params),
      JSON.stringify(seo),
      assets.scripts,
      assets.styles,
      config.htmlAttrs,
    )

    const body = await renderPage(route, data, pathname, params, config.layout, isDev)

    // Dev: body is a plain string — return a normal buffered HTML response.
    //   @hono/vite-dev-server cannot flush a ReadableStream through Vite's
    //   Connect pipeline; using c.html() avoids the hanging-connection issue.
    if (isDev) {
      return c.html(head + (body as string) + tail, 200)
    }

    // Production: body is a ReadableStream — stream head + body + tail for
    // the lowest possible TTFB.
    const stream = buildResponseStream(head, body as ReadableStream<Uint8Array>, tail)
    return c.body(stream, 200, {
      'Content-Type':           'text/html; charset=UTF-8',
      'Transfer-Encoding':      'chunked',
      'X-Content-Type-Options': 'nosniff',
    })
  })

  return { app, handler: app.fetch.bind(app) }
}

// ── serve() ───────────────────────────────────────────────────────────────────

export type Runtime = 'node' | 'bun' | 'deno' | 'edge'

export function detectRuntime(): Runtime {
  if (typeof (globalThis as any)['Bun']  !== 'undefined') return 'bun'
  if (typeof (globalThis as any)['Deno'] !== 'undefined') return 'deno'
  if (typeof process !== 'undefined' && process.versions?.node) return 'node'
  return 'edge'
}

export interface ServeOptions {
  app:        VonoApp
  port?:      number
  hostname?:  string
  runtime?:   Runtime
  /** Root directory that contains the built assets and public files. */
  staticDir?: string
}

export async function serve(opts: ServeOptions): Promise<void> {
  const runtime     = opts.runtime ?? detectRuntime()
  const port        = opts.port ?? Number(process?.env?.['PORT'] ?? 3000)
  const hostname    = opts.hostname ?? '0.0.0.0'
  const staticDir   = opts.staticDir ?? './dist'
  const displayHost = hostname === '0.0.0.0' ? 'localhost' : hostname
  const logReady    = () => console.log(`\n🔥  Vono [${runtime}] → http://${displayHost}:${port}\n`)

  switch (runtime) {
    case 'node': {
      const [{ serve: nodeServe }, { serveStatic }] = await Promise.all([
        import('@hono/node-server'),
        import('@hono/node-server/serve-static'),
      ])
      opts.app.app.use('/assets/*', serveStatic({ root: staticDir }))
      opts.app.app.use('/*',        serveStatic({ root: './public' }))
      nodeServe({ fetch: opts.app.handler, port, hostname })
      logReady()
      break
    }
    case 'bun':
      ;(globalThis as any)['Bun'].serve({ fetch: opts.app.handler, port, hostname })
      logReady()
      break
    case 'deno':
      ;(globalThis as any)['Deno'].serve({ port, hostname }, opts.app.handler)
      logReady()
      break
    default:
      console.warn('[vono] serve() is a no-op on edge — export vono.handler instead.')
  }
}

// ── Vite plugin ───────────────────────────────────────────────────────────────
//
// Design:
//   • The user's vite.config.ts already includes vue() from @vitejs/plugin-vue.
//     That plugin handles .vue transforms in both dev mode and the server build.
//   • vonoVitePlugin() only handles build orchestration:
//       - `vite build` → server SSR bundle  (dist/server/server.js)
//       - `closeBundle` → client SPA bundle (dist/assets/… + .vite/manifest.json)
//
// This keeps the plugin simple and avoids fragile hook-proxying.

const NODE_BUILTINS =
  /^node:|^(assert|buffer|child_process|cluster|crypto|dgram|dns|domain|events|fs|http|https|module|net|os|path|perf_hooks|process|punycode|querystring|readline|repl|stream|string_decoder|sys|timers|tls|trace_events|tty|url|util|v8|vm|worker_threads|zlib)$/

export interface VonoPluginOptions {
  /** Server entry file.             @default 'server.ts' */
  serverEntry?:    string
  /** Client entry file.             @default 'client.ts' */
  clientEntry?:    string
  /** Server bundle output dir.      @default 'dist/server' */
  serverOutDir?:   string
  /** Client assets output dir.      @default 'dist/assets' */
  clientOutDir?:   string
  /** Extra packages external to the server bundle. */
  serverExternal?: string[]
  /** Options forwarded to @vitejs/plugin-vue in the client build. */
  vueOptions?:     Record<string, unknown>
}

export function vonoVitePlugin(opts: VonoPluginOptions = {}): Plugin {
  const {
    serverEntry    = 'server.ts',
    clientEntry    = 'client.ts',
    serverOutDir   = 'dist/server',
    clientOutDir   = 'dist/assets',
    serverExternal = [],
    vueOptions     = {},
  } = opts

  return {
    name:    'vono:build',
    apply:   'build',
    enforce: 'pre',

    // Server (SSR) bundle configuration.
    //
    // target: 'node18' is essential — it tells esbuild to emit ES2022+ syntax
    // which includes top-level await.  Without it, esbuild defaults to a
    // browser-compatible target ("chrome87", "es2020", …) that does NOT support
    // top-level await, causing the build to fail with:
    //   "Top-level await is not available in the configured target environment"
    config(): Omit<UserConfig, 'plugins'> {
      return {
        build: {
          ssr:    serverEntry,
          outDir: serverOutDir,
          // ↓ CRITICAL — enables top-level await in the server bundle
          target: 'node18',
          rollupOptions: {
            input:  serverEntry,
            output: { format: 'es', entryFileNames: 'server.js' },
            external: (id: string) =>
              NODE_BUILTINS.test(id)
              || id === 'vue' || id.startsWith('vue/')
              || id === 'vue-router'
              || id === '@vue/server-renderer'
              || id === '@vitejs/plugin-vue'
              || id === '@hono/node-server'
              || id === '@hono/node-server/serve-static'
              || serverExternal.includes(id),
          },
        },
      }
    },

    // After the server bundle is written, trigger the client SPA build
    async closeBundle() {
      console.log('\n⚡  Vono: building client bundle…\n')

      let vuePlugin: Plugin | Plugin[]
      try {
        const mod = await import('@vitejs/plugin-vue' as string)
        const factory = (mod.default ?? mod) as (opts?: Record<string, unknown>) => Plugin | Plugin[]
        vuePlugin = factory(vueOptions)
      } catch {
        throw new Error(
          '[vono] @vitejs/plugin-vue is required for the client build.\n' +
          '  Install: npm i -D @vitejs/plugin-vue',
        )
      }

      const plugins = (
        Array.isArray(vuePlugin) ? vuePlugin : [vuePlugin]
      ) as NonNullable<InlineConfig['plugins']>

      await build({
        configFile: false as const,
        plugins,
        build: {
          outDir:   clientOutDir,
          // Vite 5+ writes manifest to <outDir>/.vite/manifest.json
          manifest: true,
          rollupOptions: {
            input:  clientEntry,
            output: {
              format:         'es',
              entryFileNames: '[name]-[hash].js',
              chunkFileNames: '[name]-[hash].js',
              assetFileNames: '[name]-[hash][extname]',
            },
          },
        },
      })

      console.log('✅  Vono: both bundles ready\n')
    },
  }
}

// ── Re-exports ────────────────────────────────────────────────────────────────

export {
  definePage, defineGroup, defineLayout, defineApiRoute, isAsyncLoader,
  resolveRoutes, compilePath, matchPath, toVueRouterPath,
  SPA_HEADER, STATE_KEY, PARAMS_KEY, SEO_KEY, DATA_KEY,
} from './core'

export type {
  AppConfig, PageDef, GroupDef, LayoutDef, ApiRouteDef, Route,
  SEOMeta, HonoMiddleware, LoaderCtx, ResolvedRoute, CompiledPath,
  ClientMiddleware, AsyncLoader, InferPageData,
} from './core'
