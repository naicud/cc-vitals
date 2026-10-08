import type { RenderChildren } from 'claude-code'

import type { AgentStat, Compactions, HistoryProblem, LiveTool, ShellStat, Snapshot, ToolCounts, Totals, TurnStat, UsageHistory } from '../types'
import {
  NO_TOKENS,
  addTokens,
  ago,
  count,
  delta,
  elapsed,
  hitRate,
  isActive,
  money,
  oneLine,
  prettyModel,
  shortType,
  statusMark,
  toolName,
  totalTokens,
} from './format'
import type { Part } from './format'
import { change, dailyCosts, localDate, modelShares, periods } from './report'
import { ACCENT, CARD_CELLS, CARD_ROWS, blocks, card, parts, sparkline, table } from './ui'
import type { Canvas, Cell, Column } from './ui'

export type BandInput = {
  canvas: Canvas
  /** Cells the drawing is laid out in: the site's columns. */
  room: number
  /** Rows the drawing may take before it would scroll. */
  rows: number
  isWorking: boolean
  now: number
  snap: Snapshot
  turn: TurnStat | null
  totals: Totals | null
  compactions: Compactions | null
  effort: string | null
  agents: AgentStat[]
  shells: ShellStat[]
  live: LiveTool[]
  tools: ToolCounts | null
  history: UsageHistory | null
  historyProblem: HistoryProblem | null
  cacheTtlMs: number
}

/**
 * A section: its own box when the rows allow (`fullRows` tall, box included), else one line.
 * `room` is the width the box takes.
 */
export type Section = { full: () => RenderChildren; fullRows: number; mini: () => RenderChildren }

/** A table's header and the rule under it. */
const TABLE_HEAD = 2

export const EFFORT_COLORS: Record<string, string> = { max: 'error', xhigh: 'warning', high: ACCENT, medium: 'suggestion', low: 'success' }

export const effortCell = (level: string | null): Cell =>
  level === null ? { text: '—', dim: true } : { text: level, color: EFFORT_COLORS[level] }
const hitCell = (hit: number | null): Cell =>
  hit === null ? { text: '—', dim: true } : { text: `${hit}%`, color: hit < 50 ? 'warning' : hit >= 80 ? 'success' : undefined }

/** The spinner frame: the band redraws once a second while something runs. */
export const frame = (input: BandInput) => Math.floor(input.now / 1000)

/** Active runs first, then the newest; ended ones stay, dimmed, until newer ones push them out. */
const newestFirst = <T extends { status: AgentStat['status']; startedAt: number }>(runs: T[]) =>
  [...runs].sort((a, b) => Number(isActive(b.status)) - Number(isActive(a.status)) || b.startedAt - a.startedAt)

const runNote = (running: number, all: number, hidden: number) =>
  `${running} running · ${all - running} done${hidden > 0 ? ` · +${hidden} in /vitals pane` : ''}`

/** A one-line section: a bold label, then its parts. */
export const lineOf = (input: BandInput, label: string, list: Part[]) => {
  const { Box, Text } = input.canvas.els
  return (
    <Box flexDirection="row">
      <Box width={11} flexShrink={0}>
        <Text bold color={ACCENT}>{label}</Text>
      </Box>
      {parts(input.canvas.els, list)}
    </Box>
  )
}

const TOKEN_COLUMNS: Column[] = [
  { title: ' ', width: 7 },
  { title: 'IN', width: 6, align: 'right' },
  { title: 'OUT', width: 6, align: 'right' },
  { title: 'CACHE R', width: 7, align: 'right' },
  { title: 'CACHE W', width: 7, align: 'right' },
  { title: 'HIT', width: 4, align: 'right' },
  { title: 'TOTAL', width: 6, align: 'right', priority: 1 },
  { title: 'NOTE', width: 8, grow: true, priority: 0 },
]

type TokenCounts = Record<'input' | 'output' | 'cacheRead' | 'cacheWrite', number>

const tokenRow = (name: string, t: TokenCounts, note: Cell) => ({
  ' ': { text: name, bold: true },
  IN: { text: count(t.input) },
  OUT: { text: count(t.output) },
  'CACHE R': { text: count(t.cacheRead) },
  'CACHE W': { text: count(t.cacheWrite) },
  HIT: hitCell(hitRate(t)),
  TOTAL: { text: count(totalTokens(t)), bold: true },
  NOTE: note,
})

