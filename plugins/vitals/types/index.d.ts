/**
 * A plan limit. `severity` and `isActive` are the server's, when its usage endpoint read the same
 * window: its grade for the meter's colour (`normal`, `warning`, `critical`) and whether this is
 * the limit a single-value indicator shows.
 */
export type Limit = { kind: string; percent: number; resetsAt: string | null; severity?: string; isActive?: boolean }

export type Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number }

export type Snapshot = {
  at: number
  startedAt: number
  prompts: number
  model: string
  dir: string
  branch: string | null
  isWorktree: boolean
  ahead: number
  behind: number
  changed: number
  contextPercent: number | null
  contextTokens: number | null
  contextWindow: number
  costUsd: number | null
  limits: Limit[]
  /** The token count auto-compaction runs at, or null when it is off or not read yet. */
  autoCompactAt: number | null
  /** What fills the context, as /context breaks it down (estimated); null until first read. */
  contextParts: ContextPart[] | null
}

/** One row of the context's breakdown: its tokens and the theme colour /context draws it in. */
export type ContextPart = { name: string; tokens: number; color: string; kind: 'used' | 'free' | 'buffer' }

export type TurnStat = {
  at: number
  durationMs: number
  model: string | null
  tokens: Tokens | null
}

export type Totals = { since: number; turns: number; tokens: Tokens }

export type Compactions = {
  since: number
  count: number
  before: number | null
  after: number | null
  /** When the last one finished, and what started it (`auto`, `manual`, `plugin`). */
  at: number | null
  trigger: string | null
}

/** Where a subagent or a background shell stands, as the band draws it. */
export type RunStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'killed'

export type AgentStat = {
  id: string
  description: string
  type: string
  model: string | null
  effort: string | null
  status: RunStatus
  startedAt: number
  endedAt: number | null
  tokens: Tokens
  tools: number
}

export type ShellStat = {
  id: string
  command: string
  description: string | null
  agentId: string | null
  status: RunStatus
  startedAt: number
  endedAt: number | null
}

/** A tool call in flight: drawn live with its elapsed time. */
export type LiveTool = { id: string; tool: string; agentId: string | null; startedAt: number }

export type ToolCount = { tool: string; count: number; errors: number }

export type ToolCounts = { since: number; counts: ToolCount[] }

/** How much the band shows: the vitals box alone, plus context and agents, or everything. */
export type View = 'low' | 'medium' | 'high'

/** One model's share of a day, as ccusage prices it. */
export type ModelDay = { model: string; costUsd: number; tokens: number }

/** One local day of Claude Code usage across every session on this machine. */
export type DayUsage = {
  date: string
  costUsd: number
  tokens: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  models: ModelDay[]
}

/** The daily history the usage section and the report pane read: when it was read and the days. */
export type UsageHistory = { at: number; days: DayUsage[] }

/** Why the history could not be read this time; the last good one stays drawn. */
export type HistoryProblem = { at: number; reason: string }

/**
 * One of the server's usage rows beyond the 5-hour and weekly windows, as it sends them: a model's
 * or a surface's own weekly limit (`weekly_scoped`), or a meter Vitals does not know yet.
 */
export type PlanRow = {
  kind: string
  /** The server's label for what the row is for (`Fable`), else its kind. */
  label: string
  percent: number
  resetsAt: string | null
  severity: string
  isActive: boolean
  /** The share of the weekly limit this row may use, when the server says (`50`). */
  ofWeekly: number | null
}

/** Usage credits (extra usage), in the currency's major units: what they cover once a limit is hit. */
export type Credits = {
  /** Whether they cover sends now: off when turned off, or when the month's limit is spent. */
  isOn: boolean
  used: number
  /** The month's limit; null for none. */
  limit: number | null
  currency: string
}

/** Who spent the weekly limit, by product (Claude Code, chats, Cowork, ...), as shares of it. */
export type Breakdown = { asOf: string | null; rows: { name: string; percent: number }[] }

/** The account's usage as its usage endpoint last reported it, and when. */
export type PlanUsage = {
  at: number
  limits: Limit[]
  rows: PlanRow[]
  /** Null while usage credits are off. */
  credits: Credits | null
  breakdown: Breakdown | null
}

declare module 'claude-code' {
  interface PluginState {
    vitals: {
      snap: Snapshot | null
      warned: string[]
      lastTurn: TurnStat | null
      totals: Totals | null
      compactions: Compactions | null
      effort: string | null
      view: View
      agents: AgentStat[]
      shells: ShellStat[]
      live: LiveTool[]
      tools: ToolCounts | null
      history: UsageHistory | null
      historyProblem: HistoryProblem | null
      plan: PlanUsage | null
    }
  }
}
