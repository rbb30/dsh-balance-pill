/**
 * dsh-balance-pill — host half.
 *
 * Registers `GET /dsh-balance-pill`: resolves `DEEPSEEK_API_KEY` through the
 * credentials seam (falling back to the ambient environment variable), calls
 * `GET https://api.deepseek.com/user/balance` with the platform `fetch`, and
 * answers the browser half with the account balance, an observation-based usage
 * ledger, and the DeepSeek peak/off-peak pricing phase.
 *
 * The key never leaves the host process. The upstream response is cached so
 * several open windows and the poll interval cannot hammer the API, and
 * concurrent misses share one in-flight request.
 *
 * @module dsh-balance-pill
 */

import { readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Route the browser half polls. */
const ROUTE = '/dsh-balance-pill'
/** DeepSeek balance endpoint. */
const BALANCE_URL = 'https://api.deepseek.com/user/balance'
/** Credential reference resolved per request. */
const KEY_REF = 'DEEPSEEK_API_KEY'
/** Poll interval echoed to the browser half. */
const DEFAULT_REFRESH_MS = 60_000
/** Upstream-response cache lifetime. */
const DEFAULT_CACHE_MS = 20_000
/** Upstream request timeout. */
const UPSTREAM_TIMEOUT_MS = 15_000
/** Usage-ledger file name under the DSH home. */
const USAGE_FILE = '.dsh-balance-pill-usage.json'
/** Ledger schema version. */
const USAGE_VERSION = 1
/** Ledger days retained. */
const USAGE_KEEP_DAYS = 90
/** Idle ledger write interval: keeps `last` fresh without writing every poll. */
const USAGE_IDLE_WRITE_MS = 5 * 60_000

/**
 * DeepSeek peak windows as UTC minutes-from-midnight: 01:00–04:00 and
 * 06:00–10:00, Monday to Friday, excluding Chinese public holidays. Off-peak
 * rates are half of peak, so a peak instant costs 2x the off-peak rate.
 * https://api-docs.deepseek.com/quick_start/pricing
 */
const PEAK_WINDOWS = [[60, 240], [360, 600]]

/** Days a next-transition search looks ahead before giving up. */
const TRANSITION_HORIZON_DAYS = 8

/** Host services this plugin needs. */
export const inject = ['webServer']

/**
 * Host plugin body: register the balance route.
 * @param ctx - host root context.
 * @param config - optional row config `{ refreshIntervalMs, cacheMs, cnHolidays, usageFile }`.
 * @returns Nothing; the route lives on the plugin's effect scope.
 */
export function apply(ctx, config) {
  const refreshIntervalMs = positive(config?.refreshIntervalMs, DEFAULT_REFRESH_MS)
  const cacheMs = nonNegative(config?.cacheMs, DEFAULT_CACHE_MS)
  const holidays = stringArray(config?.cnHolidays)
  const usagePath = typeof config?.usageFile === 'string' && config.usageFile !== ''
    ? config.usageFile
    : join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), USAGE_FILE)

  /** Last successful upstream read: `{ at, lines, isAvailable }`. */
  let cache
  /** In-flight upstream read, so concurrent misses share one request. */
  let inFlight
  /** Loaded usage ledger, or undefined before the first load attempt. */
  let ledger
  /** In-flight ledger load. */
  let ledgerLoad
  /** Instant of the last ledger write. */
  let ledgerWriteAt = 0
  /** Serialized ledger writes. */
  let ledgerChain = Promise.resolve()
  /** Timezone offset of the newest request, used to date the ledger sample. */
  let requestTz = 0

  /** Report a host-side problem without letting logging break the route. */
  const warn = (message) => {
    try {
      if (typeof ctx.logger?.warn === 'function') ctx.logger.warn(message)
    } catch {
      // A host without a usable logger keeps working.
    }
  }

  /** Load the ledger once; an unreadable or corrupt file starts a fresh one. */
  const loadLedger = async () => {
    if (ledger !== undefined) return ledger
    if (ledgerLoad === undefined) {
      ledgerLoad = (async () => {
        try {
          const parsed = JSON.parse(await readFile(usagePath, 'utf8'))
          ledger = parsed !== null && typeof parsed === 'object' ? parsed : emptyLedger(Date.now())
        } catch (error) {
          if (error?.code !== 'ENOENT') warn(`dsh-balance-pill: usage ledger unreadable: ${messageOf(error)}`)
          ledger = emptyLedger(Date.now())
        }
        return ledger
      })()
    }
    return ledgerLoad
  }

  /** Write the ledger atomically, serializing writes and swallowing failures. */
  const persistLedger = () => {
    const snapshot = `${JSON.stringify(ledger, null, 2)}\n`
    ledgerChain = ledgerChain.then(async () => {
      const temporary = `${usagePath}.${process.pid}.tmp`
      try {
        await writeFile(temporary, snapshot, { mode: 0o600 })
        await rename(temporary, usagePath)
        ledgerWriteAt = Date.now()
      } catch (error) {
        warn(`dsh-balance-pill: usage ledger not written: ${messageOf(error)}`)
      }
    })
    return ledgerChain
  }

  /** Read the balance once, cache it, and fold the sample into the ledger. */
  const refresh = (key) => {
    if (inFlight !== undefined) return inFlight
    inFlight = (async () => {
      const balance = await readBalance(key)
      const at = Date.now()
      const entry = { at, ...balance }
      cache = entry
      const state = await loadLedger()
      if (state !== undefined) {
        const applied = applyUsageSample(state, entry.lines, at, localDayKey(at, requestTz))
        ledger = applied.state
        if (applied.changed || at - ledgerWriteAt >= USAGE_IDLE_WRITE_MS) void persistLedger()
      }
      return entry
    })().finally(() => { inFlight = undefined })
    return inFlight
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE,
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { allow: 'GET, HEAD' })
        res.end()
        return
      }

      const now = Date.now()
      const tzOffset = timezoneOffsetOf(new URL(req.url ?? ROUTE, 'http://localhost').searchParams.get('tz'))
      requestTz = tzOffset
      /** Assemble one payload: balance fields plus the always-present extras. */
      const respond = (status, payload) => send(res, req, status, {
        refreshIntervalMs,
        pricing: pricingAt(now, holidays),
        usage: usageView(ledger, localDayKey(now, tzOffset)),
        ...payload,
      })

      const key = await resolveKey(ctx)
      if (key === undefined) {
        await loadLedger()
        respond(200, {
          ok: false,
          error: 'missing-key',
          message: `${KEY_REF} is not configured; set it in Settings → Models or export it`,
        })
        return
      }

      if (cache !== undefined && now - cache.at < cacheMs) {
        respond(200, balancePayload(cache))
        return
      }

      try {
        respond(200, balancePayload(await refresh(key)))
      } catch (error) {
        respond(502, { ok: false, error: 'upstream-error', message: messageOf(error) })
      }
    },
  }), 'dsh-balance-pill: balance route')
}

