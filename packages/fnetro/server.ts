// ─────────────────────────────────────────────────────────────────────────────
//  FNetro · server.ts
//  Hono app factory · SolidJS SSR · SEO head · asset manifest · Vite plugin
// ─────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono'
import { createComponent } from 'solid-js'
import { renderToStringAsync, generateHydrationScript } from 'solid-js/web'
import {
  resolveRoutes, compilePath, matchPath,
  SPA_HEADER, STATE_KEY, PARAMS_KEY, SEO_KEY,
  type AppConfig, type ResolvedRoute, type LayoutDef,
  type SEOMeta, type HonoMiddleware,
} from './core'
import type { Plugin, UserConfig, ConfigEnv, InlineConfig } from 'vite'

// ══════════════════════════════════════════════════════════════════════════════
//  § 1  HTML helpers
// ══════════════════════════════════════════════════════════════════════════════

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 2  SEO → <head> HTML
// ══════════════════════════════════════════════════════════════════════════════

function buildHeadMeta(seo: SEOMeta, extraHead = ''): string {
  const m  = (n: string, v?: string)  => v ? `<meta name="${n}" content="${esc(v)}">` : ''
  const p  = (pr: string, v?: string) => v ? `<meta property="${pr}" content="${esc(v)}">` : ''
  const lk = (rel: string, href: string) => `<link rel="${rel}" href="${esc(href)}">`

  const parts: string[] = []

  // Basic
  if (seo.description) parts.push(m('description', seo.description))
  if (seo.keywords)    parts.push(m('keywords',    seo.keywords))
  if (seo.author)      parts.push(m('author',       seo.author))
  if (seo.robots)      parts.push(m('robots',       seo.robots))
  if (seo.themeColor)  parts.push(m('theme-color',  seo.themeColor))
  if (seo.canonical)   parts.push(lk('canonical',   seo.canonical))

  // Open Graph
  if (seo.ogTitle)        parts.push(p('og:title',        seo.ogTitle))
  if (seo.ogDescription)  parts.push(p('og:description',  seo.ogDescription))
  if (seo.ogImage)        parts.push(p('og:image',        seo.ogImage))
  if (seo.ogImageAlt)     parts.push(p('og:image:alt',    seo.ogImageAlt))
  if (seo.ogImageWidth)   parts.push(p('og:image:width',  seo.ogImageWidth))
  if (seo.ogImageHeight)  parts.push(p('og:image:height', seo.ogImageHeight))
  if (seo.ogUrl)          parts.push(p('og:url',          seo.ogUrl))
  if (seo.ogType)         parts.push(p('og:type',         seo.ogType))
  if (seo.ogSiteName)     parts.push(p('og:site_name',    seo.ogSiteName))
  if (seo.ogLocale)       parts.push(p('og:locale',       seo.ogLocale))

  // Twitter / X
  if (seo.twitterCard)         parts.push(m('twitter:card',        seo.twitterCard))
  if (seo.twitterSite)         parts.push(m('twitter:site',        seo.twitterSite))
  if (seo.twitterCreator)      parts.push(m('twitter:creator',     seo.twitterCreator))
  if (seo.twitterTitle)        parts.push(m('twitter:title',       seo.twitterTitle))
  if (seo.twitterDescription)  parts.push(m('twitter:description', seo.twitterDescription))
  if (seo.twitterImage)        parts.push(m('twitter:image',       seo.twitterImage))
  if (seo.twitterImageAlt)     parts.push(m('twitter:image:alt',   seo.twitterImageAlt))

  // Arbitrary extra <meta> tags
  for (const tag of seo.extra ?? []) {
    const attrs = [
      tag.name      ? `name="${esc(tag.name)}"` : '',
      tag.property  ? `property="${esc(tag.property)}"` : '',
      tag.httpEquiv ? `http-equiv="${esc(tag.httpEquiv)}"` : '',
      `content="${esc(tag.content)}"`,
    ].filter(Boolean).join(' ')
    parts.push(`<meta ${attrs}>`)
  }

  // JSON-LD structured data
  const ld = seo.jsonLd
  if (ld) {
    const schemas = Array.isArray(ld) ? ld : [ld]
    for (const schema of schemas) {
      parts.push(`<script type="application/ld+json">${JSON.stringify(schema)}</script>`)
    }
  }

  if (extraHead) parts.push(extraHead)
  return parts.join('\n')
}

