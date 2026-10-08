import type { AgentStat, Compactions, LiveTool, ShellStat, Snapshot, ToolCounts, Totals, TurnStat } from '../types'
import {
  NO_TOKENS,
  addTokens,
  ago,
  count,
  elapsed,
  hitRate,
  isActive,
  limitShortLabel,
  oneLine,
  prettyModel,
  shortType,
  statusMark,
  tone,
  totalTokens,
  until,
} from './format'
import type { Part } from './format'
import { ACCENT, heading, meter, parts, table } from './ui'
import type { Cell, Column, Els } from './ui'

export type BandInput = {
  els: Els
  /** Cells inside the frame: the site's columns less the border and its padding. */
  room: number
  isWorking: boolean
  now: number
  tick: number
  snap: Snapshot
  turn: TurnStat | null
  totals: Totals | null
  compactions: Compactions | null
  effort: string | null
  agents: AgentStat[]
  shells: ShellStat[]
  live: LiveTool[]
  tools: ToolCounts | null
  cacheTtlMs: number
}

/** How much history a drawing keeps: the band the recent runs, the pane all of them. */
export type Depth = { agents: number; shells: number; recentMs: number | null; tools: number }

export const BAND: Depth = { agents: 6, shells: 4, recentMs: 5 * 60_000, tools: 8 }
export const PANE: Depth = { agents: 40, shells: 40, recentMs: null, tools: 40 }

const FRAME = 4 // the round border and one cell of padding on each side

const EFFORT_COLORS: Record<string, string> = { max: 'error', xhigh: 'warning', high: ACCENT, medium: 'suggestion', low: 'success' }
const effortCell = (level: string | null): Cell => (level === null ? { text: '—', dim: true } : { text: level, color: EFFORT_COLORS[level] })
const hitCell = (hit: number | null): Cell =>
  hit === null ? { text: '—', dim: true } : { text: `${hit}%`, color: hit < 50 ? 'warning' : hit >= 80 ? 'success' : undefined }

/** Active runs first, then the most recent; ended ones only within the window when there is one. */
const visible = <T extends { status: AgentStat['status']; startedAt: number; endedAt: number | null }>(
  runs: T[],
  now: number,
  limit: number,
  recentMs: number | null,
) => {
  const shown = runs
    .filter(r => isActive(r.status) || recentMs === null || now - (r.endedAt ?? now) <= recentMs)
    .sort((a, b) => Number(isActive(b.status)) - Number(isActive(a.status)) || b.startedAt - a.startedAt)
  return { rows: shown.slice(0, limit), hidden: runs.length - Math.min(shown.length, limit) }
}

const header = (input: BandInput) => {
  const { Box, Text } = input.els
  const { snap } = input
  const where =
    `📁 ${snap.dir}` +
    (snap.branch === null ? '' : `  ⎇ ${snap.branch}${snap.isWorktree ? ' 🌳' : ''}`) +
    `${snap.ahead ? ` ↑${snap.ahead}` : ''}${snap.behind ? ` ↓${snap.behind}` : ''}${snap.changed ? ` ●${snap.changed}` : ''}`
  const session =
    `⏱ ${ago(input.now - snap.startedAt)} · ${snap.prompts} prompt${snap.prompts === 1 ? '' : 's'}` +
    (snap.costUsd === null ? '' : ` · $${snap.costUsd.toFixed(2)}`)
  const level = effortCell(input.effort)
  return (
    <Box flexDirection="row" justifyContent="space-between" width="100%">
      <Box flexDirection="row" flexShrink={0}>
        <Text bold color={ACCENT}>{'◆ VITALS  '}</Text>
        <Text bold>{prettyModel(snap.model)}</Text>
        <Text dimColor>{'  effort '}</Text>
        <Text bold color={level.color} dimColor={level.dim}>{level.text}</Text>
      </Box>
      <Box marginLeft={2} flexShrink={1}>
        <Text dimColor wrap="truncate-end">{`${where}   ${session}`}</Text>
      </Box>
    </Box>
  )
}

