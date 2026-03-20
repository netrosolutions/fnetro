// ─────────────────────────────────────────────────────────────────────────────
//  app/routes.ts  ·  Vono demo — full-featured route definitions
//
//  Demonstrates:
//    • definePage() with typed loaders — types flow into usePageData<T>()
//    • InferPageData<T> for a single-source-of-truth type pattern
//    • defineGroup() with shared layout + prefix + middleware
//    • defineLayout() for per-section layouts
//    • defineApiRoute() for Hono JSON APIs co-located with pages
//    • Async loaders  → automatic code splitting per route chunk
//    • Dynamic params → [slug], [id] in paths
//    • Per-page SEO   → static + dynamic (function) forms
//    • Server-side middleware  → auth guard on protected routes
// ─────────────────────────────────────────────────────────────────────────────

import {
  definePage,
  defineGroup,
  defineLayout,
  defineApiRoute,
  type InferPageData,
} from '@netrojs/vono'
import type { LoaderCtx } from '@netrojs/vono'
import RootLayout    from './layouts/RootLayout.vue'
import DashboardLayout from './layouts/DashboardLayout.vue'

// ── Shared data types (co-located with routes for InferPageData) ──────────────

export interface Post {
  id:      number
  slug:    string
  title:   string
  excerpt: string
  body:    string
  author:  string
  date:    string
  tags:    string[]
  views:   number
}

export interface DashboardStats {
  totalUsers:    number
  totalPosts:    number
  totalViews:    number
  recentSignups: number
  trend:         Array<{ day: string; users: number; views: number }>
}

// ── In-memory mock data (replace with a real DB in production) ───────────────

const POSTS: Post[] = [
  {
    id: 1, slug: 'getting-started', title: 'Getting Started with Vono',
    excerpt: 'Learn how to build full-stack Vue apps with streaming SSR and Hono.',
    body: 'Vono combines Hono\'s blazing-fast server with Vue 3\'s reactive UI layer...',
    author: 'Alice', date: '2025-03-01', tags: ['vue', 'ssr', 'hono'], views: 1024,
  },
  {
    id: 2, slug: 'type-safe-loaders', title: 'Type-Safe Loaders & usePageData',
    excerpt: 'One type definition — inferred from your loader, available everywhere.',
    body: 'The InferPageData<T> helper extracts the return type from definePage()...',
    author: 'Bob', date: '2025-03-10', tags: ['typescript', 'dx'], views: 832,
  },
  {
    id: 3, slug: 'streaming-ssr', title: 'Streaming SSR Deep Dive',
    excerpt: 'Why renderToWebStream gives you dramatically lower TTFB than buffered SSR.',
    body: 'With renderToWebStream the browser receives <head> immediately...',
    author: 'Carol', date: '2025-03-18', tags: ['performance', 'ssr'], views: 2048,
  },
]

// ── Auth helper (stub) ────────────────────────────────────────────────────────

function isAuthenticated(c: LoaderCtx): boolean {
  // Real app: check a JWT cookie / session token
  return c.req.header('cookie')?.includes('session=demo') ?? false
}

// ── Layouts ───────────────────────────────────────────────────────────────────

export const rootLayout      = defineLayout(RootLayout)
export const dashboardLayout = defineLayout(DashboardLayout)

// ── API routes (Hono handlers) ────────────────────────────────────────────────

const postsApi = defineApiRoute('/api/posts', (app) => {
  app.get('/', (c) => c.json({ posts: POSTS.map(({ body: _, ...p }) => p) }))
  app.get('/:slug', (c) => {
    const post = POSTS.find(p => p.slug === c.req.param('slug'))
    return post ? c.json(post) : c.json({ error: 'Not found' }, 404)
  })
})

const statsApi = defineApiRoute('/api/stats', (app) => {
  app.get('/', (c) => c.json({
    totalUsers: 4200,
    totalPosts: POSTS.length,
    totalViews: POSTS.reduce((s, p) => s + p.views, 0),
  }))
})

// ── Public pages ──────────────────────────────────────────────────────────────

export const homePage = definePage({
  path:   '/',
  layout: rootLayout,
  seo: {
    title:       'Vono Demo — Vue 3 + Hono Full-Stack Framework',
    description: 'A complex demo showcasing streaming SSR, SPA navigation, type-safe loaders, code splitting, and Hono middleware — all in one TypeScript-first framework.',
    ogType:      'website',
    twitterCard: 'summary_large_image',
  },
  loader: async () => ({
    headline: 'Build faster with Vono',
    subline:  'Streaming SSR · SPA · Type-safe loaders · Hono middleware · Multi-runtime',
    stats: {
      ssr:    '< 10ms TTFB on cold start',
      bundle: '< 50 kB client JS (gzipped)',
      dx:     'One loader type — used everywhere',
    },
    recentPosts: POSTS.map(({ body: _, ...p }) => p),
    features: [
      { icon: '⚡', title: 'Streaming SSR',       desc: 'renderToWebStream flushes <head> instantly — CSS & scripts load while the body streams.' },
      { icon: '🔀', title: 'SPA Navigation',      desc: 'Vue Router on the client. Navigating between pages fetches JSON — no full reload.' },
      { icon: '🔒', title: 'Type-safe Loaders',   desc: 'InferPageData<T> derives component types from your loader. Zero duplication.' },
      { icon: '✂️', title: 'Code Splitting',       desc: 'Pass () => import() as component. Vono resolves it for SSR, splits it for the client.' },
      { icon: '🔍', title: 'Full SEO',             desc: 'Title, description, OG, Twitter Cards, JSON-LD — synced on every navigation.' },
      { icon: '🛡️', title: 'Server Middleware',    desc: 'Hono middleware per app, per group, per route — with a client-side counterpart.' },
      { icon: '🗂️', title: 'Route Groups',         desc: 'defineGroup() lets you share a prefix, layout, and middleware across multiple routes.' },
      { icon: '🚀', title: 'Multi-runtime',        desc: 'Node.js, Bun, Deno, Cloudflare Workers — same codebase, zero adapter code.' },
    ],
  }),
  component: () => import('./pages/home.vue'),
})
export type HomeData = InferPageData<typeof homePage>

