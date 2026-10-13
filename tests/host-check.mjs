/**
 * Host-half check: run `apply` against a minimal fake Cordis context, dispatch
 * the registered route through a real HTTP server, and print what the browser
 * half would receive. The API key is read from `$DEEPSEEK_API_KEY`, falling back
 * to the `DEEPSEEK_API_KEY` entry of `${DSH_HOME:-$HOME/.dsh}/.credentials.yaml`;
 * the key itself is never printed. The usage ledger goes to a throwaway temp
 * file, so this check never touches your real ledger.
 *
 *   node tests/host-check.mjs
 */

import http from 'node:http'
import { mkdtempSync, readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'

/** DSH home directory; the app defaults to `~/.dsh`. */
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')

/**
 * Read the API key from the environment, then the credentials file.
 * @returns The key, or undefined while unconfigured.
 */
function apiKey() {
  if (typeof process.env.DEEPSEEK_API_KEY === 'string' && process.env.DEEPSEEK_API_KEY !== '') {
    return process.env.DEEPSEEK_API_KEY
  }
  try {
    const text = readFileSync(join(DSH_HOME, '.credentials.yaml'), 'utf8')
    const match = text.match(/^\s*DEEPSEEK_API_KEY\s*:\s*(.*)$/m)
    return match?.[1]?.trim().replace(/^["']|["']$/g, '')
  } catch (error) {
    console.log('credentials file unreadable:', error.message)
    return undefined
  }
}

const key = apiKey()
console.log('key found:', key !== undefined)

const usageFile = join(mkdtempSync(join(tmpdir(), 'dsh-balance-pill-')), 'usage.json')
console.log('ledger:', usageFile)

const routes = []
const ctx = {
  get: (name) => (name === 'credentials'
    ? { resolve: async () => (key === undefined ? undefined : { value: key }) }
    : undefined),
  effect: (fn) => fn(),
  webServer: { register: (route) => { routes.push(route); return () => {} } },
}

apply(ctx, { usageFile })
console.log('routes registered:', routes.map(route => `${route.kind} ${route.path}`))

const server = http.createServer((req, res) => {
  const route = routes.find(candidate => candidate.path === new URL(req.url, 'http://localhost').pathname)
  if (route === undefined) { res.writeHead(404).end(); return }
  void route.handler(req, res)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}/dsh-balance-pill`

for (const [label, url, method] of [
  ['GET', base, 'GET'],
  ['GET (cached)', base, 'GET'],
  ['POST', base, 'POST'],
  ['HEAD', base, 'HEAD'],
]) {
  const response = await fetch(url, { method })
  const body = await response.text()
  console.log(`--- ${label} -> ${response.status} ${response.headers.get('content-type') ?? ''}`)
  console.log(body.slice(0, 900))
}

// The ledger is created on the first successful read; its `last` sample is what
// the next read diffs against. The write is fire-and-forget, so give it a moment.
await new Promise(resolve => setTimeout(resolve, 150))
try {
  console.log('--- ledger on disk ---')
  console.log(readFileSync(usageFile, 'utf8'))
} catch (error) {
  console.log('no ledger written:', error.message)
}
server.close()