const meters = (input: BandInput) => {
  const { Box } = input.els
  const { snap } = input
  const used = snap.contextTokens === null ? '' : `${count(snap.contextTokens)}/${count(snap.contextWindow)}`
  const details = [used, ...snap.limits.map(l => (l.resetsAt ? `↻ ${until(l.resetsAt, input.now)}` : ''))]
  const fixed = details.reduce((sum, d) => sum + 4 + 5 + 1 + d.length + 3, 0)
  const cells = Math.max(6, Math.min(20, Math.floor((input.room - fixed) / details.length)))
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={3}>
      {meter(input.els, 'CTX', snap.contextPercent, used, cells)}
      {snap.limits.map((l, i) => meter(input.els, limitShortLabel(l.kind), l.percent, details[i + 1] ?? '', cells))}
    </Box>
  )
}

const TOKEN_COLUMNS: Column[] = [
  { title: ' ', width: 9 },
  { title: 'IN', width: 8, align: 'right' },
  { title: 'OUT', width: 8, align: 'right' },
  { title: 'CACHE R', width: 10, align: 'right' },
  { title: 'CACHE W', width: 10, align: 'right' },
  { title: 'HIT', width: 6, align: 'right' },
  { title: 'TOTAL', width: 9, align: 'right', priority: 1 },
  { title: 'NOTE', width: 10, grow: true, priority: 0 },
]

const tokenRow = (name: string, t: Record<'input' | 'output' | 'cacheRead' | 'cacheWrite', number>, note: Cell) => ({
  ' ': { text: name, bold: true },
  IN: { text: count(t.input) },
  OUT: { text: count(t.output) },
  'CACHE R': { text: count(t.cacheRead) },
  'CACHE W': { text: count(t.cacheWrite) },
  HIT: hitCell(hitRate(t)),
  TOTAL: { text: count(totalTokens(t)), dim: true },
  NOTE: note,
})

const tokensSection = (input: BandInput) => {
  const { Box } = input.els
  const { turn, totals, compactions: c, snap } = input
  const rows: Record<string, Cell>[] = []
  let cache = ''
  if (turn !== null && turn.tokens !== null && turn.at >= snap.startedAt) {
    const idleMs = Math.max(0, input.now - turn.at)
    const isCold = !input.isWorking && idleMs >= input.cacheTtlMs
    cache = isCold ? 'cache cold' : 'cache warm'
    const note = input.isWorking ? elapsed(turn.durationMs) : `${elapsed(turn.durationMs)} · idle ${ago(idleMs)}`
    rows.push(tokenRow('turn', turn.tokens, { text: note, color: isCold ? 'warning' : undefined, dim: !isCold }))
  }
  if (totals !== null && totals.since === snap.startedAt) {
    const compacted = c !== null && c.since === snap.startedAt ? ` · compacted ${c.count}×` : ''
    rows.push(tokenRow('session', totals.tokens, { text: `${totals.turns} turn${totals.turns === 1 ? '' : 's'}${compacted}`, dim: true }))
  }
  if (rows.length === 0) return null
  return (
    <Box flexDirection="column">
      {heading(input.els, 'TOKENS', cache)}
      {table(input.els, TOKEN_COLUMNS, rows, input.room)}
    </Box>
  )
}

const AGENT_COLUMNS: Column[] = [
  { title: ' ', width: 2 },
  { title: 'AGENT', width: 14, grow: true },
  { title: 'TYPE', width: 14, priority: 1 },
  { title: 'MODEL', width: 13 },
  { title: 'EFFORT', width: 8, priority: 3 },
  { title: 'TOKENS', width: 8, align: 'right' },
  { title: 'HIT', width: 5, align: 'right', priority: 2 },
  { title: 'TOOLS', width: 6, align: 'right', priority: 0 },
  { title: 'TIME', width: 8, align: 'right' },
]

