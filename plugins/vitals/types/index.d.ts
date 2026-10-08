export type Limit = { kind: string; percent: number; resetsAt: string | null }

export type Agent = { type: string; description: string }

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
  agents: Agent[]
}

export type TurnStat = {
  at: number
  durationMs: number
  model: string | null
  tokens: Tokens | null
}

export type Totals = { since: number; turns: number; tokens: Tokens }

export type Compactions = { since: number; count: number; before: number | null; after: number | null }

declare module 'claude-code' {
  interface PluginState {
    vitals: {
      snap: Snapshot | null
      warned: string[]
      lastTurn: TurnStat | null
      totals: Totals | null
      compactions: Compactions | null
      effort: string | null
      isCompact: boolean
    }
  }
}