const tokenParts = (name: string, t: TokenCounts): Part[] => {
  const hit = hitRate(t)
  return [
    { text: name, emphasis: 'strong' },
    { text: `in ${count(t.input)} out ${count(t.output)}` },
    { text: `R ${count(t.cacheRead)} W ${count(t.cacheWrite)}` },
    ...(hit === null ? [] : [{ text: `hit ${hit}%`, color: hit < 50 ? 'warning' : 'success' }]),
  ]
}

export const tokensSection = (input: BandInput, room: number): Section | null => {
  const { turn, totals, snap } = input
  const hasTurn = turn !== null && turn.tokens !== null && turn.at >= snap.startedAt
  const hasTotals = totals !== null && totals.since === snap.startedAt
  if (!hasTurn && !hasTotals) return null
  const idleMs = turn === null ? 0 : Math.max(0, input.now - turn.at)
  const isCold = hasTurn && !input.isWorking && idleMs >= input.cacheTtlMs
  const cache = !hasTurn ? '' : isCold ? '🥶 cache cold' : `🧊 cache warm${input.isWorking ? '' : ` · expires in ${ago(input.cacheTtlMs - idleMs)}`}`
  const rows: Record<string, Cell>[] = []
  if (hasTurn && turn.tokens !== null) {
    const note = input.isWorking ? elapsed(turn.durationMs) : `${elapsed(turn.durationMs)} · idle ${ago(idleMs)}`
    rows.push(tokenRow('turn', turn.tokens, { text: note, color: isCold ? 'warning' : undefined, dim: !isCold }))
  }
  if (hasTotals) rows.push(tokenRow('session', totals.tokens, { text: `${totals.turns} turn${totals.turns === 1 ? '' : 's'}`, dim: true }))
  return {
    fullRows: CARD_ROWS + TABLE_HEAD + rows.length,
    full: () => card(input.canvas.els, '🔥 TOKENS', cache, room, table(input.canvas.els, TOKEN_COLUMNS, rows, room - CARD_CELLS)),
    mini: () =>
      lineOf(input, '🔥 TOKENS', [
        ...(hasTurn && turn.tokens !== null ? tokenParts('turn', turn.tokens) : []),
        ...(hasTotals ? tokenParts('session', totals.tokens) : []),
        ...(cache === '' ? [] : [{ text: cache, color: isCold ? 'warning' : undefined }]),
      ]),
  }
}

const AGENT_COLUMNS: Column[] = [
  { title: ' ', width: 1 },
  { title: 'AGENT', width: 12, grow: true },
  { title: 'TYPE', width: 13, priority: 1 },
  { title: 'MODEL', width: 11 },
  { title: 'EFFORT', width: 6, priority: 3 },
  { title: 'TOKENS', width: 6, align: 'right' },
  { title: 'HIT', width: 4, align: 'right', priority: 2 },
  { title: 'TOOLS', width: 5, align: 'right', priority: 0 },
  { title: 'TIME', width: 6, align: 'right' },
]

