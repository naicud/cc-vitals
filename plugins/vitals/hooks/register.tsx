import { atom, read, update } from 'claude-code'
import type { EngineInterface, ProcessRunResult, Register, SessionUsage } from 'claude-code'

import type { AgentStat, LiveTool, RunStatus, ShellStat, Snapshot, Tokens } from '../types'
import { drawAll, drawBand, drawCompact } from './band'
import type { BandInput } from './band'
import {
  addShell,
  agentStep,
  agentTokens,
  agentTool,
  compactionOf,
  configuredEffort,
  countTool,
  endRun,
  isBusy,
  limitWarnings,
  mergeRoster,
  metersOf,
  parseNotification,
  placeOf,
  startLive,
} from './collect'
import { NO_TOKENS, addTokens, toTokens } from './format'
import { historySince, localDate, parseDaily } from './report'
import { drawReport } from './report-view'
import type { Canvas } from './ui'

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
const history = atom({ plugin: 'vitals', key: 'history' } as const, null)
const historyProblem = atom({ plugin: 'vitals', key: 'historyProblem' } as const, null)

// What each kind of work costs decides how often it runs: a measurement is free and drawn at
// once; git is two processes; the /context estimate walks the context; ccusage reads every
// transcript on the machine.
const REFRESH_MS = 60_000
const GIT_EVERY_MS = 20_000
const BREAKDOWN_EVERY_MS = 5 * 60_000
const HISTORY_EVERY_MS = 15 * 60_000
const TICK_MS = 1000
const MAX_BAND_ROWS = 26
const PANE_ID = 'vitals'
const REPORT_ID = 'vitals-report'
const HISTORY_KEY = 'history'

// Module memory: what the slow reads returned last, and when. A reload starts it over.
let gitAt = 0
let gitPlace: ReturnType<typeof placeOf> | null = null
let breakdownAt = 0
let compaction: ReturnType<typeof compactionOf> = { compactWindow: null, autoCompactAt: null }
let isReadingHistory = false

// Each command is written out in full at its call; this only reads the result.
async function output(run: Promise<ProcessRunResult>) {
  try {
    const ran = await run
    return ran.exitCode === 0 ? ran.stdout.trim() : null
  } catch {
    return null
  }
}

async function setAgents($: EngineInterface, fn: (list: AgentStat[]) => AgentStat[]) {
  const was = await read($, agents)
  const next = fn(was)
  if (JSON.stringify(next) !== JSON.stringify(was)) await update($, agents, () => next)
}

async function setShells($: EngineInterface, fn: (list: ShellStat[]) => ShellStat[]) {
  const was = await read($, shells)
  const next = fn(was)
  if (JSON.stringify(next) !== JSON.stringify(was)) await update($, shells, () => next)
}

/** Draws a measurement into the meters at once: no call, the figures came with the event. */
async function applyMeasure($: EngineInterface, measured: Pick<SessionUsage, 'context' | 'rateLimits' | 'cost'>, now: number) {
  const meters = metersOf(measured, compaction.compactWindow)
  await update($, snapshot, s => (s === null ? s : { ...s, ...meters, autoCompactAt: compaction.autoCompactAt, at: now }))
  const warnings = limitWarnings(meters.limits, await read($, warned), now)
  for (const w of warnings) $.ui.toast(w.text, { timeoutMs: 8000 })
  if (warnings.length > 0) await update($, warned, s => [...s, ...warnings.map(w => w.key)].slice(-50))
}

/** The whole snapshot: the cheap reads every time, git and the /context estimate when due. */
async function refresh($: EngineInterface) {
  const now = await $.clock.now()
  const isBreakdownDue = now - breakdownAt >= BREAKDOWN_EVERY_MS
  const [usage, cwd, prompts, model, roster] = await Promise.all([
    isBreakdownDue ? $.session.usage({ breakdown: 'summary' }) : $.session.usage(),
    $.session.cwd(),
    $.session.turns(),
    $.session.model(),
    $.agent.list(),
  ])
  if (isBreakdownDue) {
    breakdownAt = now
    compaction = compactionOf(usage.context.breakdown)
  }
  if (gitPlace === null || now - gitAt >= GIT_EVERY_MS) {
    gitAt = now
    const [gitStatus, gitDirs] = await Promise.all([
      output($.process.run(['git', 'status', '--porcelain=v2', '--branch'], { cwd, timeoutMs: 5000 })),
      output($.process.run(['git', 'rev-parse', '--git-dir', '--git-common-dir'], { cwd, timeoutMs: 5000 })),
    ])
    gitPlace = placeOf(cwd, gitStatus, gitDirs)
  }
  if ((await read($, effort)) === null) {
    const configured = await $.config.list().then(configuredEffort, () => null)
    if (configured !== null) await update($, effort, () => configured)
  }
  const snap: Snapshot = {
    at: now,
    startedAt: usage.startedAt,
    prompts,
    model,
    ...gitPlace,
    ...metersOf(usage, compaction.compactWindow),
    autoCompactAt: compaction.autoCompactAt,
  }
  await update($, snapshot, () => snap)
  await setAgents($, list => mergeRoster(list, roster, now))
  await applyMeasure($, usage, now)
}

