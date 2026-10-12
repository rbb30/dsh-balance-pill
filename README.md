# dsh-balance-pill

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) plugin
that shows your DeepSeek API account balance as a small pill in the **composer
dock** — the row under the input box that already holds the context-occupancy
ring.

```
[ output speed ] [ cache hit ] [ ● CNY 42.00 ] [ ◔ 45% ]
                                 ^ this pill     ^ context meter
```

- **Host half** registers `GET /dsh-balance-pill`, resolves `DEEPSEEK_API_KEY`
  from the DSH credentials seam (falling back to `$DEEPSEEK_API_KEY`), calls
  `GET https://api.deepseek.com/user/balance`, and caches the answer for 20s.
  The key never reaches the browser.
- **Client half** contributes one entry to the `conversation.composer.dock` list
  slot and polls the host route every 60s (the interval the host echoes).
- **Click** the pill to refresh immediately; **hover** for the granted /
  topped-up split per currency.
- **Status dot**: grey while loading, green with funds, amber when the account
  reports no available balance, red when the request failed.
- Cross-platform: Node's `fetch`, no shell-outs, no Windows-only paths.
- No build step: the host half is plain ESM, and the client half is a
  self-contained `__ModuleLoader__.load({ id, factory })` closure that pulls
  React from the shell's shared module registry.

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
        refreshIntervalMs: 60000   # poll interval the browser half uses
        cacheMs: 20000             # upstream response cache lifetime
```

## Checks

```sh
node tests/host-check.mjs     # fake ctx + real HTTP route + a real balance call
node tests/client-check.mjs   # jsdom + React render of the pill
```

`host-check.mjs` reads `$DEEPSEEK_API_KEY`, or the
`DEEPSEEK_API_KEY` entry of `${DSH_HOME:-$HOME/.dsh}/.credentials.yaml`.

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
lib/index.js        host half: balance route, credentials seam, response cache
lib/client.js       client bundle: composer-dock pill (hand-written __ModuleLoader__ factory)
cordis.patch.yml    bundle patch: inserts the plugin row
tests/              the two checks above
```

## License

MIT — see [LICENSE](LICENSE).
