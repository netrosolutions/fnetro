// ─────────────────────────────────────────────────────────────────────────────
//  FNetro · client.ts
//  SolidJS hydration · @solidjs/router SPA routing · client middleware · SEO
// ─────────────────────────────────────────────────────────────────────────────

import { createSignal, createComponent, lazy, Suspense } from 'solid-js'
import { hydrate } from 'solid-js/web'
import { Router, Route } from '@solidjs/router'
import {
  resolveRoutes, compilePath, matchPath,
  SPA_HEADER, STATE_KEY, PARAMS_KEY, SEO_KEY,
  type AppConfig, type ResolvedRoute, type CompiledPath,
  type LayoutDef, type SEOMeta, type ClientMiddleware,
} from './core'

// ══════════════════════════════════════════════════════════════════════════════
//  § 1  Compiled route cache (module-level, populated on boot)
// ══════════════════════════════════════════════════════════════════════════════

interface CRoute { route: ResolvedRoute; cp: CompiledPath }

let _routes:    CRoute[]          = []
let _appLayout: LayoutDef | undefined

function findRoute(pathname: string) {
  for (const { route, cp } of _routes) {
    const params = matchPath(cp, pathname)
    if (params !== null) return { route, params }
  }
  return null
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 2  Client middleware
// ══════════════════════════════════════════════════════════════════════════════

const _mw: ClientMiddleware[] = []

/**
 * Register a client-side navigation middleware.
 * Must be called **before** `boot()`.
 *
 * @example
 * useClientMiddleware(async (url, next) => {
 *   if (!isLoggedIn() && url.startsWith('/dashboard')) {
 *     await navigate('/login')
 *     return                   // cancel original navigation
 *   }
 *   await next()
 * })
 */
export function useClientMiddleware(mw: ClientMiddleware): void {
  _mw.push(mw)
}

async function runMiddleware(url: string, done: () => Promise<void>): Promise<void> {
  const chain = [..._mw, async (_u: string, next: () => Promise<void>) => { await done(); await next() }]
  let i = 0
  const run = async (): Promise<void> => {
    const fn = chain[i++]
    if (fn) await fn(url, run)
  }
  await run()
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 3  SEO — client-side <head> sync
// ══════════════════════════════════════════════════════════════════════════════

function setMeta(selector: string, attr: string, val: string | undefined): void {
  if (!val) { document.querySelector(selector)?.remove(); return }
  let el = document.querySelector<HTMLMetaElement>(selector)
  if (!el) {
    el = document.createElement('meta')
    const m = /\[(\w+[:-]?\w*)="([^"]+)"\]/.exec(selector)
    if (m) el.setAttribute(m[1], m[2])
    document.head.appendChild(el)
  }
  el.setAttribute(attr, val)
}

export function syncSEO(seo: SEOMeta): void {
  if (seo.title) document.title = seo.title

  setMeta('[name="description"]',        'content', seo.description)
  setMeta('[name="keywords"]',           'content', seo.keywords)
  setMeta('[name="robots"]',             'content', seo.robots)
  setMeta('[name="theme-color"]',        'content', seo.themeColor)
  setMeta('[property="og:title"]',       'content', seo.ogTitle)
  setMeta('[property="og:description"]', 'content', seo.ogDescription)
  setMeta('[property="og:image"]',       'content', seo.ogImage)
  setMeta('[property="og:url"]',         'content', seo.ogUrl)
  setMeta('[property="og:type"]',        'content', seo.ogType)
  setMeta('[name="twitter:card"]',       'content', seo.twitterCard)
  setMeta('[name="twitter:title"]',      'content', seo.twitterTitle)
  setMeta('[name="twitter:description"]','content', seo.twitterDescription)
  setMeta('[name="twitter:image"]',      'content', seo.twitterImage)

  // Canonical link
  const canon = seo.canonical
  let linkEl = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (canon) {
    if (!linkEl) {
      linkEl = document.createElement('link')
      linkEl.rel = 'canonical'
      document.head.appendChild(linkEl)
    }
    linkEl.href = canon
  } else {
    linkEl?.remove()
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 4  Prefetch cache + SPA data fetching
// ══════════════════════════════════════════════════════════════════════════════

interface NavPayload {
  state:  Record<string, unknown>
  params: Record<string, string>
  seo:    SEOMeta
  url:    string
}

const _cache = new Map<string, Promise<NavPayload>>()

export function fetchPayload(href: string): Promise<NavPayload> {
  if (!_cache.has(href)) {
    _cache.set(
      href,
      fetch(href, { headers: { [SPA_HEADER]: '1' } })
        .then(r => {
          if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
          return r.json() as Promise<NavPayload>
        }),
    )
  }
  return _cache.get(href)!
}

/** Warm the prefetch cache for a URL on hover/focus/etc. */
export function prefetch(url: string): void {
  try {
    const u = new URL(url, location.origin)
    if (u.origin !== location.origin || !findRoute(u.pathname)) return
    fetchPayload(u.toString())
  } catch { /* ignore invalid URLs */ }
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 5  Route components with data loading for @solidjs/router
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Creates a solid-router-compatible route component that:
 * 1. On first render: uses server-injected state (no network request)
 * 2. On SPA navigation: fetches data from the FNetro server handler
 */
function makeRouteComponent(
  route: ResolvedRoute,
  appLayout: LayoutDef | undefined,
  initialState: Record<string, unknown>,
  initialParams: Record<string, string>,
  initialSeo: SEOMeta,
  prefetchOnHover: boolean,
) {
  // The component returned here is used as @solidjs/router's <Route component>
  return function FNetroRouteComponent(routerProps: any) {
    // routerProps.params comes from @solidjs/router's URL matching
    const routeParams: Record<string, string> = routerProps.params ?? {}
    const pathname: string = routerProps.location?.pathname ?? location.pathname

    // Determine the data source:
    // - If this matches the server's initial state key, use it directly (no fetch needed on first load)
    // - Otherwise fetch from the server via the SPA JSON endpoint
    const serverData = initialState[pathname] as Record<string, unknown> | undefined
    const [data, setData] = createSignal<Record<string, unknown>>(serverData ?? {})
    const [params, setParams] = createSignal<Record<string, string>>(serverData ? initialParams : routeParams)

    // Load data if we don't have it yet from the server
    if (!serverData) {
      const url = new URL(pathname, location.origin).toString()
      fetchPayload(url).then(payload => {
        setData(payload.state ?? {})
        setParams(payload.params ?? {})
        syncSEO(payload.seo ?? {})
      }).catch(err => {
        console.error('[fnetro] Failed to load route data:', err)
      })
    } else {
      // Sync SEO for the initial page from server-injected data
      syncSEO(initialSeo)
    }

    // Render the page (and optional layout wrapper)
    const layout = route.layout !== undefined ? route.layout : appLayout

    const pageEl = () => createComponent(route.page.Page as any, {
      ...data(),
      url: pathname,
      params: params(),
    })

    if (!layout) return pageEl()

    return createComponent(layout.Component as any, {
      url: pathname,
      params: params(),
      get children() { return pageEl() },
    })
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 6  navigate / prefetch (convenience exports, wraps solid-router navigate)
// ══════════════════════════════════════════════════════════════════════════════

export interface NavigateOptions {
  replace?: boolean
  scroll?:  boolean
}

/**
 * Programmatic navigation — delegates to history API and triggers
 * @solidjs/router's reactive location update.
 */
export async function navigate(to: string, opts: NavigateOptions = {}): Promise<void> {
  const u = new URL(to, location.origin)
  if (u.origin !== location.origin) { location.href = to; return }
  if (!findRoute(u.pathname))        { location.href = to; return }

  await runMiddleware(u.pathname, async () => {
    try {
      // Prefetch/cache the payload so the route component can use it
      const payload = await fetchPayload(u.toString())
      history[opts.replace ? 'replaceState' : 'pushState'](
        { url: u.pathname }, '', u.pathname,
      )
      if (opts.scroll !== false) window.scrollTo(0, 0)
      syncSEO(payload.seo ?? {})
      // Dispatch a popstate-like event so @solidjs/router's location signal updates
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
    } catch (err) {
      console.error('[fnetro] Navigation error:', err)
      location.href = to
    }
  })
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 7  boot()
// ══════════════════════════════════════════════════════════════════════════════

export interface BootOptions extends AppConfig {
  /** Enable hover-based prefetching.  @default true */
  prefetchOnHover?: boolean
}

export async function boot(options: BootOptions): Promise<void> {
  const { pages } = resolveRoutes(options.routes, {
    layout:     options.layout,
    middleware: [],
  })

  _routes    = pages.map(r => ({ route: r, cp: compilePath(r.fullPath) }))
  _appLayout = options.layout

  const pathname = location.pathname
  if (!findRoute(pathname)) {
    console.warn(`[fnetro] No route matched "${pathname}" — skipping hydration`)
    return
  }

  // Server-injected initial state (no refetch needed on first load)
  const stateMap  = (window as any)[STATE_KEY]  as Record<string, Record<string, unknown>> ?? {}
  const paramsMap = (window as any)[PARAMS_KEY] as Record<string, string>                  ?? {}
  const seoData   = (window as any)[SEO_KEY]    as SEOMeta                                 ?? {}

  const container = document.getElementById('fnetro-app')
  if (!container) {
    console.error('[fnetro] #fnetro-app not found — aborting hydration')
    return
  }

  const prefetchOnHover = options.prefetchOnHover !== false

  // Build @solidjs/router <Route> elements for each resolved page
  const routeElements = pages.map(route =>
    createComponent(Route, {
      path: route.fullPath,
      component: makeRouteComponent(
        route,
        _appLayout,
        stateMap,
        paramsMap,
        seoData,
        prefetchOnHover,
      ),
    }) as any
  )

  // Hydrate with @solidjs/router wrapping all routes
  hydrate(
    () => createComponent(Router as any, {
      get children() { return routeElements },
    }) as any,
    container,
  )

  // Hover prefetch
  if (prefetchOnHover) {
    document.addEventListener('mouseover', (e: MouseEvent) => {
      const a = e.composedPath().find(
        (el): el is HTMLAnchorElement => el instanceof HTMLAnchorElement,
      )
      if (a?.href) prefetch(a.href)
    })
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  § 8  Re-exports
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

// Re-export solid-router primitives for convenience
export { useNavigate, useParams, useLocation, A, useSearchParams } from '@solidjs/router'
