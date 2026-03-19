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
// vite-plugin-solid is a peer dep — marked external in tsup.
// At runtime it resolves from the user's node_modules.
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
  const name = (n: string, v?: string) =>
    v ? `<meta name="${n}" content="${esc(v)}">` : ''
  const prop = (p: string, v?: string) =>
    v ? `<meta property="${p}" content="${esc(v)}">` : ''
  const link = (rel: string, href: string) =>
    `<link rel="${rel}" href="${esc(href)}">`

  const parts: string[] = []

  // Basic
  if (seo.description) parts.push(name('description', seo.description))
  if (seo.keywords)    parts.push(name('keywords',    seo.keywords))
  if (seo.author)      parts.push(name('author',       seo.author))
  if (seo.robots)      parts.push(name('robots',       seo.robots))
  if (seo.themeColor)  parts.push(name('theme-color',  seo.themeColor))
  if (seo.canonical)   parts.push(link('canonical',    seo.canonical))

  // Open Graph
  if (seo.ogTitle)       parts.push(prop('og:title',       seo.ogTitle))
  if (seo.ogDescription) parts.push(prop('og:description', seo.ogDescription))
  if (seo.ogImage)       parts.push(prop('og:image',       seo.ogImage))
  if (seo.ogImageAlt)    parts.push(prop('og:image:alt',   seo.ogImageAlt))
  if (seo.ogImageWidth)  parts.push(prop('og:image:width', seo.ogImageWidth))
  if (seo.ogImageHeight) parts.push(prop('og:image:height',seo.ogImageHeight))
  if (seo.ogUrl)         parts.push(prop('og:url',         seo.ogUrl))
  if (seo.ogType)        parts.push(prop('og:type',        seo.ogType))
  if (seo.ogSiteName)    parts.push(prop('og:site_name',   seo.ogSiteName))
  if (seo.ogLocale)      parts.push(prop('og:locale',      seo.ogLocale))

  // Twitter / X
  if (seo.twitterCard)        parts.push(name('twitter:card',        seo.twitterCard))
  if (seo.twitterSite)        parts.push(name('twitter:site',        seo.twitterSite))
  if (seo.twitterCreator)     parts.push(name('twitter:creator',     seo.twitterCreator))
  if (seo.twitterTitle)       parts.push(name('twitter:title',       seo.twitterTitle))
  if (seo.twitterDescription) parts.push(name('twitter:description', seo.twitterDescription))
  if (seo.twitterImage)       parts.push(name('twitter:image',       seo.twitterImage))
  if (seo.twitterImageAlt)    parts.push(name('twitter:image:alt',   seo.twitterImageAlt))

  // Extra arbitrary tags
  for (const m of seo.extra ?? []) {
    const attrs = [
      m.name      ? `name="${esc(m.name)}"` : '',
      m.property  ? `property="${esc(m.property)}"` : '',
      m.httpEquiv ? `http-equiv="${esc(m.httpEquiv)}"` : '',
      `content="${esc(m.content)}"`,
    ].filter(Boolean).join(' ')
    parts.push(`<meta ${attrs}>`)
  }

  // JSON-LD
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

