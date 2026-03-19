// ─────────────────────────────────────────────────────────────────────────────
//  FNetro · server.ts
//  Hono server integration · SSR renderer · Vite plugin (dual-build)
// ─────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono'
import { jsx } from 'hono/jsx'
import { renderToString } from 'hono/jsx/dom/server'
import {
  resolveRoutes,
  SPA_HEADER, STATE_KEY, PARAMS_KEY,
  type AppConfig, type ResolvedRoute, type LayoutDef,
  type PageDef, type ApiRouteDef,
} from './core'
import type { Plugin, InlineConfig } from 'vite'
import type { MiddlewareHandler } from 'hono'

// ══════════════════════════════════════════════════════════════════════════════
//  § 1  Path matching
// ══════════════════════════════════════════════════════════════════════════════

interface CompiledPath {
  re: RegExp
  keys: string[]
  original: string
}

function compilePath(path: string): CompiledPath {
  const keys: string[] = []
  const src = path
    .replace(/\[\.\.\.([^\]]+)\]/g, (_: string, k: string) => { keys.push(k); return '(.*)' })  // [...slug]
    .replace(/\[([^\]]+)\]/g, (_: string, k: string) => { keys.push(k); return '([^/]+)' })      // [id]
    .replace(/\*/g, '(.*)')
  return { re: new RegExp(`^${src}$`), keys, original: path }
}

function matchPath(compiled: CompiledPath, pathname: string): Record<string, string> | null {
  const m = pathname.match(compiled.re)
  if (!m) return null
  const params: Record<string, string> = {}
  compiled.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]) })
  return params
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 2  SSR Renderer
// ══════════════════════════════════════════════════════════════════════════════
//  § 2  SSR Renderer
// ══════════════════════════════════════════════════════════════════════════════

