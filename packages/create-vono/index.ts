#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
//  create-vono · Interactive project scaffolding CLI
//  npm create @netrojs/vono@latest [project-name]
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import prompts from 'prompts'
import { bold, cyan, dim, green, red, yellow } from 'kolorist'

// ── Config ────────────────────────────────────────────────────────────────────

const VONO_VERSION = '0.1.1'
const FILES_DIR      = join(dirname(fileURLToPath(import.meta.url)), '..', 'files')

type Runtime = 'node' | 'bun' | 'deno'
type PkgMgr  = 'npm' | 'pnpm' | 'bun' | 'yarn'

interface Answers {
  projectName: string
  runtime:     Runtime
  pkgManager:  PkgMgr
  gitInit:     boolean
  installDeps: boolean
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function banner() {
  console.log()
  console.log(bold(cyan('  ◈  create-vono')))
  console.log(dim('  Full-stack Hono + Vue 3 — SSR · SPA · code splitting · TypeScript'))
  console.log()
}

function isDirEmpty(dir: string): boolean {
  if (!existsSync(dir)) return true
  const items = readdirSync(dir)
  return items.length === 0 || (items.length === 1 && items[0] === '.git')
}

/** Walk a directory recursively, yielding absolute paths of all files. */
function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) yield* walk(full)
    else yield full
  }
}

/** Replace template placeholders in file content. */
function applyVars(content: string, vars: Record<string, string>): string {
  for (const [k, v] of Object.entries(vars)) {
    content = content.replaceAll(`{{${k}}}`, v)
  }
  return content
}

// ── Runtime-specific server.ts content ───────────────────────────────────────
//
// The server.ts template uses `await serve(...)` at the top level.
// This works because the SSR bundle is built with `target: 'node18'` by
// vonoVitePlugin, which enables top-level await in the output.
//
// Each runtime variant sets the correct `runtime` flag and env accessor.

const serverContent: Record<Runtime, string> = {
  node: `\
// server.ts — Node.js production entry
// vonoVitePlugin sets target: 'node18' in the SSR build, enabling top-level await.
import { serve } from '@netrojs/vono/server'
import { vono } from './app'

await serve({
  app:       vono,
  port:      Number(process.env['PORT'] ?? 3000),
  runtime:   'node',
  staticDir: './dist',
})
`,
  bun: `\
// server.ts — Bun production entry
// vonoVitePlugin sets target: 'node18' in the SSR build, enabling top-level await.
import { serve } from '@netrojs/vono/server'
import { vono } from './app'

await serve({
  app:       vono,
  port:      Number(process.env['PORT'] ?? 3000),
  runtime:   'bun',
  staticDir: './dist',
})
`,
  deno: `\
// server.ts — Deno production entry
// vonoVitePlugin sets target: 'node18' in the SSR build, enabling top-level await.
import { serve } from '@netrojs/vono/server'
import { vono } from './app'

await serve({
  app:       vono,
  port:      Number(Deno.env.get('PORT') ?? 3000),
  runtime:   'deno',
  staticDir: './dist',
})
`,
}

// ── Scaffold ──────────────────────────────────────────────────────────────────

