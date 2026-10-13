/**
 * Pricing-phase and usage-ledger check: the host half's pure behaviour on fixed
 * clocks. No network, no credentials, no files.
 *
 *   node tests/pricing-check.mjs
 */

import assert from 'node:assert/strict'
import { applyUsageSample, localDayKey, pricingAt, usageView } from '../lib/index.js'

/** Epoch milliseconds from an ISO instant. */
const utc = (text) => Date.parse(text)

// DeepSeek peak windows: 01:00-04:00 and 06:00-10:00 UTC, Mon-Fri (off-peak is
// half price, and weekends plus Chinese public holidays are off-peak in full).
const phases = [
  ['2026-10-13T02:00:00Z', 'peak', '2026-10-13T04:00:00Z', 'Weekday inside the first window'],
  ['2026-10-13T03:59:00Z', 'peak', '2026-10-13T04:00:00Z', 'Last minute of the first window'],
  ['2026-10-13T04:00:00Z', 'off-peak', '2026-10-13T06:00:00Z', 'Gap between the two windows'],
  ['2026-10-13T07:00:00Z', 'peak', '2026-10-13T10:00:00Z', 'Weekday inside the second window'],
  ['2026-10-13T10:00:00Z', 'off-peak', '2026-10-14T01:00:00Z', 'After the last window of the day'],
  ['2026-10-13T13:38:00Z', 'off-peak', '2026-10-14T01:00:00Z', 'Afternoon of a weekday'],
  ['2026-10-17T02:00:00Z', 'off-peak', '2026-10-19T01:00:00Z', 'Saturday is off-peak, so the flip is Monday'],
  ['2026-10-18T23:59:00Z', 'off-peak', '2026-10-19T01:00:00Z', 'Sunday night stays off-peak into Monday'],
]
for (const [instant, phase, nextChange, label] of phases) {
  const pricing = pricingAt(utc(instant))
  assert.equal(pricing.phase, phase, `${label}: phase`)
  assert.equal(pricing.multiplier, phase === 'peak' ? 2 : 1, `${label}: multiplier`)
  assert.equal(pricing.nextPhase, phase === 'peak' ? 'off-peak' : 'peak', `${label}: next phase`)
  assert.equal(pricing.nextChangeAt, utc(nextChange), `${label}: next change`)
}

assert.deepEqual(
  pricingAt(utc('2026-10-13T13:38:00Z')).schedule.windowsUtc,
  [{ start: '01:00', end: '04:00' }, { start: '06:00', end: '10:00' }],
  'Schedule windows are reported as UTC clock strings',
)
assert.equal(pricingAt(utc('2026-10-13T13:38:00Z')).schedule.weekdays, 'Mon–Fri')

// A holiday is off-peak in full, so a weekday window contributes no flip.
const holiday = pricingAt(utc('2026-10-13T02:00:00Z'), ['2026-10-13'])
assert.equal(holiday.phase, 'off-peak', 'Holiday overrides a weekday peak window')
assert.equal(
  holiday.nextChangeAt,
  utc('2026-10-14T01:00:00Z'),
  'Holiday defers the flip to the next weekday window',
)
assert.deepEqual(holiday.schedule.holidays, ['2026-10-13'])

// Local day boundaries follow the browser's offset.
assert.equal(localDayKey(utc('2026-10-13T23:30:00Z'), -60), '2026-10-14', 'UTC+1 rolls into the next local day')
assert.equal(localDayKey(utc('2026-10-13T23:30:00Z'), 0), '2026-10-13', 'UTC keeps the UTC day')

// Ledger: a balance drop is spend, a rise is a top-up, and a top-up never
// cancels spend already observed on the same day.
/** One balance line at a total. */
const line = (total) => [{ currency: 'USD', total, granted: '0.00', toppedUp: total }]

let state = { version: 1, firstAt: utc('2026-10-13T09:00:00Z'), days: {} }
let step = applyUsageSample(state, line('4.11'), utc('2026-10-13T09:00:00Z'), '2026-10-13')
assert.equal(step.changed, false, 'The first sample records no delta')
state = step.state

step = applyUsageSample(state, line('4.00'), utc('2026-10-13T10:00:00Z'), '2026-10-13')
assert.equal(step.changed, true, 'A drop is recorded')
assert.deepEqual(step.state.days['2026-10-13'].spent, { USD: 11 }, 'A 0.11 drop is 11 cents of spend')
state = step.state

step = applyUsageSample(state, line('5.00'), utc('2026-10-13T11:00:00Z'), '2026-10-13')
assert.deepEqual(step.state.days['2026-10-13'].toppedUp, { USD: 100 }, 'A 1.00 rise is a top-up')
assert.deepEqual(step.state.days['2026-10-13'].spent, { USD: 11 }, 'A top-up never erases recorded spend')
state = step.state

step = applyUsageSample(state, line('4.90'), utc('2026-10-14T09:00:00Z'), '2026-10-14')
assert.deepEqual(step.state.days['2026-10-14'].spent, { USD: 10 }, 'A new local day starts a new bucket')
assert.equal(Object.keys(step.state.days).length, 2, 'Both days are retained')
assert.equal(step.state.firstAt, utc('2026-10-13T09:00:00Z'), 'Tracking start is preserved')

// A currency that was absent from the previous sample contributes no delta.
const switched = applyUsageSample(
  { version: 1, firstAt: 1, last: { at: 1, totalsCents: { USD: 100 } }, days: {} },
  [{ currency: 'CNY', total: '10.00' }],
  2,
  '2026-10-13',
)
assert.deepEqual(switched.state.days['2026-10-13'].spent, {}, 'A newly seen currency has no baseline')

// The browser-facing view.
const view = usageView(state, '2026-10-13')
assert.equal(view.day, '2026-10-13')
assert.equal(view.trackingSince, utc('2026-10-13T09:00:00Z'))
assert.deepEqual(view.today, [{ currency: 'USD', spent: '0.11', toppedUp: '1.00' }])
assert.equal(usageView(undefined, '2026-10-13'), undefined, 'No ledger yet means no usage block')

console.log('pricing-check: all assertions passed')