function mergeSEO(base: SEOMeta | undefined, override: SEOMeta | undefined): SEOMeta {
  return { ...(base ?? {}), ...(override ?? {}) }
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 3  Asset resolution — dev vs production
// ══════════════════════════════════════════════════════════════════════════════

export interface AssetConfig {
  /** Explicit script URLs injected into every HTML page. */
  scripts?:       string[]
  /** Explicit stylesheet URLs injected into every HTML page. */
  styles?:        string[]
  /**
   * Directory that contains the Vite-generated `manifest.json`.
   * When provided, asset URLs are resolved from the manifest so hashed
   * filenames work correctly.  Typically equals `clientOutDir`.
   */
  manifestDir?:   string
  /**
   * Key in the manifest corresponding to the client entry file.
   * @default `'client.ts'`
   */
  manifestEntry?: string
}

interface ResolvedAssets { scripts: string[]; styles: string[] }

// Process-lifetime cache — resolved once on first request.
let _assets: ResolvedAssets | null = null

/**
 * Read the Vite manifest to resolve hashed asset filenames.
 * Uses dynamic `import()` so this never runs at module-load time and
 * never adds a hard dependency on `node:fs` for edge runtimes.
 * Falls back to explicit `cfg.scripts` / `cfg.styles` on any error.
 */
async function resolveAssets(
  cfg:          AssetConfig,
  defaultEntry: string,
): Promise<ResolvedAssets> {
  if (_assets) return _assets

  if (cfg.manifestDir) {
    try {
      // Dynamic imports — safe to use in any ESM environment.
      // node:fs and node:path are marked external by tsup and never bundled.
      const [{ readFileSync }, { join }] = await Promise.all([
        import('node:fs'),
        import('node:path'),
      ])
      const raw      = readFileSync(join(cfg.manifestDir, 'manifest.json'), 'utf-8')
      const manifest = JSON.parse(raw) as Record<string, { file: string; css?: string[] }>
      const entryKey =
        cfg.manifestEntry ??
        Object.keys(manifest).find(k => k.endsWith(defaultEntry)) ??
        defaultEntry
      const entry = manifest[entryKey]
      if (entry) {
        _assets = {
          scripts: [`/assets/${entry.file}`],
          styles:  (entry.css ?? []).map((f: string) => `/assets/${f}`),
        }
        return _assets
      }
    } catch { /* edge runtime or manifest not found — fall through */ }
  }

  _assets = {
    scripts: cfg.scripts ?? ['/assets/client.js'],
    styles:  cfg.styles  ?? [],
  }
  return _assets
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 4  HTML shell
// ══════════════════════════════════════════════════════════════════════════════

interface ShellOpts {
  title:      string
  metaHtml:   string
  bodyHtml:   string
  stateJson:  string
  paramsJson: string
  seoJson:    string
  scripts:    string[]
  styles:     string[]
  htmlAttrs?: Record<string, string>
}

function buildShell(o: ShellOpts): string {
  const htmlAttrStr = Object.entries(o.htmlAttrs ?? { lang: 'en' })
    .map(([k, v]) => `${k}="${esc(v)}"`)
    .join(' ')

  const styleLinks = o.styles
    .map(href => `<link rel="stylesheet" href="${esc(href)}">`)
    .join('\n')

  const scriptTags = o.scripts
    .map(src => `<script type="module" src="${esc(src)}"></script>`)
    .join('\n')

  return [
    '<!DOCTYPE html>',
    `<html ${htmlAttrStr}>`,
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${esc(o.title)}</title>`,
    o.metaHtml,
    generateHydrationScript(),
    styleLinks,
    '</head>',
    '<body>',
    `<div id="fnetro-app">${o.bodyHtml}</div>`,
    '<script>',
    `window.${STATE_KEY}=${o.stateJson};`,
    `window.${PARAMS_KEY}=${o.paramsJson};`,
    `window.${SEO_KEY}=${o.seoJson};`,
    '</script>',
    scriptTags,
    '</body>',
    '</html>',
  ]
    .filter(Boolean)
    .join('\n')
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 5  SolidJS SSR renderer
// ══════════════════════════════════════════════════════════════════════════════

type AnyComponent = Parameters<typeof createComponent>[0]

async function renderPage(
  route:     ResolvedRoute,
  data:      object,
  url:       string,
  params:    Record<string, string>,
  appLayout: LayoutDef | undefined,
): Promise<string> {
  const layout = route.layout !== undefined ? route.layout : appLayout

  return renderToStringAsync(() => {
    const pageEl = createComponent(route.page.Page as AnyComponent, { ...data, url, params })
    if (!layout) return pageEl as any

    return createComponent(layout.Component as AnyComponent, {
      url,
      params,
      get children() { return pageEl },
    }) as any
  })
}

async function renderFullPage(
  route:   ResolvedRoute,
  data:    object,
  url:     string,
  params:  Record<string, string>,
  config:  AppConfig,
  assets:  ResolvedAssets,
): Promise<string> {
  const pageSEO = typeof route.page.seo === 'function'
    ? route.page.seo(data as any, params)
    : route.page.seo
  const seo   = mergeSEO(config.seo, pageSEO)
  const title = seo.title ?? 'FNetro'

  const bodyHtml = await renderPage(route, data, url, params, config.layout)

  return buildShell({
    title,
    metaHtml:   buildHeadMeta(seo, config.head),
    bodyHtml,
    stateJson:  JSON.stringify({ [url]: data }),
    paramsJson: JSON.stringify(params),
    seoJson:    JSON.stringify(seo),
    scripts:    assets.scripts,
    styles:     assets.styles,
    htmlAttrs:  config.htmlAttrs,
  })
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 6  createFNetro
// ══════════════════════════════════════════════════════════════════════════════

export interface FNetroOptions extends AppConfig {
  /**
   * Production asset configuration.
   * In dev mode `@hono/vite-dev-server` injects assets automatically — ignored.
   */
  assets?: AssetConfig
}

export interface FNetroApp {
  /** The underlying Hono instance — attach custom routes, error handlers, etc. */
  app:     Hono
  /** Fetch handler for edge runtimes */
  handler: typeof Hono.prototype.fetch
}

export function createFNetro(config: FNetroOptions): FNetroApp {
  const app = new Hono()

  // Global middleware
  for (const mw of config.middleware ?? []) app.use('*', mw)

  const { pages, apis } = resolveRoutes(config.routes, {
    layout:     config.layout,
    middleware: [],
  })

  // Pre-compile all route paths
  const compiled = pages.map(r => ({ route: r, cp: compilePath(r.fullPath) }))

  // Register API sub-apps before the catch-all page handler
  for (const api of apis) {
    const sub = new Hono()
    api.register(sub, config.middleware ?? [])
    app.route(api.path, sub)
  }

  // Catch-all page handler — must come AFTER API routes
  app.all('*', async (c) => {
    const url      = new URL(c.req.url)
    const pathname = url.pathname
    const isSPA    = c.req.header(SPA_HEADER) === '1'
    const isDev    = process.env['NODE_ENV'] !== 'production'

    // Match route
    let matched: { route: ResolvedRoute; params: Record<string, string> } | null = null
    for (const { route, cp } of compiled) {
      const params = matchPath(cp, pathname)
      if (params !== null) { matched = { route, params }; break }
    }

    if (!matched) {
      if (config.notFound) {
        const html = await renderToStringAsync(
          () => createComponent(config.notFound as AnyComponent, {}) as any,
        )
        return c.html(
          `<!DOCTYPE html><html lang="en"><body>${html}</body></html>`,
          404,
        )
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

    // Route-level middleware chain (Hono onion model)
    let early: Response | undefined
    const handlers = [...route.middleware]
    let idx = 0
    const runNext = async (): Promise<void> => {
      const mw = handlers[idx++]
      if (!mw) return
      const res = await mw(c, runNext)
      if (res instanceof Response && !early) early = res
    }
    await runNext()
    if (early) return early

    // Run loader
    const rawData = route.page.loader ? await route.page.loader(c) : {}
    const data    = (rawData ?? {}) as object

    if (isSPA) {
      // SPA navigation — return JSON payload only
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

    // Full SSR — resolve assets
    // Dev:  inject the client entry as a module script.  Vite intercepts the
    //       request, applies the SolidJS transform, and injects HMR.
    //       @hono/vite-dev-server only adds /@vite/client — it does NOT add
    //       your app's client.ts, so we must do it here.
    // Prod: read hashed filenames from the Vite manifest.
    const clientEntry = config.assets?.manifestEntry ?? 'client.ts'
    const assets = isDev
      ? { scripts: [`/${clientEntry}`], styles: [] }
      : await resolveAssets(config.assets ?? {}, clientEntry)

    const html = await renderFullPage(route, data, pathname, params, config, assets)
    return c.html(html)
  })

  return { app, handler: app.fetch.bind(app) }
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 7  Multi-runtime serve()
// ══════════════════════════════════════════════════════════════════════════════

export type Runtime = 'node' | 'bun' | 'deno' | 'edge'

export function detectRuntime(): Runtime {
  if (typeof (globalThis as any)['Bun']  !== 'undefined') return 'bun'
  if (typeof (globalThis as any)['Deno'] !== 'undefined') return 'deno'
  if (typeof process !== 'undefined' && process.versions?.node) return 'node'
  return 'edge'
}

export interface ServeOptions {
  app:        FNetroApp
  port?:      number
  hostname?:  string
  runtime?:   Runtime
  /** Root directory for static file serving.  @default `'./dist'` */
  staticDir?: string
}

export async function serve(opts: ServeOptions): Promise<void> {
  const runtime     = opts.runtime ?? detectRuntime()
  const port        = opts.port ?? Number(process?.env?.['PORT'] ?? 3000)
  const hostname    = opts.hostname ?? '0.0.0.0'
  const staticDir   = opts.staticDir ?? './dist'
  const displayHost = hostname === '0.0.0.0' ? 'localhost' : hostname

  const logReady = () =>
    console.log(`\n🔥  FNetro [${runtime}] ready → http://${displayHost}:${port}\n`)

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
    case 'bun': {
      ;(globalThis as any)['Bun'].serve({ fetch: opts.app.handler, port, hostname })
      logReady()
      break
    }
    case 'deno': {
      ;(globalThis as any)['Deno'].serve({ port, hostname }, opts.app.handler)
      logReady()
      break
    }
    default:
      console.warn(
        '[fnetro] serve() is a no-op on edge runtimes — export `fnetro.handler` instead.',
      )
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 8  Vite plugin
// ══════════════════════════════════════════════════════════════════════════════

const NODE_BUILTINS =
  /^node:|^(assert|buffer|child_process|cluster|crypto|dgram|dns|domain|events|fs|http|https|module|net|os|path|perf_hooks|process|punycode|querystring|readline|repl|stream|string_decoder|sys|timers|tls|trace_events|tty|url|util|v8|vm|worker_threads|zlib)$/

export interface FNetroPluginOptions {
  /** Server entry file.   @default `'server.ts'` */
  serverEntry?:    string
  /** Client entry file.   @default `'client.ts'` */
  clientEntry?:    string
  /** Server bundle output directory.   @default `'dist/server'` */
  serverOutDir?:   string
  /** Client assets output directory.   @default `'dist/assets'` */
  clientOutDir?:   string
  /** Extra packages to mark external in the server bundle. */
  serverExternal?: string[]
  /** Extra options forwarded to `vite-plugin-solid`. */
  solidOptions?:   Record<string, unknown>
}

type SolidFactory = (opts?: Record<string, unknown>) => Plugin | Plugin[]

async function loadSolid(): Promise<SolidFactory> {
  try {
    const mod = await import('vite-plugin-solid' as string)
    return (mod.default ?? mod) as SolidFactory
  } catch {
    throw new Error(
      '[fnetro] vite-plugin-solid is required.\n  Install it: npm i -D vite-plugin-solid',
    )
  }
}

function toPlugins(v: Plugin | Plugin[]): Plugin[] {
  return Array.isArray(v) ? v : [v]
}

export function fnetroVitePlugin(opts: FNetroPluginOptions = {}): Plugin[] {
  const {
    serverEntry  = 'server.ts',
    clientEntry  = 'client.ts',
    serverOutDir = 'dist/server',
    clientOutDir = 'dist/assets',
    serverExternal = [],
    solidOptions   = {},
  } = opts

  let _solid: SolidFactory | null = null
  let _solidPlugins: Plugin[] = []

  // ── Plugin 1: JSX config + lazy solid plugin load ─────────────────────────
  const jsxPlugin: Plugin = {
    name:    'fnetro:jsx',
    enforce: 'pre',

    // Sync config hook — must return Omit<UserConfig, 'plugins'> | null
    config(_cfg: UserConfig, _env: ConfigEnv): Omit<UserConfig, 'plugins'> | null {
      return {
        esbuild: {
          jsx:             'automatic',
          jsxImportSource: 'solid-js',
        },
      }
    },

    async buildStart() {
      if (!_solid) {
        _solid = await loadSolid()
        // ssr: true tells vite-plugin-solid to output hydratable markup
        _solidPlugins = toPlugins(_solid({ ssr: true, ...solidOptions }))
      }
    },
  }

  // ── Plugin 2: proxy solid transform hooks ────────────────────────────────
  const solidProxy: Plugin = {
    name:    'fnetro:solid-proxy',
    enforce: 'pre',

    async transform(code: string, id: string, options?: { ssr?: boolean }) {
      if (!_solidPlugins[0]?.transform) return null
      const hook = _solidPlugins[0].transform
      const fn   = typeof hook === 'function' ? hook : (hook as any).handler
      if (!fn) return null
      return (fn as Function).call(this as any, code, id, options)
    },

    async resolveId(id: string) {
      if (!_solidPlugins[0]?.resolveId) return null
      const hook = _solidPlugins[0].resolveId
      const fn   = typeof hook === 'function' ? hook : (hook as any).handler
      if (!fn) return null
      return (fn as Function).call(this as any, id, undefined, {})
    },

    async load(id: string) {
      if (!_solidPlugins[0]?.load) return null
      const hook = _solidPlugins[0].load
      const fn   = typeof hook === 'function' ? hook : (hook as any).handler
      if (!fn) return null
      return (fn as Function).call(this as any, id, {})
    },
  }

  // ── Plugin 3: server SSR build + client build trigger ────────────────────
  const buildPlugin: Plugin = {
    name:    'fnetro:build',
    apply:   'build',
    enforce: 'pre',

    // Sync config hook — Omit<UserConfig, 'plugins'> satisfies the ObjectHook constraint
    config(_cfg: UserConfig, _env: ConfigEnv): Omit<UserConfig, 'plugins'> {
      return {
        build: {
          ssr:    serverEntry,
          outDir: serverOutDir,
          rollupOptions: {
            input:  serverEntry,
            output: {
              format:         'es',
              entryFileNames: 'server.js',
            },
            external: (id: string) =>
              NODE_BUILTINS.test(id) ||
              id === '@hono/node-server' ||
              id === '@hono/node-server/serve-static' ||
              serverExternal.includes(id),
          },
        },
      }
    },

    async closeBundle() {
      console.log('\n⚡  FNetro: building client bundle…\n')

      const solid = _solid ?? await loadSolid()
      const { build } = await import('vite')

      // Client build — no SSR flag, solid compiles reactive primitives normally
      await (build as (c: InlineConfig) => Promise<unknown>)({
        configFile: false,
        plugins:    toPlugins(solid({ ...solidOptions })) as InlineConfig['plugins'],
        build: {
          outDir:   clientOutDir,
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

      console.log('✅  FNetro: both bundles ready\n')
    },
  }

  return [jsxPlugin, solidProxy, buildPlugin]
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 9  Re-exports
// ══════════════════════════════════════════════════════════════════════════════

export {
  definePage, defineGroup, defineLayout, defineApiRoute,
  resolveRoutes, compilePath, matchPath,
  SPA_HEADER, STATE_KEY, PARAMS_KEY, SEO_KEY,
} from './core'

export type {
  AppConfig, PageDef, GroupDef, LayoutDef, ApiRouteDef, Route,
  PageProps, LayoutProps, SEOMeta, HonoMiddleware, LoaderCtx,
  ResolvedRoute, CompiledPath, ClientMiddleware,
} from './core'
