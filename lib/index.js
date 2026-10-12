/**
 * dsh-balance-pill — host half.
 *
 * Registers `GET /dsh-balance-pill`: resolves `DEEPSEEK_API_KEY` through the
 * credentials seam (falling back to the ambient environment variable), calls
 * `GET https://api.deepseek.com/user/balance` with the platform `fetch`, and
 * answers the browser half with a small JSON payload. The key never leaves the
 * host process, and the upstream response is cached briefly so several open
 * windows and the poll interval cannot hammer the API.
 *
 * @module dsh-balance-pill
 */

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

/** Host services this plugin needs. */
export const inject = ['webServer']

/**
 * Host plugin body: register the balance route.
 * @param ctx - host root context.
 * @param config - optional row config `{ refreshIntervalMs, cacheMs }`.
 * @returns Nothing; the route lives on the plugin's effect scope.
 */
export function apply(ctx, config) {
  const refreshIntervalMs = positive(config?.refreshIntervalMs, DEFAULT_REFRESH_MS)
  const cacheMs = nonNegative(config?.cacheMs, DEFAULT_CACHE_MS)
  /** Last successful upstream payload, with the instant it was read. */
  let cache

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE,
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { allow: 'GET, HEAD' })
        res.end()
        return
      }

      const key = await resolveKey(ctx)
      if (key === undefined) {
        send(res, req, 200, {
          ok: false,
          error: 'missing-key',
          message: `${KEY_REF} is not configured; set it in Settings → Models or export it`,
          refreshIntervalMs,
        })
        return
      }

      if (cache !== undefined && Date.now() - cache.at < cacheMs) {
        send(res, req, 200, cache.body)
        return
      }

      try {
        const body = await readBalance(key, refreshIntervalMs)
        cache = { at: Date.now(), body }
        send(res, req, 200, body)
      } catch (error) {
        send(res, req, 502, {
          ok: false,
          error: 'upstream-error',
          message: messageOf(error),
          refreshIntervalMs,
        })
      }
    },
  }), 'dsh-balance-pill: balance route')
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
 * @param refreshIntervalMs - poll interval to echo to the browser half.
 * @returns The browser-facing payload.
 * @throws when the upstream request fails or its body is not usable JSON.
 */
async function readBalance(key, refreshIntervalMs) {
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
    ok: true,
    fetchedAt: Date.now(),
    refreshIntervalMs,
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
 * Best-effort message for an unknown thrown value.
 * @param error - thrown value.
 * @returns Human-readable message.
 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}
