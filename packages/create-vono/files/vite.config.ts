// ─────────────────────────────────────────────────────────────────────────────
//  vite.config.ts
//
//  Plugin execution order matters:
//    1. vue()              — transforms .vue files in dev mode + SSR build
//    2. vonoVitePlugin() — orchestrates the dual build (SSR → client SPA)
//    3. devServer()        — routes dev requests through the Hono app
//
//  The `target: 'node18'` in vonoVitePlugin's server build config is what
//  enables top-level await in dist/server/server.js.  Do not override the
//  build.target here for SSR builds — let the plugin manage it.
// ─────────────────────────────────────────────────────────────────────────────

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { vonoVitePlugin } from '@netrojs/vono/vite'
import devServer from '@hono/vite-dev-server'

export default defineConfig({
  plugins: [
    // Handles .vue SFC transforms in both dev mode and the server SSR build
    vue(),

    // Orchestrates dual-bundle production build:
    //   vite build  → dist/server/server.js  (SSR, target node18, ES module)
    //   closeBundle → dist/assets/…          (client SPA, manifest.json)
    vonoVitePlugin({
      serverEntry:  'server.ts',
      clientEntry:  'client.ts',
      serverOutDir: 'dist/server',
      clientOutDir: 'dist/assets',
    }),

    // Routes all dev-mode requests through the Vono Hono app (app.ts default export)
    // injectClientScript: false — Vono injects the client script itself
    // via buildShellParts(); letting the dev server inject a second copy
    // causes a double-hydration error.
    devServer({ entry: 'app.ts', injectClientScript: false }),
  ],

  server: {
    // Prevent Vite from restarting when dist/ changes during a production build
    watch: { ignored: ['**/dist/**'] },
  },

  // Optimise these packages in dev so Vite only processes them once
  optimizeDeps: {
    include: ['vue', 'vue-router'],
  },
})