const mainRow = (input: BandInput): Record<string, Cell> => {
  const agentTokens = input.agents.reduce((sum, a) => addTokens(sum, a.tokens), NO_TOKENS)
  const all = input.totals?.since === input.snap.startedAt ? input.totals.tokens : NO_TOKENS
  const own = {
    input: all.input - agentTokens.input,
    output: all.output - agentTokens.output,
    cacheRead: all.cacheRead - agentTokens.cacheRead,
    cacheWrite: all.cacheWrite - agentTokens.cacheWrite,
  }
  const toolsAll = input.tools?.since === input.snap.startedAt ? input.tools.counts.reduce((s, c) => s + c.count, 0) : 0
  const toolsAgents = input.agents.reduce((s, a) => s + a.tools, 0)
  return {
    ' ': { text: input.isWorking ? statusMark('running', frame(input)).glyph : '◆', color: ACCENT },
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
  const mark = statusMark(a.status, frame(input))
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

/** The main loop and every subagent: what each runs on and what it spent. */
export const agentsSection = (input: BandInput, room: number, limit: number): Section => {
  const sorted = newestFirst(input.agents)
  const running = sorted.filter(a => isActive(a.status))
  const shown = sorted.slice(0, Math.max(running.length, Math.min(sorted.length, limit)))
  const note = sorted.length === 0 ? 'no subagents yet' : runNote(running.length, sorted.length, sorted.length - shown.length)
  return {
    fullRows: CARD_ROWS + TABLE_HEAD + 1 + shown.length,
    full: () =>
      card(
        input.canvas.els,
        '🤖 AGENTS',
        note,
        room,
        table(input.canvas.els, AGENT_COLUMNS, [mainRow(input), ...shown.map(a => agentRow(input, a))], room - CARD_CELLS),
      ),
    mini: () =>
      lineOf(input, '🤖 AGENTS', [
        ...(sorted.length === 0 ? [{ text: 'no subagents yet' }] : []),
        ...sorted.slice(0, 4).map(a => {
          const mark = statusMark(a.status, frame(input))
          return {
            text: `${mark.glyph} ${shortType(a.type)} ${a.model === null ? '' : prettyModel(a.model)}${a.effort ? ` ${a.effort}` : ''} ${count(totalTokens(a.tokens))}`,
            color: isActive(a.status) ? 'text' : undefined,
          }
        }),
        ...(sorted.length > 4 ? [{ text: `+${sorted.length - 4}` }] : []),
      ]),
  }
}

const TOOL_COLUMNS: Column[] = [
  { title: ' ', width: 1 },
  { title: 'TOOL', width: 12, grow: true },
  { title: 'CALLS', width: 5, align: 'right' },
  { title: 'ERR', width: 3, align: 'right', priority: 1 },
  { title: 'USE', width: 10, priority: 0 },
  { title: 'NOW', width: 16, priority: 2 },
]

/** Every tool the session called: calls, failures, share of use, and what runs this second. */
export const toolsSection = (input: BandInput, room: number, limit: number): Section | null => {
  const counts = input.tools?.since === input.snap.startedAt ? input.tools.counts : []
  if (counts.length === 0 && input.live.length === 0) return null
  const agentName = (id: string | null) => {
    const agent = id === null ? undefined : input.agents.find(a => a.id === id)
    return agent ? ` ‹${shortType(agent.type)}›` : ''
  }
  const runningOf = (tool: string) => input.live.filter(t => t.tool === tool).sort((a, b) => a.startedAt - b.startedAt)
  const sorted = [...counts].sort((a, b) => runningOf(b.tool).length - runningOf(a.tool).length || b.count - a.count)
  const shown = sorted.slice(0, Math.max(1, limit))
  const top = Math.max(1, ...counts.map(c => c.count))
  const calls = counts.reduce((s, c) => s + c.count, 0)
  const errors = counts.reduce((s, c) => s + (c.errors ?? 0), 0)
  const rows = shown.map((c): Record<string, Cell> => {
    const runs = runningOf(c.tool)
    const oldest = runs[0]
    return {
      ' ': oldest ? { text: statusMark('running', frame(input)).glyph, color: ACCENT } : { text: '·', dim: true },
      TOOL: { text: toolName(c.tool), bold: oldest !== undefined },
      CALLS: { text: `${c.count}` },
      ERR: (c.errors ?? 0) > 0 ? { text: `${c.errors}`, color: 'warning' } : { text: '0', dim: true },
      USE: { text: blocks((c.count / top) * 100, 10).filled, color: oldest ? ACCENT : 'suggestion' },
      NOW: oldest
        ? { text: `${elapsed(input.now - oldest.startedAt)}${runs.length > 1 ? ` ×${runs.length}` : ''}${agentName(oldest.agentId)}`, color: ACCENT }
        : { text: '' },
    }
  })
  const note = `${calls} calls · ${errors} error${errors === 1 ? '' : 's'}${input.live.length > 0 ? ` · ${input.live.length} running` : ''}`
  return {
    fullRows: CARD_ROWS + TABLE_HEAD + rows.length,
    full: () => card(input.canvas.els, '🔧 TOOLS', note, room, table(input.canvas.els, TOOL_COLUMNS, rows, room - CARD_CELLS)),
    mini: () =>
      lineOf(input, '🔧 TOOLS', [
        ...input.live.map(t => ({ text: `${statusMark('running', frame(input)).glyph} ${toolName(t.tool)} ${elapsed(input.now - t.startedAt)}`, color: ACCENT })),
        ...sorted.slice(0, 6).map(c => ({ text: `${toolName(c.tool)} ${c.count}` })),
      ]),
  }
}

const SHELL_COLUMNS: Column[] = [
  { title: ' ', width: 1 },
  { title: 'SHELL', width: 9, priority: 1 },
  { title: 'COMMAND', width: 16, grow: true },
  { title: 'BY', width: 12, priority: 0 },
  { title: 'STATUS', width: 9, priority: 2 },
  { title: 'TIME', width: 6, align: 'right' },
]

export const shellsSection = (input: BandInput, room: number, limit: number): Section | null => {
  if (input.shells.length === 0) return null
  const sorted = newestFirst(input.shells)
  const running = sorted.filter(s => isActive(s.status))
  const by = (agentId: string | null) => {
    const agent = agentId === null ? undefined : input.agents.find(a => a.id === agentId)
    return agent ? shortType(agent.type) : 'main'
  }
  const shown = sorted.slice(0, Math.max(running.length, Math.min(sorted.length, limit)))
  const cells = shown.map((s): Record<string, Cell> => {
    const mark = statusMark(s.status, frame(input))
    return {
      ' ': { text: mark.glyph, color: mark.color },
      SHELL: { text: s.id, dim: true },
      COMMAND: { text: `$ ${oneLine(s.description ?? s.command)}`, dim: !isActive(s.status) },
      BY: { text: by(s.agentId), dim: true },
      STATUS: { text: s.status, color: mark.color },
      TIME: { text: elapsed((s.endedAt ?? input.now) - s.startedAt), dim: !isActive(s.status) },
    }
  })
  const note = runNote(running.length, sorted.length, sorted.length - shown.length)
  return {
    fullRows: CARD_ROWS + TABLE_HEAD + shown.length,
    full: () => card(input.canvas.els, '🐚 SHELLS', note, room, table(input.canvas.els, SHELL_COLUMNS, cells, room - CARD_CELLS)),
    mini: () =>
      lineOf(input, '🐚 SHELLS', [
        ...sorted.slice(0, 3).map(s => {
          const mark = statusMark(s.status, frame(input))
          return {
            text: `${mark.glyph} ${oneLine(s.description ?? s.command)} ${s.status} ${elapsed((s.endedAt ?? input.now) - s.startedAt)}`,
            color: isActive(s.status) ? ACCENT : undefined,
          }
        }),
        ...(sorted.length > 3 ? [{ text: `+${sorted.length - 3}` }] : []),
      ]),
  }
}

const USAGE_COLUMNS: Column[] = [
  { title: 'PERIOD', width: 6 },
  { title: 'COST', width: 7, align: 'right' },
  { title: 'TOKENS', width: 7, align: 'right' },
  { title: 'VS BEFORE', width: 9, align: 'right', priority: 2 },
  { title: 'TOP MODELS', width: 10, grow: true, priority: 1 },
]

const deltaCell = (now: number, before: number): Cell => {
  const pct = change(now, before)
  return pct === null ? { text: '—', dim: true } : { text: delta(pct), color: pct > 0 ? 'warning' : 'success' }
}

/** Today, this week and this month across every session, with a 14-day sparkline. */
export const usageSection = (input: BandInput, room: number): Section | null => {
  const { Box, Text } = input.canvas.els
  const { history, historyProblem: problem } = input
  if (history === null) {
    if (problem === null) return null
    const line = () => lineOf(input, '📊 USAGE', [{ text: `no history: ${problem.reason}` }])
    return { fullRows: 1, full: line, mini: line }
  }
  const today = localDate(input.now)
  const spans = periods(history.days, today)
  const rows = spans.map((p): Record<string, Cell> => {
    const top = modelShares(history.days, p.from, p.to).slice(0, 2)
    const share = (usd: number) => (p.now.costUsd > 0 ? Math.round((usd / p.now.costUsd) * 100) : 0)
    return {
      PERIOD: { text: p.name, bold: true },
      COST: { text: money(p.now.costUsd), bold: true },
      TOKENS: { text: count(p.now.tokens) },
      'VS BEFORE': p.before === null ? { text: '—', dim: true } : deltaCell(p.now.costUsd, p.before.costUsd),
      'TOP MODELS': { text: top.map(m => `${prettyModel(m.model)} ${share(m.costUsd)}%`).join(' · '), dim: true },
    }
  })
  const costs = dailyCosts(history.days, today, 14)
  const stale = problem !== null && problem.at > history.at ? '⚠ stale · ' : ''
  return {
    fullRows: CARD_ROWS + TABLE_HEAD + rows.length + 1,
    full: () =>
      card(
        input.canvas.els,
        '📊 USAGE',
        `${stale}ccusage · ${ago(input.now - history.at)} ago`,
        room,
        <Box flexDirection="column">
          {table(input.canvas.els, USAGE_COLUMNS, rows, room - CARD_CELLS)}
          <Box flexDirection="row">
            <Text dimColor>{'14 days  '}</Text>
            <Text color={ACCENT}>{sparkline(costs)}</Text>
            <Text dimColor>{`  peak ${money(Math.max(...costs))} · /vitals report`}</Text>
          </Box>
        </Box>,
      ),
    mini: () =>
      lineOf(input, '📊 USAGE', [
        ...spans.map(p => ({ text: `${p.name} ${money(p.now.costUsd)}`, emphasis: 'strong' as const })),
        { text: sparkline(costs), color: ACCENT },
      ]),
  }
}