const mainRow = (input: BandInput): Record<string, Cell> => {
  const agentTokens = input.agents.reduce((sum, a) => addTokens(sum, a.tokens), NO_TOKENS)
  const all = input.totals?.since === input.snap.startedAt ? input.totals.tokens : NO_TOKENS
  const own = { input: all.input - agentTokens.input, output: all.output - agentTokens.output, cacheRead: all.cacheRead - agentTokens.cacheRead, cacheWrite: all.cacheWrite - agentTokens.cacheWrite }
  const toolsAll = input.tools?.since === input.snap.startedAt ? input.tools.counts.reduce((s, c) => s + c.count, 0) : 0
  const toolsAgents = input.agents.reduce((s, a) => s + a.tools, 0)
  return {
    ' ': { text: input.isWorking ? statusMark('running', input.tick).glyph : '◆', color: ACCENT },
    AGENT: { text: 'main', bold: true },
    TYPE: { text: 'session', dim: true },
    MODEL: { text: prettyModel(input.snap.model) },
    EFFORT: effortCell(input.effort),
    TOKENS: { text: count(Math.max(0, totalTokens(own))) },
    HIT: hitCell(hitRate(own)),
    TOOLS: { text: `${Math.max(0, toolsAll - toolsAgents)}`, dim: true },
    TIME: { text: ago(input.now - input.snap.startedAt), dim: true },
  }
}

const agentRow = (input: BandInput, a: AgentStat): Record<string, Cell> => {
  const mark = statusMark(a.status, input.tick)
  return {
    ' ': { text: mark.glyph, color: mark.color },
    AGENT: { text: a.description || shortType(a.type), dim: !isActive(a.status) },
    TYPE: { text: shortType(a.type), dim: true },
    MODEL: a.model === null ? { text: '…', dim: true } : { text: prettyModel(a.model) },
    EFFORT: effortCell(a.effort),
    TOKENS: { text: count(totalTokens(a.tokens)) },
    HIT: hitCell(hitRate(a.tokens)),
    TOOLS: { text: `${a.tools}`, dim: true },
    TIME: { text: elapsed((a.endedAt ?? input.now) - a.startedAt), dim: !isActive(a.status) },
  }
}

const agentsSection = (input: BandInput, depth: Depth) => {
  const { Box } = input.els
  if (input.agents.length === 0) return null
  const { rows, hidden } = visible(input.agents, input.now, depth.agents, depth.recentMs)
  const running = input.agents.filter(a => isActive(a.status)).length
  const note = `${running} running · ${input.agents.length - running} done${hidden > 0 ? ` · ${hidden} more in /vitals pane` : ''}`
  return (
    <Box flexDirection="column">
      {heading(input.els, 'AGENTS', note)}
      {table(input.els, AGENT_COLUMNS, [mainRow(input), ...rows.map(a => agentRow(input, a))], input.room)}
    </Box>
  )
}

const SHELL_COLUMNS: Column[] = [
  { title: ' ', width: 2 },
  { title: 'SHELL', width: 11, priority: 1 },
  { title: 'COMMAND', width: 16, grow: true },
  { title: 'BY', width: 14, priority: 0 },
  { title: 'STATUS', width: 10, priority: 2 },
  { title: 'TIME', width: 8, align: 'right' },
]

const shellsSection = (input: BandInput, depth: Depth) => {
  const { Box } = input.els
  if (input.shells.length === 0) return null
  const { rows, hidden } = visible(input.shells, input.now, depth.shells, depth.recentMs)
  const running = input.shells.filter(s => isActive(s.status)).length
  const by = (agentId: string | null) => {
    const agent = agentId === null ? undefined : input.agents.find(a => a.id === agentId)
    return agent ? shortType(agent.type) : 'main'
  }
  const cells = rows.map((s): Record<string, Cell> => {
    const mark = statusMark(s.status, input.tick)
    return {
      ' ': { text: mark.glyph, color: mark.color },
      SHELL: { text: s.id, dim: true },
      COMMAND: { text: `$ ${oneLine(s.description ?? s.command)}`, dim: !isActive(s.status) },
      BY: { text: by(s.agentId), dim: true },
      STATUS: { text: s.status, color: mark.color },
      TIME: { text: elapsed((s.endedAt ?? input.now) - s.startedAt), dim: !isActive(s.status) },
    }
  })
  const note = `${running} running · ${input.shells.length - running} done${hidden > 0 ? ` · ${hidden} more in /vitals pane` : ''}`
  return (
    <Box flexDirection="column">
      {heading(input.els, 'SHELLS', note)}
      {table(input.els, SHELL_COLUMNS, cells, input.room)}
    </Box>
  )
}

