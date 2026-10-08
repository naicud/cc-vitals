export type Limit = { kind: string; percent: number; resetsAt: string | null }

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
}

export type TurnStat = {
  at: number
  durationMs: number
  model: string | null
  tokens: Tokens | null
}

export type Totals = { since: number; turns: number; tokens: Tokens }

export type Compactions = { since: number; count: number; before: number | null; after: number | null }

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

export type ToolCount = { tool: string; count: number }

export type ToolCounts = { since: number; counts: ToolCount[] }

export type View = 'full' | 'compact'

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
      tick: number
    }
  }
}
