# cc-vitals

**A Claude Code mod that puts your session's vitals in a framed live dashboard above the prompt — in the terminal and in the desktop app's Code tab. Light by design: it draws what Claude Code already hands it and runs anything slow rarely, in the background.**

Model and reasoning effort, context and plan limits, cost and burn rate, tokens and cache per turn and session, auto-compaction, every subagent with its own model and effort, background shells, the tool running right now, and your weekly and monthly spend.

```
╭──────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ ◆ VITALS   🧠 Opus 5.5 1M   ⚡ HIGH ▰▰▰▱▱      📁 cc-vitals  🌿 main ●2   ⏳ 16m · 12 prompts   💸 $4.21  🔥 $15.79/h │
│ ⛽ CTX ████████████████▍░░░░░░░  68% 680k/1M │ ⏳ 5H ██████████▏░░░░░░░░░░  42% ↻ 3h 0m │ 📅 7D ████████████████████▍░░  85% ↻ 6d 5h │
│ ── 🔥 TOKENS ─────────────────────────────────────────────────────────────────────── 🧊 cache warm ── │
│         │     IN │    OUT │ CACHE R │ CACHE W │  HIT │  TOTAL │ NOTE                                  │
│ ────────┼────────┼────────┼─────────┼─────────┼──────┼────────┼────────────────────────────────────── │
│ turn    │   1.2k │   3.4k │    640k │     18k │  97% │   663k │ 12s · idle <1m                        │
│ session │   3.2k │   4.4k │    680k │     22k │  96% │   710k │ 1 turn                                │
│ ── 🤖 AGENTS ─────────────────────────────────────────────────────────────────── 1 running · 0 done ── │
│   │ AGENT                 │ TYPE          │ MODEL       │ EFFORT │ TOKENS │  HIT │ TOOLS │   TIME     │
│ ──┼───────────────────────┼───────────────┼─────────────┼────────┼────────┼──────┼───────┼─────────── │
│ ◆ │ main                  │ session       │ Opus 5.5 1M │ high   │   663k │  97% │     1 │    16m     │
│ ⠋ │ Review the diff       │ code-reviewer │ Sonnet 5.5  │ medium │    47k │  87% │    12 │  1m20s     │
│ ⠋ NOW      Bash 4s · Grep ‹code-reviewer›                                                              │
│ 🔧 TOOLS   Bash 120 · Read 80 · Edit 30 · Grep 12 · +5                                                 │
│ 🗜  COMPACT auto at 90% (900k) · 220k to go · 1× this session · last 870k → 64k (−93%) · auto · 12m ago │
│ ── 📊 USAGE ─────────────────────────────────────────────────────────────────── ccusage · 3m ago ──     │
│ PERIOD │    COST │ TOKENS │ VS BEFORE │ TOP MODELS                                                    │
│ ───────┼─────────┼────────┼───────────┼────────────────────────────────────────────────────────────── │
│ today  │  $50.00 │   100k │   ▲ +150% │ Opus 5.5 100%                                                 │
│ week   │    $100 │   300k │   ▲ +150% │ Opus 5.5 80% · Sonnet 5.5 20%                                 │
│ month  │    $219 │   500k │         — │ Opus 5.5 91% · Sonnet 5.5 9%                                  │
│ 14 days  ▁▁▁▁▁▁▂█▁▁▃▁▂▅  peak $99.00 · /vitals report                                                 │
│ 🐚 SHELLS  ⠋ Start the dev server running 3m12s                                                       │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────╯
```

The band never scrolls. Every section gets one line first, then the most important ones grow to their full table while they fit (at most 26 rows): tokens, agents, live, compaction, usage, shells. A short terminal, or one where Claude's progress takes the space, gets one line each instead of losing sections off the bottom.

Commands:

- `/vitals` switches between the dashboard and one compact line:
  `🧠 Opus 5.5 1M · ⚡ high · ⛽ 68% · ⏳ 42% · 📅 85% · 🧊 97% · 💸 $4.21 · 📊 week $100`
- `/vitals pane` opens a pane with every section in full: every agent, every shell, every tool.
- `/vitals report` opens the usage report: the last 14 days, the last 6 weeks, this month and the last, and this month's models, each with bars.

## What it shows