function mergeSEO(base: SEOMeta | undefined, override: SEOMeta | undefined): SEOMeta {
  return { ...(base ?? {}), ...(override ?? {}) }
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 3  Asset resolution — dev vs production
// ══════════════════════════════════════════════════════════════════════════════

export interface AssetConfig {
  /** Explicit script URLs to inject. */
  scripts?: string[]
  /** Explicit stylesheet URLs to inject. */
  styles?:  string[]
  /**
   * Directory containing the Vite manifest (`manifest.json`).
   * When set, filenames are resolved from the manifest (hashed filenames).
   * Typically the same as `clientOutDir`.
   */
  manifestDir?:   string
  /** Key in the manifest corresponding to the client entry.  Defaults to `'client.ts'`. */
  manifestEntry?: string
}

interface ResolvedAssets { scripts: string[]; styles: string[] }

let _assets: ResolvedAssets | null = null

function resolveAssets(cfg: AssetConfig, defaultEntry: string): ResolvedAssets {
  if (_assets) return _assets

  if (cfg.manifestDir) {
    try {
      // Node/Bun only — edge runtimes should use explicit `scripts`/`styles`.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { readFileSync } = require('node:fs')
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { join } = require('node:path')
      const manifest = JSON.parse(
        readFileSync(join(cfg.manifestDir, 'manifest.json'), 'utf-8'),
      ) as Record<string, { file: string; css?: string[] }>

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
    } catch { /* fall through */ }
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

  // generateHydrationScript() returns a <script> tag string
  const hydrationScript = generateHydrationScript()

  return [
    `<!DOCTYPE html>`,
    `<html ${htmlAttrStr}>`,
    `<head>`,
    `<meta charset="UTF-8">`,
    `<meta name="viewport" content="width=device-width,initial-scale=1">`,
    `<title>${esc(o.title)}</title>`,
    o.metaHtml,
    hydrationScript,
    styleLinks,
    `</head>`,
    `<body>`,
    `<div id="fnetro-app">${o.bodyHtml}</div>`,
    `<script>`,
    `window.${STATE_KEY}=${o.stateJson};`,
    `window.${PARAMS_KEY}=${o.paramsJson};`,
    `window.${SEO_KEY}=${o.seoJson};`,
    `</script>`,
    scriptTags,
    `</body>`,
    `</html>`,
  ]
    .filter(Boolean)
    .join('\n')
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 5  SolidJS SSR renderer
// ══════════════════════════════════════════════════════════════════════════════

async function renderPage(
  route:     ResolvedRoute,
  data:      object,
  url:       string,
  params:    Record<string, string>,
  appLayout: LayoutDef | undefined,
): Promise<string> {
  const layout = route.layout !== undefined ? route.layout : appLayout

  return renderToStringAsync(() => {
    const pageEl = createComponent(route.page.Page as any, { ...data, url, params })
    if (!layout) return pageEl as any

    return createComponent(layout.Component as any, {
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
   * In dev mode `@hono/vite-dev-server` injects assets — this is ignored.
   */
  assets?: AssetConfig
}

export interface FNetroApp {
  /** The Hono instance — attach custom routes, error handlers, etc. */
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

  // Register API sub-apps
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
        const html = await renderToStringAsync(() =>
          createComponent(config.notFound as any, {}) as any,
        )
        return c.html(
          `<!DOCTYPE html><html lang="en"><body>${html}</body></html>`,
          404,
        )
      }
      return c.text('Not Found', 404)
    }

    const { route, params } = matched

    // Expose params through c.req.param()
    const _origParam = c.req.param.bind(c.req);
    (c.req as any)['param'] = (key?: string) =>
      key != null
        ? (params[key] ?? _origParam(key))
        : { ..._origParam(), ...params }

    // Run route-level middleware chain
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

    // Run data loader
    const rawData  = route.page.loader ? await route.page.loader(c) : {}
    const data     = (rawData ?? {}) as object

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

    // Full SSR — resolve assets once per process lifetime
    const assets = isDev
      ? { scripts: [], styles: [] }  // Vite dev server injects assets
      : resolveAssets(
          config.assets ?? {},
          config.assets?.manifestEntry ?? 'client.ts',
        )

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
  /** Root directory for static file serving.  @default './dist' */
  staticDir?: string
}

export async function serve(opts: ServeOptions): Promise<void> {
  const runtime  = opts.runtime ?? detectRuntime()
  const port     = opts.port ?? Number(process?.env?.['PORT'] ?? 3000)
  const hostname = opts.hostname ?? '0.0.0.0'
  const staticDir = opts.staticDir ?? './dist'
  const displayHost = hostname === '0.0.0.0' ? 'localhost' : hostname
  const logReady = () =>
    console.log(`\n🔥  FNetro [${runtime}] ready → http://${displayHost}:${port}\n`)

  switch (runtime) {
    case 'node': {
      const [{ serve: nodeServe }, { serveStatic }] = await Promise.all([
        import('@hono/node-server'),
        import('@hono/node-server/serve-static'),
      ])
      // Serve built client assets and public/ directory
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
  /** Server entry file.  @default `'app/server.ts'` */
  serverEntry?:    string
  /** Client entry file.  @default `'client.ts'` */
  clientEntry?:    string
  /** Server bundle output directory.  @default `'dist/server'` */
  serverOutDir?:   string
  /** Client assets output directory.  @default `'dist/assets'` */
  clientOutDir?:   string
  /** Additional packages to mark external in the server bundle. */
  serverExternal?: string[]
  /** Extra options forwarded to `vite-plugin-solid`. */
  solidOptions?:   Record<string, unknown>
}

/**
 * Load vite-plugin-solid at call time.
 * Throws a clear error if the peer dep is not installed.
 */
async function loadSolid(): Promise<(opts?: Record<string, unknown>) => Plugin | Plugin[]> {
  try {
    const mod = await import('vite-plugin-solid' as string)
    return (mod.default ?? mod) as (opts?: Record<string, unknown>) => Plugin | Plugin[]
  } catch {
    throw new Error(
      '[fnetro] vite-plugin-solid is required. Install it:\n  npm i -D vite-plugin-solid',
    )
  }
}

function flatPlugins(result: Plugin | Plugin[]): Plugin[] {
  return Array.isArray(result) ? result : [result]
}

/**
 * FNetro Vite plugin.
 *
 * Handles:
 * - JSX transform (vite-plugin-solid, SSR-aware)
 * - Server SSR build
 * - Client bundle build (with `manifest.json` for hashed asset URLs)
 *
 * @example
 * // vite.config.ts
 * import { fnetroVitePlugin } from 'fnetro/vite'
 * export default defineConfig({ plugins: [fnetroVitePlugin()] })
 */
export function fnetroVitePlugin(opts: FNetroPluginOptions = {}): Plugin[] {
  const {
    serverEntry  = 'app/server.ts',
    clientEntry  = 'client.ts',
    serverOutDir = 'dist/server',
    clientOutDir = 'dist/assets',
    serverExternal = [],
    solidOptions   = {},
  } = opts

  // ── Solid JSX plugin (SSR mode) — applies to main (server) build ──────────
  // We create it lazily inside configResolved so we can use async loading.
  // For the dev server build Vite merges all plugins, so we return it directly.

  let _solidPlugins: Plugin[] = []

  const solidSetupPlugin: Plugin = {
    name:    'fnetro:solid-setup',
    enforce: 'pre',

    async buildStart() {
      if (_solidPlugins.length === 0) {
        const solid = await loadSolid()
        _solidPlugins = flatPlugins(solid({ ssr: true, ...solidOptions }))
      }
    },
  }

  // ── Dev server JSX setup ─────────────────────────────────────────────────
  // We expose a synchronous plugin that delegates to the loaded solid plugin
  // hooks so that the dev server gets JSX transforms.
  const solidJsxPlugin: Plugin = {
    name:    'fnetro:solid-jsx',
    enforce: 'pre',

    config(cfg: UserConfig, _env: ConfigEnv): Omit<UserConfig, 'plugins'> | null {
      // Tell Vite to use SolidJS JSX via esbuild (works in dev and legacy build)
      return {
        esbuild: {
          jsx:             'automatic',
          jsxImportSource: 'solid-js',
        },
      }
    },

    resolveId: {
      order:   'pre',
      handler(id, importer, options) {
        const hook = _solidPlugins[0]?.resolveId
        if (!hook) return null
        const handler = typeof hook === 'function' ? hook : hook.handler
        return handler.call(this as any, id, importer, options)
      },
    },

    load: {
      order:   'pre',
      handler(id, options) {
        const hook = _solidPlugins[0]?.load
        if (!hook) return null
        const handler = typeof hook === 'function' ? hook : hook.handler
        return handler.call(this as any, id, options)
      },
    },

    transform: {
      order:   'pre',
      handler(code, id, options) {
        const hook = _solidPlugins[0]?.transform
        if (!hook) return null
        const handler = typeof hook === 'function' ? hook : hook.handler
        return handler.call(this as any, code, id, options)
      },
    },
  }

  // ── Server (SSR) build plugin ─────────────────────────────────────────────
  const serverBuildPlugin: Plugin = {
    name:    'fnetro:server-build',
    apply:   'build',
    enforce: 'pre',

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

      const solid = await loadSolid()
      const { build } = await import('vite')

      await (build as (c: InlineConfig) => Promise<unknown>)({
        configFile: false,
        plugins:    flatPlugins(solid({ ...solidOptions })) as InlineConfig['plugins'],
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

  return [solidSetupPlugin, solidJsxPlugin, serverBuildPlugin]
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