/** Usage across every session from ccusage, kept in the store so a new session draws it at once. */
async function refreshHistory($: EngineInterface, isForced: boolean) {
  if (isReadingHistory) return
  const now = await $.clock.now()
  const held = await read($, history)
  if (!isForced && held !== null && now - held.at < HISTORY_EVERY_MS) return

  isReadingHistory = true
  try {
    const ran = await $.process.run(['ccusage', 'claude', 'daily', '--json', '--since', historySince(localDate(now))], { timeoutMs: 60_000 })
    const days = ran.exitCode === 0 ? parseDaily(ran.stdout) : null
    if (days === null) {
      await update($, historyProblem, () => ({ at: now, reason: ran.exitCode === 0 ? 'unreadable ccusage output' : `ccusage exited ${ran.exitCode}` }))
      return
    }
    await update($, history, () => ({ at: now, days }))
    await $.store.set(HISTORY_KEY, { at: now, text: ran.stdout })
  } catch {
    await update($, historyProblem, () => ({ at: now, reason: 'ccusage not found (npm i -g ccusage)' }))
  } finally {
    isReadingHistory = false
  }
}

/** The history the last session kept, if the store holds a readable one. */
async function restoreHistory($: EngineInterface) {
  if ((await read($, history)) !== null) return
  const saved: unknown = await $.store.get(HISTORY_KEY)
  if (typeof saved !== 'object' || saved === null) return
  const at: unknown = Reflect.get(saved, 'at')
  const text: unknown = Reflect.get(saved, 'text')
  if (typeof at !== 'number' || typeof text !== 'string') return
  const days = parseDaily(text)
  if (days !== null) await update($, history, () => ({ at, days }))
}

/** A model request: the main loop's sets the session's effort, a subagent's its own model and effort. */
async function noteStep($: EngineInterface, agentId: string | undefined, model: string, level: string | null) {
  if (agentId === undefined) {
    if (level !== null && (await read($, effort)) !== level) await update($, effort, () => level)
    return
  }
  const now = await $.clock.now()
  await setAgents($, list => agentStep(list, agentId, model, level, now))
}

/** A finished turn: the main loop's is the last turn; every loop adds to the session's totals. */
async function noteTurn($: EngineInterface, agentId: string | undefined, durationMs: number, model: string | null, used: Tokens | null) {
  const [now, snap] = await Promise.all([$.clock.now(), read($, snapshot)])
  const startedAt = snap?.startedAt ?? 0
  if (agentId === undefined) {
    // An interrupted turn reports no usage: the last counted one stays on show.
    await update($, lastTurn, t => ({ at: now, durationMs, model, tokens: used ?? t?.tokens ?? null }))
  } else if (used !== null) {
    await setAgents($, list => agentTokens(list, agentId, used, now))
  }
  if (used === null) return
  await update($, totals, t => {
    const isSame = t?.since === startedAt
    return {
      since: startedAt,
      turns: (isSame ? t.turns : 0) + (agentId === undefined ? 1 : 0),
      tokens: addTokens(isSame ? t.tokens : NO_TOKENS, used),
    }
  })
}

/** A tool call starts: it shows live, counts for the session and for its agent. */
async function noteToolStart($: EngineInterface, call: LiveTool) {
  const snap = await read($, snapshot)
  await update($, live, list => startLive(list, call))
  await update($, tools, counts => countTool(counts, call.tool, snap?.startedAt ?? 0))
  const agentId = call.agentId
  if (agentId !== null) await setAgents($, list => agentTool(list, agentId, call.startedAt))
}

