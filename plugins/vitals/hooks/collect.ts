import type { AgentInfo, ConfigRow, SessionContextBreakdown, SessionUsage } from 'claude-code'

import type { AgentStat, Breakdown, ContextPart, Credits, Limit, LiveTool, PlanRow, PlanUsage, RunStatus, ShellStat, ToolCounts, Tokens } from '../types'
import { NO_TOKENS, addTokens, isActive, isShown, limitLabel, notifiedStatus, runStatus, until } from './format'

// Pure folds over the session's values: register.tsx reads the engine and writes the results.

const KEEP = 40
const WARN_AT = [95, 80]

/** Where the session works: folder and git state, from `git status --porcelain=v2 --branch` and `rev-parse`. */
export const placeOf = (cwd: string, gitStatus: string | null, gitDirs: string | null) => {
  const lines = gitStatus?.split('\n') ?? []
  const head = lines.find(l => l.startsWith('# branch.head '))?.slice(14)
  const ab = lines.find(l => l.startsWith('# branch.ab '))?.match(/\+(\d+) -(\d+)/)
  const [gitDir, commonDir] = gitDirs?.split('\n') ?? []
  return {
    dir: cwd.split('/').pop() || cwd,
    branch: head && head !== '(detached)' ? head : null,
    isWorktree: gitDir !== commonDir,
    ahead: Number(ab?.[1] ?? 0),
    behind: Number(ab?.[2] ?? 0),
    changed: lines.filter(l => l && !l.startsWith('#')).length,
  }
}

/**
 * The meters, from a measurement (`session.measure`'s input or `$.session.usage()`): context fill
 * against the auto-compact window when one smaller than the model's is known, as /context does.
 */
export const metersOf = (
  measured: Pick<SessionUsage, 'context' | 'rateLimits' | 'cost'>,
  compactWindow: number | null,
) => {
  const { tokens, window: modelWindow } = measured.context
  const contextWindow = compactWindow === null ? modelWindow : Math.min(modelWindow, compactWindow)
  return {
    contextPercent: tokens === undefined ? null : Math.round((tokens / contextWindow) * 100),
    contextTokens: tokens ?? null,
    contextWindow,
    costUsd: measured.cost?.usd ?? null,
    limits: measured.rateLimits.map(r => ({ kind: r.kind, percent: r.percentUsed, resetsAt: r.resetsAt ?? null })),
  }
}

/** A field of an object in the endpoint's answer; undefined for anything else. */
const field = (value: unknown, key: string): unknown => (typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined)

