import { atom, read, update } from 'claude-code'
import type { EngineInterface, ProcessRunResult, Register } from 'claude-code'

import type { LiveTool, RunStatus, ShellStat, Tokens } from '../types'
import { BAND, PANE, drawBand, drawCompact } from './band'
import type { BandInput } from './band'
import {
  addShell,
  agentStep,
  agentTokens,
  agentTool,
  buildSnapshot,
  configuredEffort,
  countTool,
  endRun,
  isBusy,
  limitWarnings,
  mergeRoster,
  parseNotification,
  startLive,
} from './collect'
import { NO_TOKENS, addTokens, toTokens } from './format'
import type { Els } from './ui'

// The session's values, declared in ../types: kept by the host across reloads, gone with the session.
const snapshot = atom({ plugin: 'vitals', key: 'snap' } as const, null)
const warned = atom({ plugin: 'vitals', key: 'warned' } as const, [])
const lastTurn = atom({ plugin: 'vitals', key: 'lastTurn' } as const, null)
const totals = atom({ plugin: 'vitals', key: 'totals' } as const, null)
const compactions = atom({ plugin: 'vitals', key: 'compactions' } as const, null)
const effort = atom({ plugin: 'vitals', key: 'effort' } as const, null)
const view = atom({ plugin: 'vitals', key: 'view' } as const, 'full')
const agents = atom({ plugin: 'vitals', key: 'agents' } as const, [])
const shells = atom({ plugin: 'vitals', key: 'shells' } as const, [])
const live = atom({ plugin: 'vitals', key: 'live' } as const, [])
const tools = atom({ plugin: 'vitals', key: 'tools' } as const, null)
const tick = atom({ plugin: 'vitals', key: 'tick' } as const, 0)

const REFRESH_MS = 60_000
const TICK_MS = 1000
const PANE_ID = 'vitals'
const PANE_TITLE = 'Vitals: agents, shells, tokens'

// Each git command is written out in full at its call; this only reads the result.
async function output(run: Promise<ProcessRunResult>) {
  try {
    const ran = await run
    return ran.exitCode === 0 ? ran.stdout.trim() : null
  } catch {
    return null
  }
}

async function refresh($: EngineInterface) {
  const [usage, cwd, now, prompts, model, roster] = await Promise.all([
    // A local estimate (no API calls), asked for only its compaction window.
    $.session.usage({ breakdown: 'summary' }),
    $.session.cwd(),
    $.clock.now(),
    $.session.turns(),
    $.session.model(),
    $.agent.list(),
  ])
  const [gitStatus, gitDirs] = await Promise.all([
    output($.process.run(['git', 'status', '--porcelain=v2', '--branch'], { cwd, timeoutMs: 5000 })),
    output($.process.run(['git', 'rev-parse', '--git-dir', '--git-common-dir'], { cwd, timeoutMs: 5000 })),
  ])
  if ((await read($, effort)) === null) {
    const configured = await $.config.list().then(configuredEffort, () => null)
    if (configured !== null) await update($, effort, () => configured)
  }

  const snap = buildSnapshot({ usage, cwd, now, prompts, model, gitStatus, gitDirs })
  await update($, snapshot, () => snap)
  await update($, agents, list => mergeRoster(list, roster, now))

  const warnings = limitWarnings(snap.limits, await read($, warned), now)
  for (const w of warnings) $.ui.toast(w.text, { timeoutMs: 8000 })
  if (warnings.length > 0) await update($, warned, s => [...s, ...warnings.map(w => w.key)].slice(-50))
}

/** A model request: the main loop's sets the session's effort, a subagent's its own model and effort. */
async function noteStep($: EngineInterface, agentId: string | undefined, model: string, level: string | null) {
  if (agentId === undefined) {
    if (level !== null) await update($, effort, () => level)
    return
  }
  const now = await $.clock.now()
  await update($, agents, list => agentStep(list, agentId, model, level, now))
}

/** A finished turn: the main loop's is the last turn; every loop adds to the session's totals. */
async function noteTurn($: EngineInterface, agentId: string | undefined, durationMs: number, model: string | null, used: Tokens | null) {
  const [now, { startedAt }] = await Promise.all([$.clock.now(), $.session.usage()])
  if (agentId === undefined) {
    await update($, lastTurn, () => ({ at: now, durationMs, model, tokens: used }))
  } else if (used !== null) {
    await update($, agents, list => agentTokens(list, agentId, used, now))
  }
  await update($, totals, t => {
    const isSame = t?.since === startedAt
    return {
      since: startedAt,
      turns: (isSame ? t.turns : 0) + (agentId === undefined ? 1 : 0),
      tokens: addTokens(isSame ? t.tokens : NO_TOKENS, used ?? NO_TOKENS),
    }
  })
}

/** A tool call starts: it shows live, counts for the session and for its agent. */
async function noteToolStart($: EngineInterface, call: LiveTool) {
  const { startedAt } = await $.session.usage()
  await update($, live, list => startLive(list, call))
  await update($, tools, counts => countTool(counts, call.tool, startedAt))
  const agentId = call.agentId
  if (agentId !== null) await update($, agents, list => agentTool(list, agentId, call.startedAt))
}

/** Ends a background shell or agent by its id, as a notification or a TaskStop reports it. */
async function noteEnded($: EngineInterface, id: string, status: RunStatus) {
  const now = await $.clock.now()
  await update($, shells, list => endRun(list, id, status, now))
  await update($, agents, list => endRun(list, id, status, now))
}