/** Ends a background shell or agent by its id, as a notification or a TaskStop reports it. */
async function noteEnded($: EngineInterface, id: string, status: RunStatus) {
  const now = await $.clock.now()
  await setShells($, list => endRun(list, id, status, now))
  await setAgents($, list => endRun(list, id, status, now))
}

/** Redraws once a second while something runs, so spinners and elapsed times move; idle, nothing. */
async function tick($: EngineInterface) {
  const [running, agentList, shellList] = await Promise.all([read($, live), read($, agents), read($, shells)])
  if (isBusy(running, agentList, shellList)) $.ui.invalidate('ui.render')
}

/** Everything a drawing reads, at one moment. */
async function gather($: EngineInterface, canvas: Canvas, room: number, rows: number, isWorking: boolean, cacheTtlMs: number) {
  const snap = await read($, snapshot)
  if (snap === null) return null
  const [now, turn, sessionTotals, compacted, level, agentList, shellList, running, toolCounts, past, problem] = await Promise.all([
    $.clock.now(),
    read($, lastTurn),
    read($, totals),
    read($, compactions),
    read($, effort),
    read($, agents),
    read($, shells),
    read($, live),
    read($, tools),
    read($, history),
    read($, historyProblem),
  ])
  const input: BandInput = {
    canvas,
    room,
    rows,
    isWorking,
    now,
    snap,
    turn,
    totals: sessionTotals,
    compactions: compacted,
    effort: level,
    agents: agentList,
    shells: shellList,
    live: running,
    tools: toolCounts,
    history: past,
    historyProblem: problem,
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
      description: 'Vitals: full ↔ compact band · "/vitals pane" every agent and shell · "/vitals report" weekly and monthly usage',
    })
    await restoreHistory($)
    await refresh($)
    void refreshHistory($, false)
    $.clock.every(REFRESH_MS, () => void refresh($))
    $.clock.every(HISTORY_EVERY_MS, () => void refreshHistory($, false))
    $.clock.every(TICK_MS, () => void tick($))

    return started
  })

  on('command.run', { command: 'vitals' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'pane') {
      await $.ui.open({ id: PANE_ID, title: 'Vitals · agents, shells, tokens' })
      return { text: 'Vitals pane opened.' }
    }
    if (arg === 'report') {
      void refreshHistory($, true)
      await $.ui.open({ id: REPORT_ID, title: 'Vitals · usage report' })
      return { text: 'Vitals usage report opened; refreshing from ccusage.' }
    }
    const next = await update($, view, was => (was === 'full' ? 'compact' : 'full'))

    return { text: next === 'compact' ? 'Vitals: compact line.' : 'Vitals: full band.' }
  })

  on('session.attach', async ($, e, next) => {
    const attached = await next(e)
    await refresh($)

    return attached
  })

  // A measurement carries the context, the limits and the cost: drawn as they come, no call made.
  on('session.measure', async ($, e, next) => {
    const measured = await next(e)
    await applyMeasure($, e, await $.clock.now())

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

    const [now, snap] = await Promise.all([$.clock.now(), read($, snapshot)])
    const startedAt = snap?.startedAt ?? 0
    await update($, compactions, c => ({
      since: startedAt,
      count: (c?.since === startedAt ? c.count : 0) + 1,
      before: result.tokensBefore ?? null,
      after: result.tokensAfter ?? null,
      at: now,
      trigger: e.trigger,
    }))
    // The window and the threshold may have moved: read them again on the next refresh.
    breakdownAt = 0

    return result
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const canvas = { els: $.ui.resolve(e), surface: e.surface }
    const input = await gather($, canvas, e.props.bodyColumns, e.props.maxRows, e.props.isWorking, cacheTtlMs)
    if (input === null) return next(e)

    return (await read($, view)) === 'compact' ? drawCompact(input) : drawBand(input, MAX_BAND_ROWS)
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const canvas = { els: $.ui.resolve(e), surface: e.surface }
    const input = await gather($, canvas, e.props.bodyColumns, 1000, false, cacheTtlMs)
    if (input === null) return <canvas.els.Text dimColor>{'Waiting for the first measurement…'}</canvas.els.Text>

    return drawAll({ ...input, isWorking: input.live.length > 0 })
  })

  on('ui.render', { component: 'Pane', requestId: REPORT_ID }, async ($, e) => {
    const canvas = { els: $.ui.resolve(e), surface: e.surface }
    const [now, past, problem] = await Promise.all([$.clock.now(), read($, history), read($, historyProblem)])

    return drawReport(canvas, e.props.bodyColumns, now, past, problem)
  })
}