/**
 * Pricing phase at one instant, plus the next phase flip.
 * @param now - epoch milliseconds.
 * @param holidays - UTC day keys (`YYYY-MM-DD`) that are off-peak in full.
 * @returns Phase, rate multiplier, schedule, and the next change instant.
 */
export function pricingAt(now, holidays = []) {
  const holidaySet = holidays instanceof Set ? holidays : new Set(holidays)
  const peak = isPeak(new Date(now), holidaySet)
  const next = nextTransition(now, holidaySet)
  return {
    phase: peak ? 'peak' : 'off-peak',
    /** Off-peak is half of peak, so peak costs 2x the off-peak rate. */
    multiplier: peak ? 2 : 1,
    now,
    nextChangeAt: next?.at ?? null,
    nextPhase: next?.phase ?? null,
    schedule: {
      windowsUtc: PEAK_WINDOWS.map(([start, end]) => ({ start: minutesToClock(start), end: minutesToClock(end) })),
      weekdays: 'Mon–Fri',
      holidays: [...holidaySet].sort(),
      note: 'Peak is 01:00–04:00 and 06:00–10:00 UTC on weekdays; off-peak is half price, and weekends plus Chinese public holidays are off-peak in full.',
    },
  }
}

/**
 * Fold one balance sample into the ledger: a drop is spend, a rise is a top-up.
 * Pure — the caller owns persistence.
 * @param state - current ledger.
 * @param lines - balance lines from the API payload.
 * @param at - sample instant.
 * @param dayKey - local day the sample belongs to.
 * @returns The next ledger and whether a spend or top-up was recorded.
 */