function scaffold(dir: string, a: Answers): void {
  const devCmds: Record<Runtime, string> = {
    node: 'vite --host',
    bun:  'bun --bun vite --host',
    deno: 'deno run -A npm:vite --host',
  }
  const buildCmds: Record<Runtime, string> = {
    node: 'vite build',
    bun:  'bun --bun vite build',
    deno: 'deno run -A npm:vite build',
  }

  const startCmds: Record<Runtime, string> = {
    node: 'node dist/server/server.js',
    bun:  'bun dist/server/server.js',
    deno: 'deno run -A dist/server/server.js',
  }

  const vars: Record<string, string> = {
    PROJECT_NAME: a.projectName,
    VONO_VERSION,
    DEV_CMD:      devCmds[a.runtime],
    BUILD_CMD:    buildCmds[a.runtime],
    START_CMD:    startCmds[a.runtime],
  }

  mkdirSync(dir, { recursive: true })

  for (const srcPath of walk(FILES_DIR)) {
    const rel     = relative(FILES_DIR, srcPath)

    // Skip leftover editor files (e.g. "home copy.vue")
    if (/\scopy\b/.test(rel)) continue

    const renamed = rel
      .replace(/^_package\.json$/, 'package.json')
      .replace(/^_gitignore$/,     '.gitignore')

    const destPath = join(dir, renamed)
    mkdirSync(dirname(destPath), { recursive: true })

    let content = readFileSync(srcPath, 'utf-8')

    // ── Runtime-specific overrides ──────────────────────────────────────────

    // server.ts: replace with the runtime-specific version
    if (renamed === 'server.ts') {
      content = serverContent[a.runtime]
    }

    // package.json: swap @hono/node-server for @types/bun on Bun
    if (renamed === 'package.json') {
      const parsed: Record<string, any> = JSON.parse(applyVars(content, vars))

      if (a.runtime === 'bun') {
        delete parsed.devDependencies['@hono/node-server']
        parsed.devDependencies['@types/bun'] = 'latest'
      }
      if (a.runtime === 'deno') {
        delete parsed.devDependencies['@hono/node-server']
      }

      writeFileSync(destPath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8')
      continue
    }

    writeFileSync(destPath, applyVars(content, vars), 'utf-8')
  }

  // .env.example
  writeFileSync(
    join(dir, '.env.example'),
    `PORT=3000\nNODE_ENV=development\n`,
    'utf-8',
  )
}

// ── Install + git ─────────────────────────────────────────────────────────────

const INSTALL: Record<PkgMgr, string> = {
  npm: 'npm install', pnpm: 'pnpm install', bun: 'bun install', yarn: 'yarn',
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  banner()

  const nameArg = process.argv[2]?.trim()

  const a = await prompts([
    {
      name:    'projectName',
      type:    nameArg ? null : 'text',
      message: 'Project name:',
      initial: 'my-vono-app',
      validate: (v: string) => v.trim() ? true : 'Name is required',
    },
    {
      name:    'runtime',
      type:    'select',
      message: 'Runtime:',
      choices: [
        { title: 'Node.js', value: 'node' },
        { title: 'Bun',     value: 'bun'  },
        { title: 'Deno',    value: 'deno' },
      ],
      initial: 0,
    },
    {
      name:    'pkgManager',
      type:    'select',
      message: 'Package manager:',
      choices: [
        { title: 'npm',  value: 'npm'  },
        { title: 'pnpm', value: 'pnpm' },
        { title: 'bun',  value: 'bun'  },
        { title: 'yarn', value: 'yarn' },
      ],
      initial: 0,
    },
    { name: 'gitInit',     type: 'confirm', message: 'Init git repo?',        initial: true },
    { name: 'installDeps', type: 'confirm', message: 'Install dependencies?', initial: true },
  ], {
    onCancel: () => { console.log(red('\nCancelled.\n')); process.exit(1) },
  }) as Answers

  if (nameArg) a.projectName = nameArg

  const dir = resolve(process.cwd(), a.projectName)

  if (!isDirEmpty(dir)) {
    console.log(red(`\n  Directory "${a.projectName}" is not empty.\n`))
    process.exit(1)
  }

  console.log()
  scaffold(dir, a)
  console.log(green(`  ✓ Scaffolded ${bold(a.projectName)}/`))

  if (a.gitInit) {
    try {
      execSync('git init',                                                     { cwd: dir, stdio: 'ignore' })
      execSync('git add -A',                                                   { cwd: dir, stdio: 'ignore' })
      execSync('git commit -m "chore: initial vono scaffold"',               { cwd: dir, stdio: 'ignore' })
      console.log(green('  ✓ Git repo initialised'))
    } catch { /* git not available */ }
  }

  if (a.installDeps) {
    console.log(dim(`\n  Running ${INSTALL[a.pkgManager]}…\n`))
    execSync(INSTALL[a.pkgManager], { cwd: dir, stdio: 'inherit' })
  }

  const rel = relative(process.cwd(), dir)

  console.log()
  console.log(bold('  Next steps:'))
  if (rel !== '.') console.log(`    ${cyan(`cd ${rel}`)}`)
  if (!a.installDeps) console.log(`    ${cyan(INSTALL[a.pkgManager])}`)
  console.log(`    ${cyan(a.runtime === 'bun' ? 'bun run dev' : 'npm run dev')}`)
  console.log()
  console.log(dim('  Open http://localhost:5173 to see the demo app.'))
  console.log(dim('  Dashboard demo: /dashboard  (sign in with any credentials)'))
  console.log(dim('  Docs: https://github.com/netrosolutions/vono'))
  console.log()
}

main().catch(err => { console.error(err); process.exit(1) })