/** Build the outer HTML shell as a plain string — faster than JSX for static structure */
function buildShell(opts: {
  title: string
  stateJson: string
  paramsJson: string
  pageHtml: string
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(opts.title)}</title>
<link rel="stylesheet" href="/assets/style.css">
</head>
<body>
<div id="fnetro-app">${opts.pageHtml}</div>
<script>window.${STATE_KEY}=${opts.stateJson};window.${PARAMS_KEY}=${opts.paramsJson};</script>
<script type="module" src="/client.ts"></script>
</body>
</html>`
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

async function renderInner(
  route: ResolvedRoute,
  data: object,
  url: string,
  params: Record<string, string>,
  appLayout: LayoutDef | undefined
): Promise<string> {
  const pageNode = (jsx as any)(route.page.Page, { ...data, url, params })

  const layout = route.layout !== undefined ? route.layout : appLayout
  const wrapped = layout
    ? (jsx as any)(layout.Component, { url, params, children: pageNode })
    : pageNode

  return renderToString(wrapped as any)
}

async function renderFullPage(
  route: ResolvedRoute,
  data: object,
  url: string,
  params: Record<string, string>,
  appLayout: LayoutDef | undefined,
  title = 'FNetro'
): Promise<string> {
  const pageHtml = await renderInner(route, data, url, params, appLayout)
  return buildShell({
    title,
    stateJson: JSON.stringify({ [url]: data }),
    paramsJson: JSON.stringify(params),
    pageHtml,
  })
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 3  createFNetro — assemble the Hono app
// ══════════════════════════════════════════════════════════════════════════════

export interface FNetroApp {
  /** The underlying Hono instance — add raw routes, custom error handlers, etc. */
  app: Hono
  /** Hono fetch handler — export this as default for edge runtimes */
  handler: Hono['fetch']
}

export function createFNetro(config: AppConfig): FNetroApp {
  const app = new Hono()

  // Static assets
  app.use('/assets/*', async (c, next) => {
    // In production served by Vite build output; delegate to next in dev
    await next()
  })

  // Global middleware
  ;(config.middleware ?? []).forEach(mw => app.use('*', mw))

  // Resolve all routes
  const { pages, apis } = resolveRoutes(config.routes, {
    layout: config.layout,
    middleware: [],
  })

  // Pre-compile paths
  const compiled = pages.map(r => ({
    route: r,
    compiled: compilePath(r.fullPath),
  }))

  // Register API routes
  apis.forEach(api => {
    const sub = new Hono()
    api.register(sub, config.middleware ?? [])
    app.route(api.path, sub)
  })

  // Page handler (catch-all, after API routes)
  app.all('*', async (c) => {
    const url = new URL(c.req.url)
    const pathname = url.pathname
    const isSPA = c.req.header(SPA_HEADER) === '1'

    // Find matching page
    let matched: { route: ResolvedRoute; params: Record<string, string> } | null = null
    for (const { route, compiled: cp } of compiled) {
      const params = matchPath(cp, pathname)
      if (params !== null) {
        matched = { route, params }
        break
      }
    }

    if (!matched) {
      if (config.notFound) {
        const html = await renderToString(jsx(config.notFound as any, {}))
        return c.html(`<!DOCTYPE html><html><body>${html}</body></html>`, 404)
      }
      return c.text('Not Found', 404)
    }

    const { route, params } = matched

    // Expose params via c.req — patch temporarily
    const origParam = c.req.param.bind(c.req)
    ;(c.req as any).param = (key?: string) =>
      key ? (params[key] ?? origParam(key)) : { ...params, ...origParam() }

    // Run route-level middleware chain (mirrors Hono's own onion model)
    let earlyResponse: Response | undefined
    const handlers = [...route.middleware]
    let idx = 0

    const runMiddleware = async (): Promise<void> => {
      const mw = handlers[idx++]
      if (!mw) return
      const res = await mw(c, runMiddleware)
      // If middleware returned a Response and didn't call next(), use it
      if (res instanceof Response && !earlyResponse) earlyResponse = res
    }

    await runMiddleware()

    if (earlyResponse) return earlyResponse

    // Run loader
    const data = route.page.loader ? await route.page.loader(c) : {}
    const safeData = data ?? {}

    if (isSPA) {
      // SPA navigation — return JSON
      const html = await renderInner(route, safeData, pathname, params, config.layout)
      return c.json({
        html,
        state: safeData,
        params,
        url: pathname,
      })
    }

    // Full SSR
    const fullHtml = await renderFullPage(route, safeData, pathname, params, config.layout)
    return c.html(fullHtml)
  })

  return { app, handler: app.fetch }
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 4  Universal serve() — auto-detects Node / Bun / Deno / edge
// ══════════════════════════════════════════════════════════════════════════════

export type Runtime = 'node' | 'bun' | 'deno' | 'edge' | 'unknown'

export function detectRuntime(): Runtime {
  if (typeof (globalThis as any).Bun !== 'undefined') return 'bun'
  if (typeof (globalThis as any).Deno !== 'undefined') return 'deno'
  if (typeof process !== 'undefined' && process.versions?.node) return 'node'
  return 'edge'
}

export interface ServeOptions {
  app: FNetroApp
  port?: number
  hostname?: string
  /** Override auto-detected runtime. */
  runtime?: Runtime
  /** Static assets root directory (served at /assets/*). @default './dist' */
  staticDir?: string
}

export async function serve(opts: ServeOptions): Promise<void> {
  const runtime = opts.runtime ?? detectRuntime()
  const port = opts.port ?? Number((globalThis as any).process?.env?.PORT ?? 3000)
  const hostname = opts.hostname ?? '0.0.0.0'
  const staticDir = opts.staticDir ?? './dist'
  const addr = `http://${hostname === '0.0.0.0' ? 'localhost' : hostname}:${port}`
  const logReady = () => console.log(`\n🔥  FNetro [${runtime}] ready  →  ${addr}\n`)

  switch (runtime) {
    case 'node': {
      const [{ serve: nodeServe }, { serveStatic }] = await Promise.all([
        import('@hono/node-server'),
        import('@hono/node-server/serve-static'),
      ])
      opts.app.app.use('/assets/*', serveStatic({ root: staticDir }))
      nodeServe({ fetch: opts.app.handler, port, hostname })
      logReady()
      break
    }
    case 'bun': {
      ;(globalThis as any).Bun.serve({ fetch: opts.app.handler, port, hostname })
      logReady()
      break
    }
    case 'deno': {
      ;(globalThis as any).Deno.serve({ port, hostname }, opts.app.handler)
      logReady()
      break
    }
    default:
      console.warn('[fnetro] serve() is a no-op on edge runtimes. Export `app.handler` instead.')
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 5  Vite plugin — automatic dual build (server + client)
// ══════════════════════════════════════════════════════════════════════════════

export interface FNetroPluginOptions {
  /**
   * Server entry file (exports the Hono app / calls serve()).
   * @default 'app/server.ts'
   */
  serverEntry?: string
  /**
   * Client entry file (calls boot()).
   * @default 'app/client.ts'
   */
  clientEntry?: string
  /**
   * Output directory for the server bundle.
   * @default 'dist/server'
   */
  serverOutDir?: string
  /**
   * Output directory for client assets (JS, CSS).
   * @default 'dist/assets'
   */
  clientOutDir?: string
  /**
   * External packages for the server bundle.
   * Node built-ins are always external.
   */
  serverExternal?: string[]
  /**
   * Emit type declarations for framework types.
   * @default false
   */
  dts?: boolean
}

const NODE_BUILTINS = /^node:|^(assert|buffer|child_process|cluster|crypto|dgram|dns|domain|events|fs|http|https|module|net|os|path|perf_hooks|process|punycode|querystring|readline|repl|stream|string_decoder|sys|timers|tls|trace_events|tty|url|util|v8|vm|worker_threads|zlib)$/

export function fnetroVitePlugin(opts: FNetroPluginOptions = {}): Plugin[] {
  const {
    serverEntry = 'app/server.ts',
    clientEntry  = 'app/client.ts',
    serverOutDir = 'dist/server',
    clientOutDir = 'dist/assets',
    serverExternal = [],
  } = opts

  let isServerBuild = true  // first pass = server

  // JSX transform options.
  // Vite 8 deprecated the `esbuild` transform option in favour of `oxc`.
  // We set both so the plugin works with Vite 5 / 6 / 7 (esbuild) and Vite 8+ (oxc).
  const jsxTransform = {
    jsx: 'automatic' as const,
    jsxImportSource: 'hono/jsx',
  }

  // Common JSX transform plugin — applied to every build (server + client + dev).
  // Vite ≤7 uses esbuild; Vite 8+ uses oxc (rolldown-based). We configure both.
  // OxcOptions.jsx is NOT the same shape as esbuild's — it takes { runtime, importSource }
  // instead of the string 'automatic'. Using the wrong shape emits a deprecation warning.
  const jsxPlugin: Plugin = {
    name: 'fnetro:jsx',
    config: () => ({
      // Vite ≤7 (esbuild transform)
      esbuild: jsxTransform,
      // Vite 8+ (oxc / rolldown transform) — jsx property uses JsxOptions object shape
      oxc: {
        jsx: {
          runtime: 'automatic',
          importSource: 'hono/jsx',
        },
      } as any,  // `as any` because JsxOptions typing varies across Vite 8 patch releases
    }),
  }

  // Server build plugin
  const serverPlugin: Plugin = {
    name: 'fnetro:server',
    apply: 'build',
    enforce: 'pre',

    config() {
      // No alias needed: hono/jsx and hono/jsx/dom produce compatible nodes.
      // renderToString (server) and render() (client) both accept them.
      return {
        build: {
          outDir: serverOutDir,
          ssr: true,
          target: 'node18',
          lib: {
            entry: serverEntry,
            formats: ['es'],
            fileName: 'server',
          },
          rollupOptions: {
            external: (id: string) =>
              NODE_BUILTINS.test(id) ||
              id === '@hono/node-server' ||
              serverExternal.includes(id),
          },
        },
        // Vite ≤7 fallback (oxc is set by jsxPlugin for Vite 8+)
        esbuild: jsxTransform,
      }
    },

    async closeBundle() {
      console.log('\n⚡  FNetro: building client bundle…\n')

      const { build } = await import('vite')
      await build({
        configFile: false,
        // Vite ≤7 fallback (oxc is set by jsxPlugin for Vite 8+)
        esbuild: jsxTransform,
        build: {
          outDir: clientOutDir,
          lib: {
            entry: clientEntry,
            formats: ['es'],
            fileName: 'client',
          },
          rollupOptions: {
            output: { entryFileNames: '[name].js' },
          },
        },
      } satisfies InlineConfig)

      console.log('\n✅  FNetro: both bundles ready\n')
    },
  }

  return [jsxPlugin, serverPlugin]
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 6  Re-export core for convenience when only server.ts is imported
// ══════════════════════════════════════════════════════════════════════════════
export {
  definePage, defineGroup, defineLayout, defineMiddleware, defineApiRoute,
  ref, shallowRef, reactive, shallowReactive, readonly,
  computed, effect, watch, watchEffect, effectScope,
  toRef, toRefs, unref, isRef, isReactive, isReadonly, markRaw, toRaw,
  triggerRef, use, useLocalRef, useLocalReactive,
  SPA_HEADER, STATE_KEY,
} from './core'
export type {
  AppConfig, PageDef, GroupDef, LayoutDef, ApiRouteDef, MiddlewareDef,
  Ref, ComputedRef, WritableComputedRef, WatchSource, WatchOptions,
  LoaderCtx, FNetroMiddleware, AnyJSX,
} from './core'