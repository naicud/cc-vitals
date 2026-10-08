# cc-vitals

**A Claude Code mod that puts your session's vitals in a live band above the prompt — in the terminal and in the desktop app's Code tab.**

Tokens in and out, cache read and write, cache hit rate, reasoning effort, model, context fill, plan limits and cost: one glance, no extra process, no network.

```
📁 cc-vitals   🌿 main   ● 2 changed                     session 16m · 12 prompts · $4.21
Context ████████████████░░░░░░░  68%  680k / 1M                   ◆ Opus 5.5 1M · effort high
5-hour  ██████░░░░░░░░  42%  resets in 2h 8m     Weekly  ████████████░░  85%  resets in 3d 4h
Turn    12s · in 1.2k · out 3.4k · cache read 640k · write 18k · hit 97% · idle <1m
Session in 45k · out 120k · cache read 12M · write 400k · hit 96% · 23 turns · compacted 1× (900k → 80k)
⏳ Review the diff                                                                  code-reviewer
```

`/vitals` switches to one compact line:

```
◆ Opus 5.5 1M · effort high · ctx 68% · 5h 42% · 7d 85% · hit 97% · $4.21
```

## What it shows

| Row | Contents |
| :-- | :-- |
| Where | Folder, git branch, 🌳 in a worktree, commits ahead/behind, changed files. Right: session age, prompts, cost |
| Context | Meter of the context window (against the auto-compact window when one is set, as `/context` does). Right: model and the reasoning effort the last request actually used |
| Limits | 5-hour and weekly plan limits with reset countdowns (when Claude Code reports them for your account) |
| Turn | Last main-loop turn: duration, tokens in / out, cache read / write, hit rate, idle time; `(cache cold)` once idle past the prompt-cache TTL |
| Session | Totals for the whole session, subagents included: tokens in / out, cache read / write, hit rate, turns, compactions |
| Agents | One row per running subagent, up to three |

Meters turn amber at 80% and red at 95%. A cache hit rate under 50% and a cold cache are flagged. A toast pops up when a plan limit crosses 80% and again at 95%, once per window.

**Hit rate** is cache read over everything the request sent: `read / (in + read + write)`.

In the terminal the meters are drawn with block characters; in the desktop app they are SVG bars.

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
- **Reads** through the mods API: session usage (context, cost, plan limits), folder, model, prompt count, running subagents, each finished turn's duration, model and token counts, each request's effort, and the effort row of `/config` until the first request reports one. It never reads prompt or response text, files, environment variables or credentials.
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
  hooks/register.tsx              hooks: data collection, /vitals, render entry
  hooks/band.tsx                  the band, full and compact, per surface
  hooks/format.ts                 number, model and token formatting
  hooks/vitals.test.tsx           tests against the engine's test kit
  types/index.d.ts                $.state contract
```

## Credits

Built on [desktop-statusline](https://github.com/centminmod/claude-plugins/tree/master/plugins/desktop-statusline) by George Liu (MIT): the desktop band, limit meters and git row come from there. cc-vitals adds the terminal surface, reasoning effort, the per-turn and per-session token and cache split, and the compact mode.

## Licence

MIT. See [`LICENSE`](LICENSE).
