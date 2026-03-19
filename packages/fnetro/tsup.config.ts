import { defineConfig } from 'tsup'

// All peer deps + node builtins are always external — never bundled
const external = [
  'solid-js',
  'solid-js/web',
  'solid-js/store',
  'solid-js/universal',
  '@solidjs/router',
  'hono',
  'hono/jsx',
  'hono/jsx/dom',
  'hono/jsx/dom/server',
  'vite',
  'vite-plugin-solid',
  '@hono/node-server',
  '@hono/node-server/serve-static',
  /^node:/,
]

export default defineConfig([
  // core — shared types and utilities; no JSX, no Node deps
  {
    entry:  { core: 'core.ts' },
    format: ['esm'],
    dts:    true,
    clean:  false,
    outDir: 'dist',
    target: 'es2022',
    external,
  },
  // server — SSR renderer + Vite plugin (Node/server-side)
  {
    entry:    { server: 'server.ts' },
    format:   ['esm'],
    dts:      true,
    clean:    false,
    outDir:   'dist',
    target:   'es2022',
    platform: 'node',
    external,
  },
  // client — browser SPA runtime
  {
    entry:    { client: 'client.ts' },
    format:   ['esm'],
    dts:      true,
    clean:    false,
    outDir:   'dist',
    target:   'es2022',
    platform: 'browser',
    external,
  },
])