const numberAt = (value: unknown, key: string) => {
  const n = field(value, key)
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

const textAt = (value: unknown, key: string) => {
  const text = field(value, key)
  return typeof text === 'string' ? text : null
}

/** A time the endpoint spells to the microsecond, as `Date` spells it; null when unreadable. */
const isoOf = (text: string | null) => {
  const at = text === null ? NaN : Date.parse(text)
  return Number.isFinite(at) ? new Date(at).toISOString() : null
}

/** A percentage to one decimal, as the headers give it. */
const tenths = (n: number) => Math.round(n * 10) / 10

/** The windows the headers report too, each with the kind of the server's usage row that grades it. */
const PLAN_WINDOWS = [
  { kind: 'five_hour', row: 'session' },
  { kind: 'seven_day', row: 'weekly_all' },
]

/**
 * Usage credits from the answer's `extra_usage`, whose amounts are in the currency's minor units:
 * null while they are off and nothing has been spent on them.
 */
const creditsOf = (extra: unknown): Credits | null => {
  const used = numberAt(extra, 'used_credits') ?? 0
  const isOn = field(extra, 'is_enabled') === true
  if (!isOn && used <= 0) return null
  const places = numberAt(extra, 'decimal_places')
  const unit = 10 ** (places !== null && Number.isInteger(places) && places >= 0 && places <= 4 ? places : 2)
  const limit = numberAt(extra, 'monthly_limit')
  return { isOn, used: used / unit, limit: limit === null ? null : limit / unit, currency: (textAt(extra, 'currency') ?? 'USD').toUpperCase() }
}

/** The weekly limit's shares by product from the answer's `seven_day_breakdown`; null without rows. */
const breakdownOf = (value: unknown): Breakdown | null => {
  const rows = field(value, 'rows')
  const shares = (Array.isArray(rows) ? rows : []).flatMap(r => {
    const name = textAt(r, 'display_name') ?? textAt(r, 'key')
    const percent = numberAt(r, 'percent')
    return name === null || percent === null ? [] : [{ name, percent: tenths(percent) }]
  })
  return shares.length === 0 ? null : { asOf: isoOf(textAt(value, 'as_of')), rows: shares }
}

/**
 * The account's usage in an answer of `/api/oauth/usage`, what claude.ai's usage page and `/usage`
 * show: null for an answer that is not a JSON object. The 5-hour and weekly windows carry the grade
 * of their usage row; the other rows (a model's own weekly limit) come as the server sends them,
 * classified by kind, never by label. A window or a row the answer leaves out or nulls is left out.
 */
export const parsePlanUsage = (text: string): Omit<PlanUsage, 'at'> | null => {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null
  const listed = field(body, 'limits')
  const usageRows: unknown[] = Array.isArray(listed) ? listed : []
  const shares = field(body, 'weekly_scoped_shares')
  const ofWeekly = (index: number) =>
    numberAt(Array.isArray(shares) ? shares.find(share => numberAt(share, 'limit_index') === index) : undefined, 'allowance_percent_of_weekly')
  const limits = PLAN_WINDOWS.flatMap(({ kind, row }): Limit[] => {
    const window = field(body, kind)
    const percent = numberAt(window, 'utilization')
    if (percent === null) return []
    const graded = usageRows.find(r => textAt(r, 'kind') === row)
    const severity = textAt(graded, 'severity')
    const active = field(graded, 'is_active')
    return [
      {
        kind,
        percent: tenths(percent),
        resetsAt: isoOf(textAt(window, 'resets_at')),
        ...(severity === null ? {} : { severity }),
        ...(typeof active === 'boolean' ? { isActive: active } : {}),
      },
    ]
  })
  const windowRows = new Set(PLAN_WINDOWS.map(w => w.row))
  const rows = usageRows.flatMap((r, index): PlanRow[] => {
    const kind = textAt(r, 'kind')
    const percent = numberAt(r, 'percent')
    if (kind === null || percent === null || windowRows.has(kind)) return []
    const scope = field(r, 'scope')
    return [
      {
        kind,
        label: textAt(field(scope, 'model'), 'display_name') ?? textAt(field(scope, 'surface'), 'display_name') ?? kind,
        percent: tenths(percent),
        resetsAt: isoOf(textAt(r, 'resets_at')),
        severity: textAt(r, 'severity') ?? 'normal',
        isActive: field(r, 'is_active') === true,
        ofWeekly: ofWeekly(index),
      },
    ]
  })
  return { limits, rows, credits: creditsOf(field(body, 'extra_usage')), breakdown: breakdownOf(field(body, 'seven_day_breakdown')) }
}

/** Two readings of one window end within this of each other; two windows of a kind end hours apart. */
const SAME_WINDOW_MS = 60 * 60_000

const endOf = (limit: Limit) => {
  const end = limit.resetsAt === null ? NaN : Date.parse(limit.resetsAt)
  return Number.isFinite(end) ? end : null
}

/** A limit's grade from the server, as fields to spread: none where it has not graded it. */
const gradeOf = (limit: Limit) => ({
  ...(limit.severity === undefined ? {} : { severity: limit.severity }),
  ...(limit.isActive === undefined ? {} : { isActive: limit.isActive }),
})

/**
 * One limit from two readings of it, `b` the usage endpoint's. Within a window usage only grows, so
 * of two readings of the same window the higher is the truth, whichever source took it and when,
 * graded as the endpoint graded that window; a window that has ended loses to one that has not, an
 * earlier window to a later one, an unknown end to a known one.
 */
const pickLimit = (a: Limit, b: Limit, now: number): Limit => {
  const [endA, endB] = [endOf(a), endOf(b)]
  const [isOverA, isOverB] = [endA !== null && endA <= now, endB !== null && endB <= now]
  if (isOverA !== isOverB) return isOverA ? b : a
  if (endA === null && endB !== null) return b
  if (endB === null && endA !== null) return a
  if (endA !== null && endB !== null && Math.abs(endA - endB) >= SAME_WINDOW_MS) return endA > endB ? a : b
  const higher = a.percent >= b.percent ? a : b
  const graded = b.severity !== undefined || b.isActive !== undefined ? b : a
  return { kind: higher.kind, percent: higher.percent, resetsAt: higher.resetsAt, ...gradeOf(graded) }
}

/**
 * The plan limits from this session's last API response and the account's usage endpoint, one per
 * window. Each end is set to the minute, so one window reads the same from either source (the
 * headers spell it in whole seconds, the endpoint to the microsecond) and its toasts raise once.
 */
export const mergeLimits = (measured: Limit[], plan: Limit[], now: number): Limit[] =>
  [...new Set([...measured, ...plan].map(l => l.kind))].flatMap(kind => {
    const [a, b] = [measured.find(l => l.kind === kind), plan.find(l => l.kind === kind)]
    const limit = a !== undefined && b !== undefined ? pickLimit(a, b, now) : (a ?? b)
    if (limit === undefined) return []
    const end = endOf(limit)
    return [{ ...limit, resetsAt: end === null ? limit.resetsAt : new Date(Math.round(end / 60_000) * 60_000).toISOString() }]
  })

/** The rows of a `/context` breakdown that take room in the window: deferred tool schemas do not. */
export const contextPartsOf = (breakdown: SessionContextBreakdown | undefined): ContextPart[] | null =>
  breakdown === undefined
    ? null
    : breakdown.categories.flatMap(c =>
        c.kind === 'deferred' || c.tokens <= 0 ? [] : [{ name: c.name, tokens: c.tokens, color: c.color, kind: c.kind }],
      )

/** The compaction window and threshold a `/context` breakdown reports, when auto-compaction is on. */
export const compactionOf = (breakdown: SessionContextBreakdown | undefined) => ({
  compactWindow: breakdown?.isAutoCompactEnabled ? breakdown.rawMaxTokens : null,
  autoCompactAt: breakdown?.isAutoCompactEnabled ? (breakdown.autoCompactThreshold ?? null) : null,
})

/** The plan-limit toasts not raised yet in their window: a key to remember and the text to show. */
export const limitWarnings = (limits: Limit[], seen: string[], now: number) =>
  limits.flatMap(limit => {
    const threshold = WARN_AT.find(t => limit.percent >= t)
    const key = `${limit.kind}@${threshold}@${limit.resetsAt}`
    if (threshold === undefined || seen.includes(key)) return []
    const resets = limit.resetsAt ? ` · resets in ${until(limit.resetsAt, now)}` : ''
    return [{ key, text: `${limitLabel(limit.kind)} usage limit at ${limit.percent}%${resets}` }]
  })

/** The /config effort row's value, read until the first request reports the effort it used. */
export const configuredEffort = (rows: ConfigRow[]) => {
  const row = rows.find(r => /effort/i.test(r.key))
  return typeof row?.value === 'string' ? row.value : null
}

const newAgent = (id: string, now: number): AgentStat => ({
  id,
  description: '',
  type: 'agent',
  model: null,
  effort: null,
  status: 'running',
  startedAt: now,
  endedAt: null,
  tokens: NO_TOKENS,
  tools: 0,
})

/** Applies `patch` to the agent `id`, adding it first when the band has not seen it yet. */
export const withAgent = (list: AgentStat[], id: string, now: number, patch: (a: AgentStat) => AgentStat) => {
  const found = list.find(a => a.id === id)
  if (found) return list.map(a => (a.id === id ? patch(a) : a))
  return [...list, patch(newAgent(id, now))].slice(-KEEP)
}

export const settle = <T extends { status: RunStatus; endedAt: number | null }>(run: T, status: RunStatus, now: number): T => ({
  ...run,
  status,
  endedAt: isActive(status) ? null : (run.endedAt ?? now),
})

/** The engine's roster folded in: names, types and statuses; one it no longer lists has ended. */
export const mergeRoster = (list: AgentStat[], roster: AgentInfo[], now: number) => {
  let next = list
  for (const info of roster) {
    next = withAgent(next, info.id, now, a =>
      settle({ ...a, description: info.description || a.description, type: info.type }, runStatus(info.status), now),
    )
  }
  const listed = new Set(roster.map(r => r.id))
  return next.map(a => (isActive(a.status) && !listed.has(a.id) ? settle(a, 'completed', now) : a))
}

/** A subagent's model request: the model and effort it runs on, and it runs again. */
export const agentStep = (list: AgentStat[], agentId: string, model: string, level: string | null, now: number) =>
  withAgent(list, agentId, now, a => ({ ...settle(a, isActive(a.status) ? a.status : 'running', now), model, effort: level ?? a.effort }))

export const agentTokens = (list: AgentStat[], agentId: string, used: Tokens, now: number) =>
  withAgent(list, agentId, now, a => ({ ...a, tokens: addTokens(a.tokens, used) }))

export const agentTool = (list: AgentStat[], agentId: string, now: number) =>
  withAgent(list, agentId, now, a => ({ ...a, tools: a.tools + 1 }))

/** One more call of `tool` in the session that started at `since`. */
export const countTool = (counts: ToolCounts | null, tool: string, since: number): ToolCounts => {
  const list = counts?.since === since ? counts.counts : []
  const found = list.find(c => c.tool === tool)
  return {
    since,
    counts: found ? list.map(c => (c === found ? { ...c, count: c.count + 1 } : c)) : [...list, { tool, count: 1, errors: 0 }],
  }
}

/** One more failed call of `tool`, counted when its result came back as an error. */
export const countError = (counts: ToolCounts | null, tool: string, since: number): ToolCounts | null =>
  counts?.since === since ? { since, counts: counts.counts.map(c => (c.tool === tool ? { ...c, errors: (c.errors ?? 0) + 1 } : c)) } : counts

export const startLive = (list: LiveTool[], call: LiveTool) => [...list.filter(t => t.id !== call.id), call].slice(-20)

export const addShell = (list: ShellStat[], shell: ShellStat) => [...list.filter(s => s.id !== shell.id), shell].slice(-KEEP)

/** Ends the run `id` (a shell or an agent) with `status`. */
export const endRun = <T extends { id: string; status: RunStatus; endedAt: number | null }>(list: T[], id: string, status: RunStatus, now: number) =>
  list.map(r => (r.id === id ? settle(r, status, now) : r))

/** The task ids and statuses a task notification's text carries. */
export const parseNotification = (text: string) => {
  const ids = [...text.matchAll(/<task-id>([^<]+)<\/task-id>/g)].map(m => m[1]!.trim())
  const statuses = [...text.matchAll(/<status>([^<]+)<\/status>/g)].map(m => m[1]!.trim())
  return ids.map((id, i) => ({ id, status: notifiedStatus(statuses[i] ?? 'completed') }))
}

/** Whether the band has something moving: a tool in flight, a run going, or one leaving after it ended. */
export const isBusy = (live: LiveTool[], agents: AgentStat[], shells: ShellStat[], now: number) =>
  live.length > 0 || agents.some(a => isShown(a, now)) || shells.some(s => isShown(s, now))