export function applyUsageSample(state, lines, at, dayKey) {
  const totalsCents = {}
  for (const line of lines) totalsCents[line.currency] = toCents(line.total)

  const days = { ...(state.days ?? {}) }
  const previousDay = days[dayKey]
  const day = {
    spent: { ...(previousDay?.spent ?? {}) },
    toppedUp: { ...(previousDay?.toppedUp ?? {}) },
  }
  let changed = false
  const previous = state.last?.totalsCents
  if (previous !== undefined) {
    for (const [currency, cents] of Object.entries(totalsCents)) {
      if (!Object.hasOwn(previous, currency)) continue
      const delta = previous[currency] - cents
      if (delta > 0) {
        day.spent[currency] = (day.spent[currency] ?? 0) + delta
        changed = true
      } else if (delta < 0) {
        day.toppedUp[currency] = (day.toppedUp[currency] ?? 0) - delta
        changed = true
      }
    }
  }
  days[dayKey] = day

  return {
    state: {
      version: USAGE_VERSION,
      firstAt: state.firstAt ?? at,
      last: { at, totalsCents },
      days: pruneDays(days),
    },
    changed,
  }
}

/**
 * Browser-facing view of the ledger for one local day.
 * @param state - ledger, or undefined before it loads.
 * @param dayKey - local day key.
 * @returns Day totals per currency, or undefined while no ledger is available.
 */
export function usageView(state, dayKey) {
  if (state === undefined) return undefined
  const day = state.days?.[dayKey]
  const currencies = [...new Set([
    ...Object.keys(day?.spent ?? {}),
    ...Object.keys(day?.toppedUp ?? {}),
  ])].sort()
  return {
    day: dayKey,
    trackingSince: state.firstAt ?? null,
    today: currencies.map(currency => ({
      currency,
      spent: fromCents(day?.spent?.[currency] ?? 0),
      toppedUp: fromCents(day?.toppedUp?.[currency] ?? 0),
    })),
  }
}

/**
 * Local calendar day of one instant, given a browser timezone offset.
 * @param at - epoch milliseconds.
 * @param tzOffsetMinutes - `Date.prototype.getTimezoneOffset()` of the browser.
 * @returns `YYYY-MM-DD` in that zone.
 */
export function localDayKey(at, tzOffsetMinutes) {
  return new Date(at - tzOffsetMinutes * 60_000).toISOString().slice(0, 10)
}

/** Balance fields of one cached upstream read. */
function balancePayload(entry) {
  return {
    ok: true,
    fetchedAt: entry.at,
    isAvailable: entry.isAvailable,
    lines: entry.lines,
  }
}

/**
 * Resolve the DeepSeek API key: the credentials seam first, then the
 * environment. The seam is read lazily so a host without it still loads.
 * @param ctx - host root context.
 * @returns The key, or undefined while unconfigured.
 */
async function resolveKey(ctx) {
  try {
    const credentials = typeof ctx.get === 'function' ? ctx.get('credentials') : ctx.credentials
    if (credentials !== undefined && credentials !== null && typeof credentials.resolve === 'function') {
      const resolved = await credentials.resolve(KEY_REF)
      const value = resolved !== null && typeof resolved === 'object' ? resolved.value : resolved
      if (typeof value === 'string' && value.trim() !== '') return value
    }
  } catch {
    // A host without a working credentials seam falls through to the environment.
  }
  const ambient = process.env[KEY_REF]
  return typeof ambient === 'string' && ambient.trim() !== '' ? ambient : undefined
}

/**
 * Read the account balance from the DeepSeek API.
 * @param key - resolved API key.
 * @returns Balance lines and the availability flag.
 * @throws when the upstream request fails or its body is not usable JSON.
 */
async function readBalance(key) {
  const response = await fetch(BALANCE_URL, {
    headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`DeepSeek API ${response.status}: ${text.slice(0, 200)}`)

  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`Unparseable balance response: ${text.slice(0, 120)}`)
  }

  const infos = Array.isArray(data?.balance_infos) ? data.balance_infos : []
  return {
    isAvailable: data?.is_available !== false,
    lines: infos.map(line => ({
      currency: String(line?.currency ?? ''),
      total: String(line?.total_balance ?? ''),
      granted: String(line?.granted_balance ?? ''),
      toppedUp: String(line?.topped_up_balance ?? ''),
    })),
  }
}

