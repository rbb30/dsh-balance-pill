/**
 * dsh-balance-pill — client half.
 *
 * Contributes one pill to `conversation.composer.dock`, the composer-dock list
 * slot whose last child is the context-occupancy ring, so the balance sits
 * directly beside the context-used reading. Clicking the pill opens a
 * trigger-anchored panel — the same menu surface the harness's own stat pills
 * use — with the balance, today's estimated usage, and the DeepSeek peak /
 * off-peak pricing phase with a live countdown to the next flip.
 *
 * Hand-written `__ModuleLoader__` closure factory: React and react-dom arrive
 * through the shell's shared module registry, so the bundle needs no build step
 * and no harness-internal imports. Styling clones the harness panel skin using
 * the shell's `--dsw-*` theme tokens.
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
    const { createPortal } = require('react-dom')

    /** Host-half route path. */
    const ROUTE = '/dsh-balance-pill'
    /** Fallback poll interval when the host response carries none. */
    const FALLBACK_INTERVAL_MS = 60_000
    /** Viewport margin the panel placement keeps. */
    const PANEL_MARGIN = 12
    /** Distance between the pill's top edge and the panel's bottom. */
    const PANEL_GAP = 8
    /** Style tag identity, so a reload never stacks duplicate rules. */
    const STYLE_ID = 'dsh-balance-pill/client.js'
    /** Hidden-but-laid-out placement used for the measuring pass. */
    const MEASURE_STYLE = { visibility: 'hidden', left: 0, top: 0 }

    /**
     * Pill + panel styling. The panel block mirrors the harness stat-dialog
     * skin (`stat-dialog.module.css`): menu surface, elevation-prominent, 16px
     * padding, 12px/18px type, two-column detail grid.
     */
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
      '.dsh-balance-pill:hover,',
      '.dsh-balance-pill[aria-expanded="true"] {',
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
      '.dsh-balance-panel {',
      '  position: fixed;',
      '  z-index: 1100;',
      '  box-sizing: border-box;',
      '  width: max-content;',
      '  min-width: min(300px, calc(100vw - 24px));',
      '  max-width: min(420px, calc(100vw - 24px));',
      '  padding: 16px;',
      '  border: 0;',
      '  border-radius: var(--dsw-radius-lg);',
      '  background: var(--dsw-specific-menu);',
      '  backdrop-filter: var(--dsw-menu-backdrop-filter);',
      '  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);',
      '  box-shadow: var(--dsw-elevation-prominent);',
      '  font-size: 12px;',
      '  line-height: 18px;',
      '  color: var(--dsw-alias-label-secondary);',
      '  cursor: default;',
      '}',
      '.dsh-balance-panel-title {',
      '  display: flex;',
      '  justify-content: space-between;',
      '  gap: 16px;',
      '  margin-bottom: 8px;',
      '  color: var(--dsw-alias-label-primary);',
      '  font-weight: 500;',
      '}',
      '.dsh-balance-panel-label {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  gap: 6px;',
      '  min-width: 0;',
      '}',
      '.dsh-balance-panel-label svg {',
      '  width: 14px;',
      '  height: 14px;',
      '  flex: none;',
      '}',
      '.dsh-balance-panel-rule {',
      '  margin-bottom: 10px;',
      '  border-top: 0.5px solid var(--dsw-alias-border-l2);',
      '}',
      '.dsh-balance-panel-details {',
      '  display: grid;',
      '  grid-template-columns: minmax(76px, auto) minmax(0, 1fr);',
      '  gap: 6px 16px;',
      '  margin: 0;',
      '  color: var(--dsw-alias-label-tertiary);',
      '}',
      '.dsh-balance-panel-details dt,',
      '.dsh-balance-panel-details dd {',
      '  min-width: 0;',
      '  margin: 0;',
      '}',
      '.dsh-balance-panel-details dd {',
      '  color: var(--dsw-alias-label-secondary);',
      '  font-variant-numeric: tabular-nums;',
      '  text-align: right;',
      '}',
      '.dsh-balance-panel-details dd.is-peak {',
      '  color: var(--dsw-alias-state-warn-primary, #f59e0b);',
      '}',
      '.dsh-balance-panel-details dd.is-off-peak {',
      '  color: var(--dsw-alias-state-success-primary, #10b981);',
      '}',
      '.dsh-balance-panel-refresh {',
      '  flex: none;',
      '  padding: 0 2px;',
      '  border: none;',
      '  border-radius: var(--dsw-radius-sm, 6px);',
      '  background: transparent;',
      '  color: var(--dsw-alias-label-tertiary);',
      '  font: inherit;',
      '  cursor: pointer;',
      '}',
      '.dsh-balance-panel-refresh:hover {',
      '  color: var(--dsw-alias-label-secondary);',
      '}',
      '.dsh-balance-panel-hint {',
      '  margin-top: 10px;',
      '  color: var(--dsw-alias-label-tertiary);',
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
        .map(line => money(line.currency, line.total))
        .join(' · ')
    }

    /**
     * Hover tooltip: the granted / topped-up split, the failure reason, and the
     * click hint.
     * @param state - current pill state.
     * @returns Tooltip text.
     */
    function tooltip(state) {
      const hint = 'Click for details'
      if (state.status === 'loading') return 'DeepSeek API balance · loading… · ' + hint
      if (state.status === 'error') return 'DeepSeek API balance · ' + state.message + ' · ' + hint
      const head = state.isAvailable ? 'DeepSeek API balance' : 'DeepSeek API balance · funds exhausted'
      if (state.lines.length === 0) return head + ' · ' + hint
      const detail = state.lines
        .map(line => money(line.currency, line.total)
          + ' (granted ' + money(line.currency, line.granted)
          + ', topped up ' + money(line.currency, line.toppedUp) + ')')
        .join(' · ')
      return head + ' · ' + detail + ' · ' + hint
    }

    /**
     * One currency-prefixed amount.
     * @param currency - ISO currency code, possibly empty.
     * @param value - amount text.
     * @returns Display text.
     */
    function money(currency, value) {
      return currency === '' || currency === undefined ? String(value) : currency + ' ' + String(value)
    }

    /**
     * Compact countdown: `2d 3h`, `11h 22m`, `5m 30s`, `42s`.
     * @param ms - remaining milliseconds.
     * @returns Display text.
     */
    function formatCountdown(ms) {
      const total = Math.max(0, Math.round(ms / 1000))
      const days = Math.floor(total / 86_400)
      const hours = Math.floor((total % 86_400) / 3_600)
      const minutes = Math.floor((total % 3_600) / 60)
      const seconds = total % 60
      if (days > 0) return days + 'd ' + hours + 'h'
      if (hours > 0) return hours + 'h ' + minutes + 'm'
      if (minutes > 0) return minutes + 'm ' + seconds + 's'
      return seconds + 's'
    }

    /**
     * Peak windows rendered as local clock ranges for today.
     * @param pricing - host pricing block.
     * @returns `02:00–05:00, 07:00–11:00`, or null when the host sent no schedule.
     */
    function localWindows(pricing) {
      const windows = pricing?.schedule?.windowsUtc
      if (!Array.isArray(windows) || windows.length === 0) return null
      const base = new Date()
      return windows.map(window => {
        const start = clockInstant(window.start, base)
        const end = clockInstant(window.end, base)
        if (start === null || end === null) return null
        return formatClock(start) + '–' + formatClock(end)
      }).filter(part => part !== null).join(', ') || null
    }

    /**
     * Build today's instant for one UTC clock string.
     * @param clock - `HH:MM`.
     * @param base - instant supplying today's date.
     * @returns The instant, or null when the clock string is unusable.
     */
    function clockInstant(clock, base) {
      if (typeof clock !== 'string') return null
      const [hours, minutes] = clock.split(':').map(Number)
      if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
      return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), hours, minutes))
    }

    /** `HH:MM` of a local instant. */
    function formatClock(date) {
      return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0')
    }

    /** Local IANA zone name, for labelling the converted peak hours. */
    function localZone() {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone
      } catch {
        return new Date().toString().match(/\(([^)]+)\)$/)?.[1] ?? 'local time'
      }
    }

    /**
     * Total of one usage field across currencies.
     * @param usage - host usage block.
     * @param field - `spent` or `toppedUp`.
     * @returns Display text, or null when the host sent no usage.
     */
    function usageTotals(usage, field) {
      if (usage === undefined || !Array.isArray(usage.today) || usage.today.length === 0) return null
      return usage.today.map(entry => money(entry.currency, entry[field])).join(' · ')
    }

    /**
     * Whether any currency recorded a non-zero value for one usage field.
     * @param usage - host usage block.
     * @param field - `spent` or `toppedUp`.
     * @returns Whether the field is worth a row.
     */
    function usageHas(usage, field) {
      return usage !== undefined && Array.isArray(usage.today)
        && usage.today.some(entry => Number(entry[field]) > 0)
    }

    /**
     * Re-render every second while a countdown is on screen.
     * @param active - whether a countdown is visible.
     * @returns Current epoch milliseconds.
     */
    function useNowTick(active) {
      const [now, setNow] = React.useState(() => Date.now())
      React.useEffect(() => {
        if (!active) return undefined
        setNow(Date.now())
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(timer)
      }, [active])
      return now
    }

    /**
     * Viewport-clamped placement above the pill, re-measured on resize and scroll.
     * @param open - whether the panel is mounted.
     * @param anchorRef - pill element ref.
     * @param panelRef - panel element ref.
     * @returns `{ left, top }`, or null during the measuring pass.
     */
    function usePanelPosition(open, anchorRef, panelRef) {
      const [position, setPosition] = React.useState(null)
      React.useLayoutEffect(() => {
        if (!open) {
          setPosition(null)
          return undefined
        }
        const place = () => {
          const anchor = anchorRef.current
          const panel = panelRef.current
          if (anchor === null || panel === null) return
          const rect = anchor.getBoundingClientRect()
          const box = panel.getBoundingClientRect()
          const width = window.innerWidth
          const height = window.innerHeight
          const left = Math.min(
            Math.max(PANEL_MARGIN, rect.left + rect.width / 2 - box.width / 2),
            Math.max(PANEL_MARGIN, width - box.width - PANEL_MARGIN),
          )
          const above = rect.top - box.height - PANEL_GAP
          const top = above >= PANEL_MARGIN
            ? above
            : Math.min(rect.bottom + PANEL_GAP, Math.max(PANEL_MARGIN, height - box.height - PANEL_MARGIN))
          setPosition(current => (current !== null && current.left === left && current.top === top
            ? current
            : { left, top }))
        }
        place()
        window.addEventListener('resize', place)
        window.addEventListener('scroll', place, true)
        return () => {
          window.removeEventListener('resize', place)
          window.removeEventListener('scroll', place, true)
        }
      }, [open, anchorRef, panelRef])
      return position
    }

    /**
     * Close on an outside pointer press or Escape, counting the panel as inside.
     * @param open - whether the panel is mounted.
     * @param close - close callback.
     * @param rootRef - pill element ref.
     * @param panelRef - panel element ref.
     * @returns Nothing.
     */
    function useDismiss(open, close, rootRef, panelRef) {
      React.useEffect(() => {
        if (!open) return undefined
        const inside = (ref, target) => {
          const node = ref.current
          return node !== null && target !== null && typeof target === 'object' && node.contains(target)
        }
        const onPointerDown = (event) => {
          if (inside(rootRef, event.target) || inside(panelRef, event.target)) return
          close()
        }
        const onKeyDown = (event) => {
          if (event.key === 'Escape') close()
        }
        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown)
        return () => {
          document.removeEventListener('pointerdown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown)
        }
      }, [open, close, rootRef, panelRef])
    }

    /** Section glyph: an account/card mark, matching the harness's 14px icons. */
    const ICON = React.createElement('svg', { viewBox: '0 0 16 16', 'aria-hidden': true },
      React.createElement('rect', {
        x: 2, y: 4.5, width: 12, height: 8, rx: 2, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5,
      }),
      React.createElement('circle', { cx: 11, cy: 8.5, r: 1, fill: 'currentColor' }))

    /**
     * The detail panel: balance rows, today's estimated usage, and the pricing
     * phase with a live countdown to the next flip.
     * @param props - panel ref, current state, refresh callback, placement.
     * @returns The panel node.
     */
    function BalancePanel({ panelRef, state, onRefresh, position }) {
      const pricing = state.pricing
      const usage = state.usage
      const nextChangeAt = typeof pricing?.nextChangeAt === 'number' ? pricing.nextChangeAt : null
      const now = useNowTick(nextChangeAt !== null)
      const remaining = nextChangeAt === null ? null : Math.max(0, nextChangeAt - now)
      const expired = remaining === 0

      // A flipped phase must not wait for the next poll to show: refresh once the
      // countdown reaches zero, then the host answers with the new phase.
      React.useEffect(() => {
        if (expired) onRefresh()
      }, [expired, onRefresh])

      const rows = []
      if (state.status === 'loading') {
        rows.push({ label: 'Balance', value: 'Loading…' })
      } else if (state.lines.length === 0) {
        rows.push({ label: 'Balance', value: state.status === 'error' ? 'Unavailable' : '—' })
      } else {
        rows.push({ label: 'Balance', value: state.lines.map(line => money(line.currency, line.total)).join(' · ') })
        rows.push({ label: 'Granted', value: state.lines.map(line => money(line.currency, line.granted)).join(' · ') })
        rows.push({ label: 'Topped up', value: state.lines.map(line => money(line.currency, line.toppedUp)).join(' · ') })
      }
      if (state.status === 'error') rows.push({ label: 'Error', value: state.message })

      const spent = usageTotals(usage, 'spent')
      rows.push({ label: "Today's usage", value: spent ?? '—' })
      if (usageHas(usage, 'toppedUp')) rows.push({ label: 'Added today', value: usageTotals(usage, 'toppedUp') })

      if (pricing !== undefined) {
        const peak = pricing.phase === 'peak'
        rows.push({
          label: 'Pricing now',
          value: peak ? 'Peak · ×2 rates' : 'Off-peak · half price',
          tone: peak ? 'is-peak' : 'is-off-peak',
        })
        rows.push({
          label: peak ? 'Off-peak starts in' : 'Peak starts in',
          value: remaining === null ? '—' : formatCountdown(remaining),
        })
        const windows = localWindows(pricing)
        if (windows !== null) rows.push({ label: 'Peak hours (' + localZone() + ')', value: windows })
        if (typeof pricing.schedule?.weekdays === 'string') {
          rows.push({ label: 'Peak days', value: pricing.schedule.weekdays })
        }
      }

      const updated = typeof state.fetchedAt === 'number'
        ? new Date(state.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : null
      const hint = pricing === undefined
        ? 'Restart DSH to load usage and pricing.'
        : [
          updated === null ? null : 'Updated ' + updated,
          'usage is estimated from balance drops while DSH runs',
        ].filter(part => part !== null).join(' · ')

      const children = []
      rows.forEach((row, index) => {
        children.push(React.createElement('dt', { key: 'l' + index }, row.label))
        children.push(React.createElement('dd', { key: 'v' + index, className: row.tone }, row.value))
      })

      return React.createElement('div', {
        ref: panelRef,
        className: 'dsh-balance-panel',
        style: position ?? MEASURE_STYLE,
        role: 'dialog',
        'aria-label': 'DeepSeek balance',
      },
        React.createElement('div', { className: 'dsh-balance-panel-title' },
          React.createElement('span', { className: 'dsh-balance-panel-label' }, ICON, 'DeepSeek balance'),
          React.createElement('button', {
            type: 'button',
            className: 'dsh-balance-panel-refresh',
            onClick: onRefresh,
          }, 'Refresh')),
        React.createElement('div', { className: 'dsh-balance-panel-rule' }),
        React.createElement('dl', { className: 'dsh-balance-panel-details' }, children),
        React.createElement('div', { className: 'dsh-balance-panel-hint' }, hint))
    }

    /**
     * The dock pill: polls the host route on the interval the host echoes,
     * opens the detail panel on click, and survives unmount without a stray timer.
     * @returns The pill node.
     */
    function BalancePill() {
      const [state, setState] = React.useState({ status: 'loading', lines: [] })
      const [refreshToken, setRefreshToken] = React.useState(0)
      const [open, setOpen] = React.useState(false)
      const rootRef = React.useRef(null)
      const panelRef = React.useRef(null)
      const intervalRef = React.useRef(FALLBACK_INTERVAL_MS)
      const position = usePanelPosition(open, rootRef, panelRef)
      const refresh = React.useCallback(() => { setRefreshToken(token => token + 1) }, [])
      const close = React.useCallback(() => { setOpen(false) }, [])
      useDismiss(open, close, rootRef, panelRef)

      React.useEffect(() => {
        let cancelled = false
        let timer
        const load = async () => {
          try {
            const query = '?tz=' + new Date().getTimezoneOffset()
            const response = await fetch(ROUTE + query, { cache: 'no-store' })
            const data = await response.json()
            if (cancelled) return
            if (Number(data.refreshIntervalMs) > 0) intervalRef.current = Number(data.refreshIntervalMs)
            if (data.ok) {
              setState({
                status: 'ok',
                lines: Array.isArray(data.lines) ? data.lines : [],
                isAvailable: data.isAvailable !== false,
                fetchedAt: data.fetchedAt,
                pricing: data.pricing,
                usage: data.usage,
              })
            } else {
              setState({
                status: 'error',
                lines: [],
                message: data.message || data.error || 'unavailable',
                fetchedAt: data.fetchedAt,
                pricing: data.pricing,
                usage: data.usage,
              })
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

      return React.createElement(React.Fragment, null,
        React.createElement('button', {
          ref: rootRef,
          type: 'button',
          className: 'dsh-balance-pill',
          title: tooltip(state),
          'aria-label': 'DeepSeek API balance',
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
          onClick: () => {
            setOpen(value => !value)
            refresh()
          },
        },
          React.createElement('span', {
            className: 'dsh-balance-pill-dot',
            style: { background: dotColor(state) },
            'aria-hidden': true,
          }),
          React.createElement('span', null, reading(state))),
        open && typeof document !== 'undefined'
          ? createPortal(React.createElement(BalancePanel, {
            panelRef,
            state,
            onRefresh: refresh,
            position,
          }), document.body)
          : null)
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