/** What runs right now, and the session's most used tools. */
const activity = (input: BandInput, depth: Depth) => {
  const { Box, Text } = input.els
  const agentName = (id: string | null) => {
    const agent = id === null ? undefined : input.agents.find(a => a.id === id)
    return agent ? ` ‹${shortType(agent.type)}›` : ''
  }
  const now: Part[] = input.live.map(t => {
    const ms = input.now - t.startedAt
    return { text: `${t.tool}${ms >= 1000 ? ` ${elapsed(ms)}` : ''}${agentName(t.agentId)}`, color: 'text' }
  })
  const counts = input.tools?.since === input.snap.startedAt ? [...input.tools.counts].sort((a, b) => b.count - a.count) : []
  const top: Part[] = counts.slice(0, depth.tools).map(c => ({ text: `${c.tool} ${c.count}` }))
  if (counts.length > depth.tools) top.push({ text: `+${counts.length - depth.tools}` })
  return (
    <Box flexDirection="column" marginTop={1}>
      {now.length > 0 && (
        <Box flexDirection="row">
          <Box width={8} flexShrink={0}>
            <Text bold color={ACCENT}>{`${statusMark('running', input.tick).glyph} NOW`}</Text>
          </Box>
          {parts(input.els, now)}
        </Box>
      )}
      {top.length > 0 && (
        <Box flexDirection="row">
          <Box width={8} flexShrink={0}>
            <Text bold dimColor>{'⚒ TOOLS'}</Text>
          </Box>
          {parts(input.els, top)}
        </Box>
      )}
    </Box>
  )
}

/** The framed dashboard: header, meters, tokens, agents, shells and live activity. */
export const drawBand = (input: BandInput, depth: Depth) => {
  const { Box } = input.els
  const inner = { ...input, room: input.room - FRAME }
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={ACCENT} paddingX={1}>
      {header(inner)}
      {meters(inner)}
      {tokensSection(inner)}
      {agentsSection(inner, depth)}
      {shellsSection(inner, depth)}
      {activity(inner, depth)}
    </Box>
  )
}

// One line for small windows: model, effort, context, limits, cache hit, cost, what runs.
export const drawCompact = (input: BandInput) => {
  const { snap, turn } = input
  const hit = turn?.tokens ? hitRate(turn.tokens) : null
  const runningAgents = input.agents.filter(a => isActive(a.status)).length
  const runningShells = input.shells.filter(s => isActive(s.status)).length
  const spin = statusMark('running', input.tick).glyph
  const level = effortCell(input.effort)
  const list: Part[] = [
    { text: `◆ ${prettyModel(snap.model)}`, emphasis: 'strong' },
    ...(input.effort === null ? [] : [{ text: `effort ${input.effort}`, color: level.color }]),
    ...(snap.contextPercent === null
      ? []
      : [{ text: `ctx ${snap.contextPercent}%`, emphasis: tone(snap.contextPercent) === undefined ? undefined : ('warning' as const) }]),
    ...snap.limits.map(l => ({
      text: `${limitShortLabel(l.kind).toLowerCase()} ${l.percent}%`,
      emphasis: tone(l.percent) === undefined ? undefined : ('warning' as const),
    })),
    ...(hit === null ? [] : [{ text: `hit ${hit}%`, emphasis: hit < 50 ? ('warning' as const) : undefined }]),
    ...(snap.costUsd === null ? [] : [{ text: `$${snap.costUsd.toFixed(2)}` }]),
    ...(runningAgents === 0 ? [] : [{ text: `${spin} ${runningAgents} agent${runningAgents > 1 ? 's' : ''}`, color: ACCENT }]),
    ...(runningShells === 0 ? [] : [{ text: `$ ${runningShells} shell${runningShells > 1 ? 's' : ''}`, color: ACCENT }]),
  ]
  return parts(input.els, list)
}
