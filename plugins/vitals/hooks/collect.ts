import type { AgentInfo, ConfigRow, SessionUsage } from 'claude-code'

import type { AgentStat, Limit, LiveTool, RunStatus, ShellStat, Snapshot, ToolCounts, Tokens } from '../types'
import { NO_TOKENS, addTokens, isActive, limitLabel, notifiedStatus, runStatus, until } from './format'

// Pure folds over the session's values: register.tsx reads the engine and writes the results.

const KEEP = 40
const WARN_AT = [95, 80]

/** The snapshot of one refresh: usage, folder, git state and model. */
export const buildSnapshot = (args: {
  usage: SessionUsage
  cwd: string
  now: number
  prompts: number
  model: string
  gitStatus: string | null
  gitDirs: string | null
}): Snapshot => {
  const { usage, cwd } = args
  const lines = args.gitStatus?.split('\n') ?? []
  const head = lines.find(l => l.startsWith('# branch.head '))?.slice(14)
  const ab = lines.find(l => l.startsWith('# branch.ab '))?.match(/\+(\d+) -(\d+)/)
  const [gitDir, commonDir] = args.gitDirs?.split('\n') ?? []
  // Measure against the auto-compact window when one smaller than the model's is set, as /context does.
  const { tokens: contextTokens, window: modelWindow, breakdown } = usage.context
  const contextWindow = breakdown?.isAutoCompactEnabled ? Math.min(modelWindow, breakdown.rawMaxTokens) : modelWindow
  return {
    at: args.now,
    startedAt: usage.startedAt,
    prompts: args.prompts,
    model: args.model,
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
    limits: usage.rateLimits.map(r => ({ kind: r.kind, percent: r.percentUsed, resetsAt: r.resetsAt ?? null })),
  }
}

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
    counts: found ? list.map(c => (c === found ? { ...c, count: c.count + 1 } : c)) : [...list, { tool, count: 1 }],
  }
}

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

export const isBusy = (live: LiveTool[], agents: AgentStat[], shells: ShellStat[]) =>
  live.length > 0 || agents.some(a => isActive(a.status)) || shells.some(s => isActive(s.status))
