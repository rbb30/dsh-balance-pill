/**
 * Client-half check: run the `__ModuleLoader__` bundle in a jsdom page under a
 * real React, drive `apply` with a fake slot registry, and print the rendered
 * pill. The host route is stubbed with a synthetic payload, so this check needs
 * no credentials and no network.
 *
 * React, react-dom, and jsdom resolve either from a DSH checkout
 * (`DSH_CHECKOUT=/path/to/deepseek-harness`, where they are dependencies of the
 * client packages) or from this repo's own `node_modules`.
 *
 *   node tests/client-check.mjs
 */

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

/** Load the render stack from the checkout when given, else from this repo. */
function loadRenderStack() {
  const bases = []
  if (typeof process.env.DSH_CHECKOUT === 'string' && process.env.DSH_CHECKOUT !== '') {
    bases.push(`${process.env.DSH_CHECKOUT.replace(/[/\\]+$/, '')}/packages/client/ui-chat/package.json`)
  }
  bases.push(import.meta.url)
  const failures = []
  for (const base of bases) {
    try {
      const require = createRequire(base)
      return {
        React: require('react'),
        createRoot: require('react-dom/client').createRoot,
        JSDOM: require('jsdom').JSDOM,
      }
    } catch (error) {
      failures.push(`${base}: ${error.message}`)
    }
  }
  throw new Error([
    'react, react-dom, and jsdom are not resolvable.',
    'Point DSH_CHECKOUT at a DSH checkout, or install them here (npm install react react-dom jsdom).',
    ...failures,
  ].join('\n  '))
}

const { React, createRoot, JSDOM } = loadRenderStack()

const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>')
globalThis.window = dom.window
globalThis.document = dom.window.document

/** Synthetic host payload: the shape `/dsh-balance-pill` answers with. */
const PAYLOAD = {
  ok: true,
  fetchedAt: Date.UTC(2026, 0, 1),
  refreshIntervalMs: 60_000,
  isAvailable: true,
  lines: [
    { currency: 'CNY', total: '123.45', granted: '23.45', toppedUp: '100.00' },
    { currency: 'USD', total: '1.00', granted: '0.00', toppedUp: '1.00' },
  ],
}
let fetchCalls = 0
globalThis.fetch = async () => {
  fetchCalls += 1
  return { ok: true, status: 200, json: async () => PAYLOAD }
}

let definition
window.__ModuleLoader__ = { load: (candidate) => { definition = candidate } }
vm.runInThisContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), { filename: 'client.js' })
console.log('bundle id:', definition.id)

const bundle = definition.factory((name) => {
  if (name === 'react') return React
  throw new Error(`unexpected require(${name})`)
})
console.log('exports:', Object.keys(bundle), '| inject:', bundle.inject)

const registrations = []
bundle.apply({
  slots: {
    inject: (key, callback) => { console.log('slots.inject key:', key); callback() },
    register: (options, component) => { registrations.push({ options, component }); return () => {} },
  },
})
console.log('registration:', JSON.stringify(registrations.map(entry => entry.options)))
console.log('style tag injected:', document.querySelector('style[data-plugin-css]') !== null)

const container = document.getElementById('root')
createRoot(container).render(React.createElement(registrations[0].component))
await new Promise(resolve => setTimeout(resolve, 80))
console.log('--- rendered pill ---')
console.log(container.innerHTML)
console.log('label text      :', container.querySelector('button')?.textContent)
console.log('tooltip (title) :', container.querySelector('button')?.getAttribute('title'))
console.log('fetch calls     :', fetchCalls)

process.exit(0)