| Section | Contents |
| :-- | :-- |
| Header | 🧠 model, ⚡ the reasoning effort the last request used (pips out of five), 📁 folder, 🌿 branch (🌳 in a worktree), ahead/behind, changed files, ⏳ session age, prompts, 💸 cost, 🔥 burn rate per hour |
| Meters | ⛽ context window (against the auto-compact window when one is set, as `/context` does), ⏳ 5-hour and 📅 weekly plan limits with reset countdowns; bars at an eighth of a cell |
| 🔥 Tokens | Last main turn and whole session (subagents included): in, out, cache read, cache write, hit rate, total; idle time, 🧊 cache warm or 🥶 cold past the prompt-cache TTL. An interrupted turn keeps the last counted one on show |
| 🤖 Agents | The main loop and every subagent: status (spinner while it runs, ✓ ✗ ■ when it ended), task, type, the model and effort its requests actually used, tokens, hit rate, tool calls, time. Ended ones stay, dimmed, until newer ones push them out |
| Live | Tool calls in flight with elapsed time and the agent running them; the session's most used tools |
| 🗜 Compact | Where auto-compaction triggers and how many tokens are left, how many compactions this session, the last one's before → after and saving, its trigger and when |
| 📊 Usage | Today, this week (Monday first) and this month across every Claude Code session on the machine, each against the same days of the period before, the top models, a 14-day sparkline |
| 🐚 Shells | Background shells: id, command, which agent started it, status, time. Ended by the task notification or a TaskStop |

Meters turn amber at 80% and red at 95%; a cache hit rate under 50% and a cold cache are flagged. A toast pops up when a plan limit crosses 80% and again at 95%, once per window. Narrow windows drop the least useful table columns first.

**Hit rate** is cache read over everything the request sent: `read / (in + read + write)`.

## Light by design

| Work | How often |
| :-- | :-- |
| Context, plan limits, cost | As Claude Code measures them: the figures come with the event, no call is made |
| Model, effort, tokens, tools, agents, shells | From the events that already happen (each request, turn, tool call, notification) |
| `git status` and `rev-parse` | At most every 20 seconds |
| The `/context` estimate (auto-compact threshold) | Every 5 minutes and after a compaction |
| `ccusage claude daily` | In the background, at most every 15 minutes, kept across sessions so a new one draws it at once |
| Redraw | Once a second only while something runs (spinners, elapsed times); idle, only when a value changes |

## Install

Requires Claude Code **v2.1.287** or later; [ccusage](https://github.com/ccusage/ccusage) for the usage section and report (`npm i -g ccusage`). Inside a Claude Code terminal session:

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

- **Runs** `git`, two fixed read-only commands in the session's folder with a 5-second timeout: `git status --porcelain=v2 --branch` and `git rev-parse --git-dir --git-common-dir`; neither contacts a remote. And `ccusage claude daily --json --since <first of last month>` for the usage section, when [ccusage](https://github.com/ccusage/ccusage) is installed (`npm i -g ccusage`): it reads Claude Code's local transcripts and may fetch model prices; without it the usage section says so and everything else works.
- **Reads** through the mods API: session usage (context, cost, plan limits), folder, model, prompt count, the agent roster, each model request's model and effort, each finished turn's duration and token counts, each tool call's name (and, for Bash, the command and its description; for Agent, the agent id), the ids and statuses in task notifications, and the effort row of `/config` until the first request reports one. It never reads response text, files, environment variables or credentials.
- **Sends** nothing itself and writes no files. Session state lives in `$.state`; the last ccusage report is kept in the plugin's `$.store`.
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
  hooks/register.tsx              hooks, state atoms, refresh cadence, /vitals, render entries
  hooks/collect.ts                pure folds: place, meters, agents, shells, tool counts
  hooks/band.tsx                  the dashboard sections and their row-budget layout
  hooks/report.ts                 ccusage parsing and day/week/month folds
  hooks/report-view.tsx           the /vitals report pane
  hooks/ui.tsx                    rules, ruled tables, meters, bars, sparklines
  hooks/format.ts                 number, model, status and token formatting
  hooks/vitals.test.tsx           tests against the engine's test kit
  types/index.d.ts                $.state contract
```

## Credits

Built on [desktop-statusline](https://github.com/centminmod/claude-plugins/tree/master/plugins/desktop-statusline) by George Liu (MIT): the desktop band, limit meters and git row come from there. cc-vitals adds the terminal surface, the framed dashboard, reasoning effort, the token and cache tables, subagent and shell tracking, live tools, the compact line and the pane.

## Licence

MIT. See [`LICENSE`](LICENSE).
