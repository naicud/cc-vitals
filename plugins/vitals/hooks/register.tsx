import { atom, read, update } from 'claude-code'
import type { EngineInterface, ProcessRunResult, Register } from 'claude-code'

import type { Limit, Snapshot } from '../types'
import { drawBand, drawCompact } from './band'
import { NO_TOKENS, addTokens, limitLabel, toTokens, until } from './format'

const snapshot = atom({ plugin: 'vitals', key: 'snap' } as const, null)
const warned = atom({ plugin: 'vitals', key: 'warned' } as const, [])
const lastTurn = atom({ plugin: 'vitals', key: 'lastTurn' } as const, null)
const totals = atom({ plugin: 'vitals', key: 'totals' } as const, null)
const compactions = atom({ plugin: 'vitals', key: 'compactions' } as const, null)
const effort = atom({ plugin: 'vitals', key: 'effort' } as const, null)
const isCompact = atom({ plugin: 'vitals', key: 'isCompact' } as const, false)

const REFRESH_MS = 60_000
const WARN_AT = [95, 80]

// Each git command is written out in full at its call; this only reads the result.
const output = async (run: Promise<ProcessRunResult>) => {
  try {
    const ran = await run
    return ran.exitCode === 0 ? ran.stdout.trim() : null
  } catch {
    return null
  }
}

const warn = async ($: EngineInterface, limits: Limit[], now: number) => {
  const seen = await read($, warned)
  const fresh: string[] = []

  for (const limit of limits) {
    const threshold = WARN_AT.find(t => limit.percent >= t)
    const key = `${limit.kind}@${threshold}@${limit.resetsAt}`
    if (threshold === undefined || seen.includes(key)) continue

    fresh.push(key)
    const resets = limit.resetsAt ? ` · resets in ${until(limit.resetsAt, now)}` : ''
    $.ui.toast(`${limitLabel(limit.kind)} usage limit at ${limit.percent}%${resets}`, { timeoutMs: 8000 })
  }

  if (fresh.length > 0) await update($, warned, s => [...s, ...fresh].slice(-50))
}

// Until the first request of the session reports its effort, take the /config row's value.
const configuredEffort = async ($: EngineInterface) => {
  try {
    const row = (await $.config.list()).find(r => /effort/i.test(r.key))
    return typeof row?.value === 'string' ? row.value : null
  } catch {
    return null
  }
}

const refresh = async ($: EngineInterface) => {
  const [usage, cwd, now, agents, prompts, model] = await Promise.all([
    // A local estimate (no API calls), asked for only its compaction window.
    $.session.usage({ breakdown: 'summary' }),
    $.session.cwd(),
    $.clock.now(),
    $.agent.list(),
    $.session.turns(),
    $.session.model(),
  ])
  const [status, dirs] = await Promise.all([
    output($.process.run(['git', 'status', '--porcelain=v2', '--branch'], { cwd, timeoutMs: 5000 })),
    output($.process.run(['git', 'rev-parse', '--git-dir', '--git-common-dir'], { cwd, timeoutMs: 5000 })),
  ])
  if ((await read($, effort)) === null) {
    const configured = await configuredEffort($)
    if (configured !== null) await update($, effort, () => configured)
  }

  const lines = status?.split('\n') ?? []
  const head = lines.find(l => l.startsWith('# branch.head '))?.slice(14)
  const ab = lines.find(l => l.startsWith('# branch.ab '))?.match(/\+(\d+) -(\d+)/)
  const [gitDir, commonDir] = dirs?.split('\n') ?? []
  const limits = usage.rateLimits.map(r => ({ kind: r.kind, percent: r.percentUsed, resetsAt: r.resetsAt ?? null }))
  // Measure against the auto-compact window when one smaller than the model's is set, as /context does.
  const { tokens: contextTokens, window: modelWindow, breakdown } = usage.context
  const contextWindow = breakdown?.isAutoCompactEnabled ? Math.min(modelWindow, breakdown.rawMaxTokens) : modelWindow

  const snap: Snapshot = {
    at: now,
    startedAt: usage.startedAt,
    prompts,
    model,
    dir: cwd.split('/').pop() || cwd,
    branch: head && head !== '(detached)' ? head : null,
    isWorktree: gitDir !== commonDir,
    ahead: Number(ab?.[1] ?? 0),
    behind: Number(ab?.[2] ?? 0),
    changed: lines.filter(l => l && !l.startsWith('#')).length,
    contextPercent: contextTokens === undefined ? null : Math.round((contextTokens / contextWindow) * 100),
    contextTokens: contextTokens ?? null,
    contextWindow,
    costUsd: usage.cost?.usd ?? null,
    limits,
    agents: agents.filter(a => a.status === 'running').map(a => ({ type: a.type, description: a.description })),
  }

  await update($, snapshot, () => snap)
  await warn($, limits, now)
}

export const register: Register = (on, options) => {
  // The main conversation's prompt-cache TTL (the `cache_ttl` option): 1 hour on a Claude
  // subscription within plan usage, 5 minutes with API billing, a cloud provider or usage credits.
  const cacheTtlMs = options.cache_ttl === '5m' ? 5 * 60_000 : 60 * 60_000

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'vitals',
      description: 'Switch the vitals band between the full view and one compact line',
    })
    await refresh($)
    $.clock.every(REFRESH_MS, () => void refresh($))

    return started
  })

  on('command.run', { command: 'vitals' }, async $ => {
    const compact = await update($, isCompact, was => !was)

    return { text: compact ? 'Vitals: compact line.' : 'Vitals: full band.' }
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

  // The effort the main loop's request actually asks for, after any downgrade for the model.
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId && e.effort !== undefined) {
      const level = `${e.effort}`
      if ((await read($, effort)) !== level) await update($, effort, () => level)
    }

    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const completed = await next(e)
    const [at, { startedAt }] = await Promise.all([$.clock.now(), $.session.usage()])
    const turnTokens = e.usage ? toTokens(e.usage) : null

    if (!e.agentId) {
      await update($, lastTurn, () => ({ at, durationMs: e.durationMs, model: e.usage?.model ?? null, tokens: turnTokens }))
    }
    // Session totals count every loop, subagents included: that is what the session spent.
    await update($, totals, t => {
      const isSame = t?.since === startedAt
      return {
        since: startedAt,
        turns: (isSame ? t.turns : 0) + (e.agentId ? 0 : 1),
        tokens: addTokens(isSame ? t.tokens : NO_TOKENS, turnTokens ?? NO_TOKENS),
      }
    })
    await refresh($)

    return completed
  })

  // A spawned agent shows as running only once it has started; look again shortly after.
  on('tool.call', { tool: 'Agent' }, ($, e, next) => {
    $.clock.after(2000, () => void refresh($))

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

    const snap = await read($, snapshot)
    if (snap === null) return next(e)

    const [turn, sessionTotals, compacted, level, compact] = await Promise.all([
      read($, lastTurn),
      read($, totals),
      read($, compactions),
      read($, effort),
      read($, isCompact),
    ])
    const input = {
      els: $.ui.resolve(e),
      bodyColumns: e.props.bodyColumns,
      isWorking: e.props.isWorking,
      snap,
      turn,
      totals: sessionTotals,
      compactions: compacted,
      effort: level,
      cacheTtlMs,
    }

    return compact ? drawCompact(input) : drawBand(input)
  })
}
