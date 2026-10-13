/**
 * Client-half check: run the `__ModuleLoader__` bundle in a jsdom page under a
 * real React, drive `apply` with a fake slot registry, and exercise the pill and
 * its detail panel. The host route is stubbed, so this check needs no
 * credentials and no network.
 *
 * React, react-dom, and jsdom resolve either from a DSH checkout
 * (`DSH_CHECKOUT=/path/to/deepseek-harness`, where they are dependencies of the
 * client packages) or from this repo's own `node_modules`.
 *
 *   node tests/client-check.mjs
 */

import assert from 'node:assert/strict'
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
        ReactDOM: require('react-dom'),
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

const { React, ReactDOM, createRoot, JSDOM } = loadRenderStack()

const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>')
globalThis.window = dom.window
globalThis.document = dom.window.document

/** Synthetic usage block: the shape the host answers with. */
const USAGE = {
  day: '2026-10-13',
  trackingSince: Date.UTC(2026, 8, 1),
  today: [
    { currency: 'CNY', spent: '4.20', toppedUp: '0.00' },
    { currency: 'USD', spent: '0.42', toppedUp: '0.00' },
  ],
}

/** Synthetic pricing block; the countdown is anchored to this run. */
const PRICING = {
  phase: 'off-peak',
  multiplier: 1,
  now: Date.now(),
  nextChangeAt: Date.now() + 3 * 3_600_000,
  nextPhase: 'peak',
  schedule: {
    windowsUtc: [{ start: '01:00', end: '04:00' }, { start: '06:00', end: '10:00' }],
    weekdays: 'Mon–Fri',
    holidays: [],
    note: 'Peak is 01:00–04:00 and 06:00–10:00 UTC on weekdays.',
  },
}

/** Full payload: balance + usage + pricing. */
const PAYLOAD = {
  ok: true,
  fetchedAt: Date.now(),
  refreshIntervalMs: 60_000,
  isAvailable: true,
  lines: [
    { currency: 'CNY', total: '123.45', granted: '23.45', toppedUp: '100.00' },
    { currency: 'USD', total: '1.00', granted: '0.00', toppedUp: '1.00' },
  ],
  usage: USAGE,
  pricing: PRICING,
}

/** A host that predates usage tracking and pricing. */
const LEGACY_PAYLOAD = {
  ok: true,
  fetchedAt: Date.now(),
  refreshIntervalMs: 60_000,
  isAvailable: true,
  lines: [{ currency: 'USD', total: '1.00', granted: '0.00', toppedUp: '1.00' }],
}

let payload = PAYLOAD
let fetchCalls = 0
let lastUrl = null
globalThis.fetch = async (url) => {
  fetchCalls += 1
  lastUrl = String(url)
  return { ok: true, status: 200, json: async () => payload }
}

let definition
window.__ModuleLoader__ = { load: (candidate) => { definition = candidate } }
vm.runInThisContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), { filename: 'client.js' })

const bundle = definition.factory((name) => {
  if (name === 'react') return React
  if (name === 'react-dom') return ReactDOM
  throw new Error(`unexpected require(${name})`)
})
console.log('bundle id:', definition.id)
console.log('exports:', Object.keys(bundle), '| inject:', bundle.inject)

/** Settle React state updates and promise chains. */
const flush = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms))

/** Label/value pairs of a rendered detail grid. */
function rowPairs(panel) {
  const labels = [...panel.querySelectorAll('dt')].map(node => node.textContent)
  const values = [...panel.querySelectorAll('dd')].map(node => node.textContent)
  return labels.map((label, index) => [label, values[index]])
}

/** Mount the pill in a fresh container. */
function mount(container) {
  const root = createRoot(container)
  root.render(React.createElement(registrations[0].component))
  return root
}

/** Click an element and settle. */
async function click(target) {
  target.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  await flush()
}

const registrations = []
bundle.apply({
  slots: {
    inject: (key, callback) => { console.log('slots.inject key:', key); callback() },
    register: (options, component) => { registrations.push({ options, component }); return () => {} },
  },
})
console.log('registration:', JSON.stringify(registrations.map(entry => entry.options)))
assert.equal(document.querySelector('style[data-plugin-css]') !== null, true, 'The pill stylesheet is injected in <head>')

// --- scenario 1: the pill, then the panel it opens -------------------------
const container = document.getElementById('root')
const root = mount(container)
await flush(80)

