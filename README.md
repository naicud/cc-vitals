# cc-vitals

**A Claude Code mod that puts your session's vitals in a framed live dashboard above the prompt — in the terminal and in the desktop app's Code tab. Light by design: it draws what Claude Code already hands it and runs anything slow rarely, in the background.**

Model and reasoning effort, context and plan limits, cost and burn rate, tokens and cache per turn and session, auto-compaction, every subagent with its own model and effort, background shells, the tool running right now, and your weekly and monthly spend.

```
╭──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ ◆ VITALS   🧠 Opus 5.5 1M   ⚡ HIGH ▰▰▰▱▱                           📁 cc-vitals  🌿 main ●2   ⏳ 1h 8m · 6 prompts   💸 $14.57  🔥 $12.68/h │
│ ⛽ CTX ████████▊░░░░░░░░░░░░░░░  41% 409k/1M │ ⏳ 5H ████████▏░░░░░░░░░░░░░░░  37% ↻ 2h 30m │ 📅 7D ██▉░░░░░░░░░░░░░░░░░░░░  12% ↻ 6d 4h │
│                                                                                                                                              │
│ ── 🔥 TOKENS ─────────────────────────────────── 🧊 cache warm ──     ⠋ NOW      Bash 4s · Grep ‹code-reviewer›                               │
│         │     IN │    OUT │ CACHE R │ CACHE W │  HIT │  TOTAL │ NOTE  🔧 TOOLS   Bash 25 · Write 7 · Edit 4 · ctx_execute 2                      │
│ ────────┼────────┼────────┼─────────┼─────────┼──────┼────────┼───── │
│ turn    │     76 │    80k │   13.5M │    118k │  99% │  13.7M │ 13m  ── 🐚 SHELLS ─────────────────────────────── 1 running · 2 done ──      │
│ session │     76 │    80k │   13.5M │    118k │  99% │  13.7M │ 1 t     │ SHELL     │ COMMAND                     │ STATUS    │   TIME        │
│                                                                      ──┼───────────┼─────────────────────────────┼───────────┼────────       │
│ 🗜  COMPACT auto at 97% (967k) · 558k to go                         ⠋ │ b8f2      │ $ Start the dev server      │ running   │  3m12s        │
│                                                                      ✓ │ b1a0      │ $ Run the test suite        │ completed │    45s        │
│ ── 📊 USAGE ───────────────────────────────── ccusage · 13m ago ──                                                                             │
│ PERIOD │    COST │  TOKENS │ VS BEFORE │ TOP MODELS                 ── 🤖 AGENTS ────────────────────────────── 1 running · 3 done ──        │
│ ───────┼─────────┼─────────┼───────────┼────────────────────────      │ AGENT           │ MODEL       │ EFFORT │ TOKENS │  HIT │   TIME       │
│ today  │    $132 │  392.9M │     ▼ -4% │ Opus 5.5 85% · Sonnet 5.5   ──┼─────────────────┼─────────────┼────────┼────────┼──────┼───────       │
│ week   │    $491 │    1.4B │    ▼ -41% │ Opus 5.5 82% · Sonnet 5.5   ◆ │ main            │ Opus 5.5 1M │ high   │  13.7M │  99% │    1h       │
│ month  │    $749 │    2.1B │  ▲ +2113% │ Opus 5.5 79% · Sonnet 5.5   ⠋ │ Review the diff │ Sonnet 5.5  │ medium │    47k │  87% │  1m20s       │
│ 14 days  ▁▁▂▅█▃▁▁▂▁▁▁▃▂  peak $378 · /vitals report                  ✓ │ Explore auth    │ Haiku 5.5   │ low    │    12k │  88% │    40s       │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
```

On a terminal 150 columns wide or more the sections split in two columns: the numbers on the left (🔥 tokens, 🗜 compaction, 📊 usage), the work on the right with 🤖 agents at the bottom (live tools, 🐚 shells, agents). Narrower, they stack in one column in that order, agents last. A blank line separates the sections.

The band never scrolls (at most 32 rows). Every section gets one line first, then the most important ones grow to their full table while they fit: tokens, agents, live, compaction, usage, shells. A short terminal, or one where Claude's progress takes the space, gets one line each instead of losing sections off the bottom.

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

Requirements:

| What | Why | Install |
| :-- | :-- | :-- |
| Claude Code **v2.1.287** or later | Mods (function-hook plugins) | `claude update` |
| [ccusage](https://github.com/ccusage/ccusage) on the `PATH` | The 📊 usage section and `/vitals report` (today, week, month, models) | `npm i -g ccusage` |
| `git` | The folder and branch in the header | already there on most machines |

Without ccusage the band still works and the usage section says `ccusage not found`.

1. Install ccusage and check it answers:

   ```bash
   npm i -g ccusage
   ccusage claude daily --since $(date +%Y%m01)
   ```

2. Inside a Claude Code terminal session, add the marketplace and install the mod:

   ```
   /plugin marketplace add naicud/cc-vitals
   /plugin install vitals@naicud
   /reload-plugins
   ```

   Or from a shell:

   ```bash
   claude plugin marketplace add naicud/cc-vitals
   claude plugin install vitals@naicud
   ```

3. The band appears above the prompt once the session has its first measurement. The desktop app reads the same `~/.claude` plugins, so it shows up in its Code tab too (start a new session there).

The band replaces most of what a `statusLine` script shows, so you can drop yours (`statusLine` in `~/.claude/settings.json`) or keep it for other things.

To update: `claude plugin marketplace update naicud && claude plugin update vitals@naicud`, then restart or `/reload-plugins`.

### Troubleshooting

| Symptom | Cause and fix |
| :-- | :-- |
| `📊 USAGE no history: ccusage not found` | ccusage is not on the `PATH` Claude Code was started with: install it, restart Claude Code |
| Usage costs look too low | ccusage could not reach its price list and priced new models at zero: run `ccusage claude daily` once online |
| One line per section instead of tables | The band has few rows (a short terminal, or Claude's progress is taking them): make the terminal taller, or `/vitals pane` for everything in full |
| No band at all | Claude Code older than v2.1.287, the plugin disabled (`claude plugin list`), or `/vitals` switched it to the compact line: run `/vitals` again |

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
