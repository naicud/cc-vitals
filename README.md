# cc-vitals

**A Claude Code mod that puts your session's vitals in a framed live dashboard above the prompt — in the terminal and in the desktop app's Code tab.**

Model and reasoning effort, context and plan limits, tokens in and out, cache read and write and hit rate, every subagent with its own model, effort and tokens, background shells, the tool running right now and the session's tool counts. No extra process, no network.

```
╭──────────────────────────────────────────────────────────────────────────────────────────────╮
│ ◆ VITALS  Opus 5.5 1M  effort high          📁 cc-vitals  ⎇ main ●2   ⏱ 16m · 12 prompts · $4.21 │
│ CTX ████████████░░░░░  68% 680k/1M   5H ███████░░░░░░░  42% ↻ 2h 8m   7D ████████████░░  85% ↻ 3d 4h │
│ ▍TOKENS  cache warm                                                                          │
│             IN      OUT    CACHE R    CACHE W    HIT     TOTAL  NOTE                         │
│ turn      1.2k     3.4k       640k        18k    97%      663k  12s · idle <1m               │
│ session   3.2k     4.4k       680k        22k    96%      710k  1 turn                       │
│ ▍AGENTS  1 running · 0 done                                                                  │
│    AGENT              TYPE           MODEL         EFFORT    TOKENS   HIT  TOOLS     TIME    │
│ ◆  main               session        Opus 5.5 1M   high        663k   97%      1      16m    │
│ ⠧  Review the diff    code-reviewer  Sonnet 5.5    medium       47k   87%     12    1m20s    │
│ ▍SHELLS  1 running · 0 done                                                                  │
│    SHELL      COMMAND                              BY             STATUS        TIME         │
│ ⠧  b8f2       $ Start the dev server               main           running     3m12s          │
│ ⠧ NOW   Bash 4s · Grep ‹code-reviewer›                                                       │
│ ⚒ TOOLS Bash 120 · Read 80 · Edit 30 · Grep 12 · +5                                          │
╰──────────────────────────────────────────────────────────────────────────────────────────────╯
```

Commands:

- `/vitals` switches between the dashboard and one compact line:
  `◆ Opus 5.5 1M · effort high · ctx 68% · 5h 42% · 7d 85% · hit 97% · $4.21 · ⠧ 1 agent · $ 1 shell`
- `/vitals pane` opens a pane with the whole history: every agent, every shell, every tool.

## What it shows

| Section | Contents |
| :-- | :-- |
| Header | Model, the reasoning effort the last request used, folder, branch (🌳 in a worktree), ahead/behind, changed files, session age, prompts, cost |
| Meters | Context window (against the auto-compact window when one is set, as `/context` does), 5-hour and weekly plan limits with reset countdowns |
| Tokens | Last main turn and whole session (subagents included): in, out, cache read, cache write, hit rate, total; idle time and `cache cold` past the prompt-cache TTL |
| Agents | The main loop and every subagent: status (spinner while it runs, ✓ ✗ ■ when it ended), task, type, the model and effort its requests actually used, tokens, hit rate, tool calls, time. The band keeps running ones and those ended in the last 5 minutes; the pane keeps all |
| Shells | Background shells: id, command, which agent started it, status, time. Ended by the task notification or a TaskStop |
| Now | Tool calls in flight, with elapsed time and the agent running them |
| Tools | The session's most used tools |

Meters turn amber at 80% and red at 95%; a cache hit rate under 50% and a cold cache are flagged. A toast pops up when a plan limit crosses 80% and again at 95%, once per window. Narrow windows drop the least useful table columns first.

**Hit rate** is cache read over everything the request sent: `read / (in + read + write)`.

In the terminal the meters are block characters; in the desktop app they are SVG bars.

## Install

Requires Claude Code **v2.1.287** or later. Inside a Claude Code terminal session:

```
/plugin marketplace add naicud/cc-vitals
/plugin install vitals@naicud
/reload-plugins
```

The desktop app reads the same `~/.claude` plugins, so the band shows up in its Code tab too (start a new session there).

From a shell:

```bash
claude plugin marketplace add naicud/cc-vitals
claude plugin install vitals@naicud
```

The band replaces most of what a `statusLine` script shows, so you can drop yours (`statusLine` in `~/.claude/settings.json`) or keep it for other things.

## Settings

One option, `cache_ttl`: how long the main conversation's prompt cache lives, `1h` (default, Claude subscription within plan usage) or `5m` (API billing, cloud providers, usage credits). It only drives the `(cache cold)` warning. Change it in `/plugin` or `/config`.

## What it runs, reads and sends

- **Runs** only `git`, two fixed read-only commands in the session's folder with a 5-second timeout: `git status --porcelain=v2 --branch` and `git rev-parse --git-dir --git-common-dir`. Neither contacts a remote.
- **Reads** through the mods API: session usage (context, cost, plan limits), folder, model, prompt count, the agent roster, each model request's model and effort, each finished turn's duration and token counts, each tool call's name (and, for Bash, the command and its description; for Agent, the agent id), the ids and statuses in task notifications, and the effort row of `/config` until the first request reports one. It never reads response text, files, environment variables or credentials.
- **Sends** nothing. No network calls, no files written. State lives in the session's `$.state`.
- **Changes** nothing: every hook passes the event through unchanged.

## Develop

```bash
git clone https://github.com/naicud/cc-vitals
claude --plugin-dir cc-vitals/plugins/vitals     # try it for one session
claude plugin validate cc-vitals/plugins/vitals
claude plugin test cc-vitals/plugins/vitals
```

Layout:

```
.claude-plugin/marketplace.json   the "naicud" marketplace
plugins/vitals/
  .claude-plugin/plugin.json      manifest and the cache_ttl option
  hooks/register.tsx              hooks, state atoms, /vitals, render entries
  hooks/collect.ts                pure folds: snapshot, agents, shells, tool counts
  hooks/band.tsx                  the dashboard sections, full, compact and pane
  hooks/ui.tsx                    frame, headings, meters, adaptive tables
  hooks/format.ts                 number, model, status and token formatting
  hooks/vitals.test.tsx           tests against the engine's test kit
  types/index.d.ts                $.state contract
```

## Credits

Built on [desktop-statusline](https://github.com/centminmod/claude-plugins/tree/master/plugins/desktop-statusline) by George Liu (MIT): the desktop band, limit meters and git row come from there. cc-vitals adds the terminal surface, the framed dashboard, reasoning effort, the token and cache tables, subagent and shell tracking, live tools, the compact line and the pane.

## Licence

MIT. See [`LICENSE`](LICENSE).