const pill = container.querySelector('button.dsh-balance-pill')
assert.notEqual(pill, null, 'The pill renders')
assert.equal(pill.textContent, 'CNY 123.45 · USD 1.00', 'The pill shows every currency')
assert.equal(pill.getAttribute('aria-haspopup'), 'dialog')
assert.equal(pill.getAttribute('aria-expanded'), 'false')
assert.match(lastUrl, /\?tz=-?\d+$/, 'The poll carries the browser timezone offset')

await click(pill)
const panel = document.querySelector('.dsh-balance-panel')
assert.notEqual(panel, null, 'Clicking the pill opens the panel')
assert.equal(pill.getAttribute('aria-expanded'), 'true')
assert.equal(panel.getAttribute('role'), 'dialog')
assert.equal(panel.parentNode, document.body, 'The panel is portaled to <body>')
assert.equal(panel.querySelector('button.dsh-balance-panel-refresh') !== null, true, 'The panel offers a refresh action')

const rows = rowPairs(panel)
console.log('--- panel rows ---')
for (const [label, value] of rows) console.log(`${label}: ${value}`)

assert.deepEqual(rows[0], ['Balance', 'CNY 123.45 · USD 1.00'])
assert.deepEqual(rows[1], ['Granted', 'CNY 23.45 · USD 0.00'])
assert.deepEqual(rows[2], ['Topped up', 'CNY 100.00 · USD 1.00'])
assert.deepEqual(rows[3], ["Today's usage", 'CNY 4.20 · USD 0.42'])
assert.equal(rows.some(([label]) => label === 'Added today'), false, 'No top-up row when nothing was added')
assert.deepEqual(rows[4], ['Pricing now', 'Off-peak · half price'])
assert.equal(rows[5][0], 'Peak starts in', 'The countdown row names the next phase')
assert.match(rows[5][1], /^\d+h \d+m$/, 'The countdown reads as a duration')
assert.match(rows[6][0], /^Peak hours \(.+\)$/, 'The peak-hours row is labelled with the local zone')
assert.match(rows[6][1], /^\d{2}:\d{2}–\d{2}:\d{2}, \d{2}:\d{2}–\d{2}:\d{2}$/, 'Windows are rendered as local clock ranges')
assert.deepEqual(rows[7], ['Peak days', 'Mon–Fri'])
assert.match(panel.querySelector('.dsh-balance-panel-hint').textContent, /usage is estimated from balance drops/)
assert.equal(panel.querySelector('dd.is-off-peak').textContent, 'Off-peak · half price', 'Off-peak is toned as the cheap phase')

// The poll refreshes once the panel's refresh action is used.
const before = fetchCalls
await click(panel.querySelector('button.dsh-balance-panel-refresh'))
assert.equal(fetchCalls > before, true, 'Refresh re-polls the host route')

// An outside pointer press closes the panel.
document.body.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }))
await flush(40)
assert.equal(document.querySelector('.dsh-balance-panel'), null, 'An outside pointer press closes the panel')
assert.equal(pill.getAttribute('aria-expanded'), 'false')
root.unmount()

// --- scenario 2: a host without usage or pricing degrades cleanly ----------
payload = LEGACY_PAYLOAD
const legacyContainer = document.createElement('div')
document.body.appendChild(legacyContainer)
const legacyRoot = mount(legacyContainer)
await flush(80)
const legacyPill = legacyContainer.querySelector('button.dsh-balance-pill')
await click(legacyPill)

const legacyPanel = document.querySelector('.dsh-balance-panel')
assert.notEqual(legacyPanel, null, 'The panel still opens against an older host')
const legacyRows = rowPairs(legacyPanel)
console.log('--- legacy panel rows ---')
for (const [label, value] of legacyRows) console.log(`${label}: ${value}`)
assert.deepEqual(legacyRows[0], ['Balance', 'USD 1.00'])
assert.deepEqual(legacyRows[3], ["Today's usage", '—'], 'Missing usage shows a dash, not a crash')
assert.equal(legacyRows.some(([label]) => label === 'Pricing now'), false, 'No pricing rows without a pricing block')
assert.equal(
  legacyPanel.querySelector('.dsh-balance-panel-hint').textContent,
  'Restart DSH to load usage and pricing.',
  'The panel says what is missing',
)
legacyRoot.unmount()

console.log('client-check: all assertions passed')
process.exit(0)