/** Advances the spinner while something runs, so elapsed times and spinners move. */
async function tickIfBusy($: EngineInterface) {
  const [running, agentList, shellList] = await Promise.all([read($, live), read($, agents), read($, shells)])
  if (isBusy(running, agentList, shellList)) await update($, tick, t => t + 1)
}

/** Everything a drawing reads, at one moment. */
async function gather($: EngineInterface, els: Els, room: number, isWorking: boolean, cacheTtlMs: number) {
  const snap = await read($, snapshot)
  if (snap === null) return null
  const [now, frame, turn, sessionTotals, compacted, level, agentList, shellList, running, toolCounts] = await Promise.all([
    $.clock.now(),
    read($, tick),
    read($, lastTurn),
    read($, totals),
    read($, compactions),
    read($, effort),
    read($, agents),
    read($, shells),
    read($, live),
    read($, tools),
  ])
  const input: BandInput = {
    els,
    room,
    isWorking,
    now,
    tick: frame,
    snap,
    turn,
    totals: sessionTotals,
    compactions: compacted,
    effort: level,
    agents: agentList,
    shells: shellList,
    live: running,
    tools: toolCounts,
    cacheTtlMs,
  }
  return input
}

/** A string field of a tool's result, which the hook sees untyped. */
const field = (result: unknown, name: string) => {
  if (typeof result !== 'object' || result === null || !(name in result)) return undefined
  const value: unknown = Reflect.get(result, name)
  return typeof value === 'string' ? value : undefined
}

export const register: Register = (on, options) => {
  // The main conversation's prompt-cache TTL (the `cache_ttl` option): 1 hour on a Claude
  // subscription within plan usage, 5 minutes with API billing, a cloud provider or usage credits.
  const cacheTtlMs = options.cache_ttl === '5m' ? 5 * 60_000 : 60 * 60_000

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'vitals',
      description: 'Vitals: switch the band between full and compact, or "/vitals pane" for every agent and shell',
    })
    await refresh($)
    $.clock.every(REFRESH_MS, () => void refresh($))
    $.clock.every(TICK_MS, () => void tickIfBusy($))

    return started
  })

  on('command.run', { command: 'vitals' }, async ($, e) => {
    if (e.args.trim() === 'pane') {
      await $.ui.open({ id: PANE_ID, title: PANE_TITLE })
      return { text: 'Vitals pane opened.' }
    }
    const next = await update($, view, was => (was === 'full' ? 'compact' : 'full'))

    return { text: next === 'compact' ? 'Vitals: compact line.' : 'Vitals: full band.' }
  })

  on('session.attach', async ($, e, next) => {
    const attached = await next(e)
    await refresh($)

    return attached
  })

  on('session.measure', async ($, e, next) => {
    const measured = await next(e)
    await refresh($)

    return measured
  })

  // Each model request names its model and effort: the main loop's and every subagent's.
  on('turn.step', async function* ($, e, next) {
    await noteStep($, e.agentId, e.model, e.effort === undefined ? null : `${e.effort}`)

    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const completed = await next(e)
    await noteTurn($, e.agentId, e.durationMs, e.usage?.model ?? null, e.usage ? toTokens(e.usage) : null)
    if (!e.agentId) await refresh($)

    return completed
  })

  // Every tool call shows live while it runs and counts for the session.
  on('tool.call', async ($, e, next) => {
    await noteToolStart($, { id: e.tool_use_id, tool: e.tool, agentId: e.agentId ?? null, startedAt: await $.clock.now() })
    try {
      return await next(e)
    } finally {
      await update($, live, list => list.filter(t => t.id !== e.tool_use_id))
    }
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    const id = field(ran.result, 'backgroundTaskId')
    if (id !== undefined) {
      const shell: ShellStat = {
        id,
        command: e.command,
        description: e.description ?? null,
        agentId: e.agentId ?? null,
        status: 'running',
        startedAt: await $.clock.now(),
        endedAt: null,
      }
      await update($, shells, list => addShell(list, shell))
    }

    return ran
  }).catch(($, e, next) => next(e))

  // A foreground agent ends with its call; a background one shows in the roster shortly after.
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    $.clock.after(2000, () => void refresh($))
    const ran = await next(e)
    const agentId = field(ran.result, 'agentId')
    if (agentId !== undefined && field(ran.result, 'status') === 'completed') await noteEnded($, agentId, 'completed')

    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskStop' }, async ($, e, next) => {
    const ran = await next(e)
    const id = e.task_id ?? e.shell_id
    if (id !== undefined && ran.isError !== true && ran.deny === undefined) await noteEnded($, id, 'killed')

    return ran
  }).catch(($, e, next) => next(e))

  // A background shell or agent reports its end to the model as a task notification.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'task-notification') {
      for (const ended of parseNotification(e.text)) await noteEnded($, ended.id, ended.status)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.trigger === 'precompute' || e.agentId || result.messages === undefined) return result

    const { startedAt } = await $.session.usage()
    await update($, compactions, c => ({
      since: startedAt,
      count: (c?.since === startedAt ? c.count : 0) + 1,
      before: result.tokensBefore ?? null,
      after: result.tokensAfter ?? null,
    }))

    return result
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const input = await gather($, $.ui.resolve(e), e.props.bodyColumns, e.props.isWorking, cacheTtlMs)
    if (input === null) return next(e)

    return (await read($, view)) === 'compact' ? drawCompact(input) : drawBand(input, BAND)
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const els = $.ui.resolve(e)
    const input = await gather($, els, e.props.bodyColumns, false, cacheTtlMs)
    if (input === null) return <els.Text dimColor>{'Waiting for the first measurement…'}</els.Text>

    return drawBand({ ...input, isWorking: input.live.length > 0 }, PANE)
  })
}