// ── Blog pages ────────────────────────────────────────────────────────────────

export const blogListPage = definePage({
  path:   '/blog',
  layout: rootLayout,
  seo: {
    title:       'Blog — Vono Demo',
    description: 'Articles about Vue 3, Hono, SSR, TypeScript, and full-stack development.',
  },
  loader: async () => ({
    posts: POSTS.map(({ body: _, ...p }) => p),
  }),
  component: () => import('./pages/blog/index.vue'),
})
export type BlogListData = InferPageData<typeof blogListPage>

export const blogPostPage = definePage({
  path:   '/blog/[slug]',
  layout: rootLayout,
  // Dynamic SEO: receives the loader output + params at render time
  seo: (data, _params) => ({
    title:       `${data.post?.title ?? 'Post'} — Vono Blog`,
    description: data.post?.excerpt,
    ogType:      'article',
    ogImage:     `/og/blog/${data.post?.slug}.png`,
  }),
  loader: async (c) => {
    const slug = c.req.param('slug')
    const post = POSTS.find(p => p.slug === slug) ?? null
    return { post }
  },
  component: () => import('./pages/blog/[slug].vue'),
})
export type BlogPostData = InferPageData<typeof blogPostPage>

// ── Dashboard (protected) ─────────────────────────────────────────────────────
//
// defineGroup() applies:
//   - prefix      → all routes under /dashboard
//   - layout      → DashboardLayout (sidebar + header)
//   - middleware   → auth guard; returns 401 JSON if not authenticated

const authGuard = async (c: LoaderCtx, next: () => Promise<void>): Promise<void | Response> => {
  if (!isAuthenticated(c)) {
    // For SPA navigations return JSON; for full-page loads redirect
    const isSPA = c.req.header('x-vono-spa') === '1'
    if (isSPA) return c.json({ error: 'Unauthorized' }, 401) as unknown as Response
    return c.redirect('/login') as unknown as Response
  }
  await next()
}

export const dashboardGroup = defineGroup({
  prefix:     '/dashboard',
  layout:     dashboardLayout,
  middleware: [authGuard],
  routes: [
    definePage({
      path: '',   // resolves to /dashboard
      seo:  { title: 'Dashboard — Vono Demo' },
      loader: async (): Promise<DashboardStats> => ({
        totalUsers:    4200,
        totalPosts:    POSTS.length,
        totalViews:    POSTS.reduce((s, p) => s + p.views, 0),
        recentSignups: 38,
        trend: [
          { day: 'Mon', users: 120, views: 880 },
          { day: 'Tue', users: 145, views: 1020 },
          { day: 'Wed', users: 98,  views: 760  },
          { day: 'Thu', users: 210, views: 1450 },
          { day: 'Fri', users: 175, views: 1230 },
          { day: 'Sat', users: 90,  views: 620  },
          { day: 'Sun', users: 60,  views: 490  },
        ],
      }),
      component: () => import('./pages/dashboard/index.vue'),
    }),

    definePage({
      path: '/posts',
      seo:  { title: 'Manage Posts — Vono Demo' },
      loader: async () => ({ posts: POSTS }),
      component: () => import('./pages/dashboard/posts.vue'),
    }),

    definePage({
      path: '/settings',
      seo:  { title: 'Settings — Vono Demo' },
      loader: async () => ({
        settings: {
          siteName:     'Vono Demo',
          siteUrl:      'https://demo.vono.dev',
          analyticsId:  'G-XXXXXXXXXX',
          emailNotifs:  true,
          maintenanceMode: false,
        },
      }),
      component: () => import('./pages/dashboard/settings.vue'),
    }),
  ],
})

// ── Auth pages (no layout) ────────────────────────────────────────────────────

export const loginPage = definePage({
  path:   '/login',
  layout: false,   // no layout — full-page auth screen
  seo:    { title: 'Sign in — Vono Demo' },
  loader: async () => ({ error: null as string | null }),
  component: () => import('./pages/login.vue'),
})
export type LoginData = InferPageData<typeof loginPage>

// ── 404 page (handled by createVono's notFound option) ─────────────────────
// Exported so app.ts can reference it directly.
export { default as NotFoundPage } from './pages/404.vue'

// ── Master route list ─────────────────────────────────────────────────────────

export const routes = [
  postsApi,
  statsApi,
  homePage,
  blogListPage,
  blogPostPage,
  dashboardGroup,
  loginPage,
]