/**
 * Whether an instant sits inside a DeepSeek peak window.
 * @param date - instant.
 * @param holidays - UTC day keys that are off-peak in full.
 * @returns Whether peak rates apply.
 */
function isPeak(date, holidays) {
  const weekday = date.getUTCDay()
  if (weekday === 0 || weekday === 6) return false
  if (holidays.has(utcDayKey(date))) return false
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes()
  return PEAK_WINDOWS.some(([start, end]) => minutes >= start && minutes < end)
}

/**
 * First instant after `now` whose phase differs from `now`'s phase.
 * @param now - epoch milliseconds.
 * @param holidays - UTC day keys that are off-peak in full.
 * @returns The instant and the phase it starts, or undefined beyond the horizon.
 */
function nextTransition(now, holidays) {
  const start = new Date(now)
  const midnight = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())
  const candidates = []
  for (let offset = 0; offset <= TRANSITION_HORIZON_DAYS; offset += 1) {
    const base = midnight + offset * 86_400_000
    candidates.push(base)
    for (const [windowStart, windowEnd] of PEAK_WINDOWS) {
      candidates.push(base + windowStart * 60_000, base + windowEnd * 60_000)
    }
  }
  const phaseNow = isPeak(start, holidays) ? 'peak' : 'off-peak'
  for (const at of candidates.sort((left, right) => left - right)) {
    if (at <= now) continue
    const phase = isPeak(new Date(at), holidays) ? 'peak' : 'off-peak'
    if (phase !== phaseNow) return { at, phase }
  }
  return undefined
}

/** `YYYY-MM-DD` of one instant in UTC. */
function utcDayKey(date) {
  return date.toISOString().slice(0, 10)
}

/** `HH:MM` from UTC minutes-from-midnight. */
function minutesToClock(minutes) {
  const hours = String(Math.floor(minutes / 60)).padStart(2, '0')
  return `${hours}:${String(minutes % 60).padStart(2, '0')}`
}

/** A ledger with no samples yet. */
function emptyLedger(at) {
  return { version: USAGE_VERSION, firstAt: at, days: {} }
}

/** Retain the newest `USAGE_KEEP_DAYS` day keys. */
function pruneDays(days) {
  const keys = Object.keys(days).sort()
  if (keys.length <= USAGE_KEEP_DAYS) return days
  const kept = {}
  for (const key of keys.slice(keys.length - USAGE_KEEP_DAYS)) kept[key] = days[key]
  return kept
}

/** Currency string to integer cents. */
function toCents(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.round(numeric * 100) : 0
}

/** Integer cents to a fixed two-decimal string. */
function fromCents(cents) {
  return (cents / 100).toFixed(2)
}

/**
 * Browser timezone offset from a query parameter.
 * @param value - raw `tz` parameter (`Date.prototype.getTimezoneOffset()`).
 * @returns Whole minutes; 0 when absent or unusable.
 */
function timezoneOffsetOf(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.trunc(numeric) : 0
}

/**
 * Answer one HTTP response with JSON (no body for HEAD).
 * @param res - server response.
 * @param req - incoming request.
 * @param status - HTTP status code.
 * @param payload - JSON-serializable payload.
 * @returns Nothing.
 */
function send(res, req, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': String(Buffer.byteLength(body)),
  })
  res.end(req.method === 'HEAD' ? undefined : body)
}

/**
 * Coerce a positive numeric config value.
 * @param value - candidate config value.
 * @param fallback - value used when the candidate is absent or unusable.
 * @returns A finite number greater than zero.
 */
function positive(value, fallback) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback
}

/**
 * Coerce a non-negative numeric config value.
 * @param value - candidate config value.
 * @param fallback - value used when the candidate is absent or unusable.
 * @returns A finite number greater than or equal to zero.
 */
function nonNegative(value, fallback) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback
}

/**
 * Coerce a config value into a list of non-empty strings.
 * @param value - candidate config value.
 * @returns The list, or an empty array.
 */
function stringArray(value) {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string' && item !== '') : []
}

/**
 * Best-effort message for an unknown thrown value.
 * @param error - thrown value.
 * @returns Human-readable message.
 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}
