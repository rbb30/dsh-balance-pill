# dsh-balance-pill

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) plugin
that shows your DeepSeek API account balance as a small pill in the **composer
dock** — the row under the input box that already holds the context-occupancy
ring — and opens a detail panel when clicked.

```
[ output speed ] [ cache hit ] [ ● CNY 42.00 ] [ ◔ 45% ]
                                 ^ this pill     ^ context meter
```

Clicking the pill opens a trigger-anchored panel on the same menu surface the
harness's own stat pills use:

```
◎  DeepSeek balance                          Refresh
────────────────────────────────────────────────────
Balance                                    CNY 42.00
Granted                                    CNY 2.00
Topped up                                  CNY 40.00
Today's usage                              CNY 1.37
Pricing now                          Off-peak · half price
Peak starts in                                7h 12m
Peak hours (Europe/Lisbon)      02:00–05:00, 07:00–10:00
Peak days                                    Mon–Fri
Updated 14:38 · usage is estimated from balance drops while DSH runs
```

- **Host half** registers `GET /dsh-balance-pill`: it resolves
  `DEEPSEEK_API_KEY` from the DSH credentials seam (falling back to
  `$DEEPSEEK_API_KEY`), calls `GET https://api.deepseek.com/user/balance`, keeps
  a 20s response cache (concurrent misses share one in-flight request), folds
  each observed balance into a usage ledger, and reports the current pricing
  phase. The key never reaches the browser.
- **Client half** contributes one entry to the `conversation.composer.dock` list
  slot, polls every 60s (the interval the host echoes), and renders the panel.
- **Status dot**: grey while loading, green with funds, amber when the account
  reports no available balance, red when the request failed.
- Cross-platform: Node's `fetch`, no shell-outs, no Windows-only paths.
- No build step: the host half is plain ESM, and the client half is a
  self-contained `__ModuleLoader__.load({ id, factory })` closure that pulls
  React and react-dom from the shell's shared module registry — no
  harness-internal imports beyond those two.

## Pricing phase

DeepSeek prices peak hours at **2× the off-peak rate** (off-peak is half price).
Per the [Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing)
page, peak hours are **01:00–04:00 and 06:00–10:00 UTC, Monday to Friday,
excluding Chinese public holidays**; every other hour is off-peak, including
weekends and Chinese public holidays in full.

The panel shows the phase you are in now, a live countdown to the next flip, and
the peak windows converted to your local timezone. The countdown refreshes the
host when it reaches zero, so a flip does not wait for the next poll.

Chinese public holidays are off-peak, and this plugin cannot know them. List
them as UTC day keys to keep the phase exact:

```yaml
config:
  cnHolidays:
    - '2026-10-01'
    - '2026-10-02'
```

## Usage ledger

The balance API has no usage endpoint, so today's figure is **observed**: the
host records every balance sample it sees and treats a drop as spend and a rise
as a top-up. That means:

- it counts only spend that happened **while DSH was running**, so a long gap
  between sessions is credited to the day the app next looked, not to the day it
  happened;
- granted balance and topped-up balance are not separated in the spend figure —
  the API reports one total per currency;
- the ledger lives in `${DSH_HOME:-$HOME/.dsh}/.dsh-balance-pill-usage.json`,
  keeps 90 days, and is written atomically at most once per 5 minutes when
  nothing changed.

## Install

### Desktop app (Electron)

The desktop application owns its `desktop` profile, so the CLI refuses it
(`dsh plugin --profile desktop` errors out). Install through the app's plugin
manager, or replicate what that manager does:

```sh
cd "${DSH_HOME:-$HOME/.dsh}/profiles/desktop"
pnpm add "link:/path/to/dsh-balance-pill"
# then add "dsh-balance-pill" to dsh.profile.bundles in that package.json
```

A full app restart composes the bundle layer and the browser module graph.

### Web (`dsh web`)

```sh
dsh plugin --profile web add link:/path/to/dsh-balance-pill
# or straight from git:
dsh plugin --profile web add github:rbb30/dsh-balance-pill
```

## Configure

Optional overrides on the bundle row in `cordis.patch.yml`:

```yaml
- insert:
    - id: dsh-balance-pill
      name: 'dsh-balance-pill'
      inject: [webServer]
      config:
        refreshIntervalMs: 60000          # poll interval the browser half uses
        cacheMs: 20000                    # upstream response cache lifetime
        cnHolidays: ['2026-10-01']        # off-peak holidays, UTC day keys
        usageFile: /path/to/usage.json    # default: $DSH_HOME/.dsh-balance-pill-usage.json
```

## Checks

```sh
node tests/pricing-check.mjs  # pricing phases and the usage ledger, no network
node tests/client-check.mjs   # jsdom + React: pill, panel rows, dismissal
node tests/host-check.mjs     # fake ctx + real HTTP route + a real balance call
```

`host-check.mjs` reads `$DEEPSEEK_API_KEY`, or the `DEEPSEEK_API_KEY` entry of
`${DSH_HOME:-$HOME/.dsh}/.credentials.yaml`, and writes its ledger to a
throwaway temp file.

`client-check.mjs` needs `react`, `react-dom`, and `jsdom`. It resolves them
from a DSH checkout (`DSH_CHECKOUT=/path/to/deepseek-harness`) or from this
repo's own `node_modules` if you install them there.

## Uninstall

```sh
cd "${DSH_HOME:-$HOME/.dsh}/profiles/desktop"
pnpm remove dsh-balance-pill
# and drop "dsh-balance-pill" from dsh.profile.bundles
```

## Layout

```
lib/index.js        host half: balance route, credentials seam, response cache,
                    usage ledger, peak/off-peak schedule
lib/client.js       client bundle: composer-dock pill + detail panel
cordis.patch.yml    bundle patch: inserts the plugin row
tests/              the three checks above
```

## License

MIT — see [LICENSE](LICENSE).
