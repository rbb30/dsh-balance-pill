/**
 * dsh-balance-pill — client half.
 *
 * Contributes one pill to `conversation.composer.dock`, the composer-dock list
 * slot whose last child is the context-occupancy ring, so the balance sits
 * directly beside the context-used reading. The pill polls the host half's
 * `/dsh-balance-pill` route (the API key never reaches the browser) and
 * refreshes on click.
 *
 * Hand-written `__ModuleLoader__` closure factory: React arrives through the
 * shell's shared module registry, so the bundle needs no build step. Styling
 * clones the context meter's trigger using the shell's `--dsw-*` theme tokens.
 *
 * @module dsh-balance-pill/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-balance-pill',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')

    /** Host-half route path. */
    const ROUTE = '/dsh-balance-pill'
    /** Fallback poll interval when the host response carries none. */
    const FALLBACK_INTERVAL_MS = 60_000
    /** Style tag identity, so a reload never stacks duplicate rules. */
    const STYLE_ID = 'dsh-balance-pill/client.js'
    /** Pill styling: the context meter trigger's geometry and tokens. */
    const CSS = [
      '.dsh-balance-pill {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  gap: 6px;',
      '  flex: none;',
      '  padding: 1px 8px;',
      '  border: none;',
      '  border-radius: var(--dsw-radius-sm, 6px);',
      '  background: transparent;',
      '  color: var(--dsw-alias-label-tertiary, #8b8f96);',
      '  font-family: inherit;',
      '  font-size: var(--dsh-content-font-size-secondary, 13px);',
      '  font-variant-numeric: tabular-nums;',
      '  line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px));',
      '  white-space: nowrap;',
      '  cursor: pointer;',
      '}',
      '.dsh-balance-pill:hover {',
      '  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.12));',
      '  color: var(--dsw-alias-label-secondary, #b6bac0);',
      '}',
      '.dsh-balance-pill:focus-visible {',
      '  outline: 2px solid var(--dsw-alias-brand-primary, #4d6bfe);',
      '  outline-offset: 1px;',
      '}',
      '.dsh-balance-pill-dot {',
      '  display: inline-block;',
      '  flex: none;',
      '  width: 6px;',
      '  height: 6px;',
      '  border-radius: 999px;',
      '}',
    ].join('\n')

    /** Inject the pill's stylesheet once per page. */
    function injectStyle() {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-plugin-css="' + STYLE_ID + '"]') !== null) return
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-balance-pill'
      tag.dataset.pluginCss = STYLE_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    /**
     * Status dot colour: idle while loading, error red, success green, amber
     * once the account reports exhausted funds.
     * @param state - current pill state.
     * @returns A CSS colour (a theme token with a literal fallback).
     */
    function dotColor(state) {
      if (state.status === 'loading') return 'var(--dsw-alias-state-idle-primary, #6b7280)'
      if (state.status === 'error') return 'var(--dsw-alias-state-error-primary, #ef4444)'
      return state.isAvailable
        ? 'var(--dsw-alias-state-success-primary, #10b981)'
        : 'var(--dsw-alias-state-warn-primary, #f59e0b)'
    }

    /**
     * Compact pill label: `CNY 110.00 · USD 1.00`.
     * @param state - current pill state.
     * @returns The reading shown in the dock.
     */
    function reading(state) {
      if (state.status === 'loading') return 'Balance …'
      if (state.status === 'error') return 'Balance n/a'
      if (state.lines.length === 0) return 'Balance —'
      return state.lines
        .map(line => (line.currency === '' ? line.total : line.currency + ' ' + line.total))
        .join(' · ')
    }

    /**
     * Hover tooltip: the granted / topped-up split, the failure reason, and the
     * click hint.
     * @param state - current pill state.
     * @returns Tooltip text.
     */
    function tooltip(state) {
      const hint = 'Click to refresh'
      if (state.status === 'loading') return 'DeepSeek API balance · loading… · ' + hint
      if (state.status === 'error') return 'DeepSeek API balance · ' + state.message + ' · ' + hint
      const head = state.isAvailable ? 'DeepSeek API balance' : 'DeepSeek API balance · funds exhausted'
      if (state.lines.length === 0) return head + ' · ' + hint
      const detail = state.lines
        .map(line => line.currency + ' total ' + line.total
          + ' (granted ' + line.granted + ', topped up ' + line.toppedUp + ')')
        .join(' · ')
      return head + ' · ' + detail + ' · ' + hint
    }

    /**
     * The dock pill: polls the host route on the interval the host echoes,
     * refreshes immediately on click, and survives unmount without a stray timer.
     * @returns The pill node.
     */
    function BalancePill() {
      const [state, setState] = React.useState({ status: 'loading', lines: [] })
      const [refreshToken, setRefreshToken] = React.useState(0)
      const intervalRef = React.useRef(FALLBACK_INTERVAL_MS)

      React.useEffect(() => {
        let cancelled = false
        let timer
        const load = async () => {
          try {
            const response = await fetch(ROUTE, { cache: 'no-store' })
            const data = await response.json()
            if (cancelled) return
            if (Number(data.refreshIntervalMs) > 0) intervalRef.current = Number(data.refreshIntervalMs)
            if (data.ok) {
              setState({
                status: 'ok',
                lines: Array.isArray(data.lines) ? data.lines : [],
                isAvailable: data.isAvailable !== false,
              })
            } else {
              setState({ status: 'error', lines: [], message: data.message || data.error || 'unavailable' })
            }
          } catch (error) {
            if (!cancelled) {
              setState({
                status: 'error',
                lines: [],
                message: error instanceof Error ? error.message : String(error),
              })
            }
          }
        }
        const schedule = () => {
          if (cancelled) return
          timer = setTimeout(() => { void load().finally(schedule) }, intervalRef.current)
        }
        void load().finally(schedule)
        return () => {
          cancelled = true
          if (timer !== undefined) clearTimeout(timer)
        }
      }, [refreshToken])

      return React.createElement('button', {
        type: 'button',
        className: 'dsh-balance-pill',
        title: tooltip(state),
        'aria-label': 'DeepSeek API balance',
        onClick: () => { setRefreshToken(token => token + 1) },
      },
        React.createElement('span', {
          className: 'dsh-balance-pill-dot',
          style: { background: dotColor(state) },
          'aria-hidden': true,
        }),
        React.createElement('span', null, reading(state)))
    }

    injectStyle()

    /** Client services this plugin needs (the slot registry). */
    const inject = ['slots']

    /**
     * Client plugin body: contribute the pill beside the context meter.
     * @param ctx - client root context.
     * @returns Nothing.
     */
    function apply(ctx) {
      ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
        name: 'conversation.composer.dock',
        id: 'balance',
        order: 5,
        label: 'DeepSeek balance',
      }, BalancePill))
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
