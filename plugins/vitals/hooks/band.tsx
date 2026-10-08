import type { RenderChildren } from 'claude-code'

import type { AgentStat, Compactions, HistoryProblem, LiveTool, ShellStat, Snapshot, ToolCounts, Totals, TurnStat, UsageHistory } from '../types'
import {
  NO_TOKENS,
  addTokens,
  ago,
  count,
  delta,
  effortPips,
  elapsed,
  hitRate,
  isActive,
  limitShortLabel,
  money,
  oneLine,
  toolName,
  prettyModel,
  shortType,
  statusMark,
  tone,
  totalTokens,
  until,
} from './format'
import type { Part } from './format'
import { change, dailyCosts, localDate, modelShares, periods } from './report'
import { ACCENT, meter, meterChrome, parts, rule, sparkline, table } from './ui'
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

/** The round border and one cell of padding on each side; the border's two rows. */
const FRAME_CELLS = 4
const FRAME_ROWS = 2
/** Rule, header and the rule under it: what a table section costs besides its rows. */
const TABLE_CHROME = 3

const EFFORT_COLORS: Record<string, string> = { max: 'error', xhigh: 'warning', high: ACCENT, medium: 'suggestion', low: 'success' }
const LIMIT_ICONS: Record<string, string> = { five_hour: '⏳', seven_day: '📅' }

const effortCell = (level: string | null): Cell => (level === null ? { text: '—', dim: true } : { text: level, color: EFFORT_COLORS[level] })
const hitCell = (hit: number | null): Cell =>
  hit === null ? { text: '—', dim: true } : { text: `${hit}%`, color: hit < 50 ? 'warning' : hit >= 80 ? 'success' : undefined }
/** The spinner frame: the band redraws once a second while something runs. */
const frame = (input: BandInput) => Math.floor(input.now / 1000)

/** A section drawn in full when the rows allow, else as one line, else not at all. */
type Section = { full: () => RenderChildren; fullRows: number; mini: () => RenderChildren }

/** Active runs first, then the newest; ended ones stay, dimmed, until newer ones push them out. */
const newestFirst = <T extends { status: AgentStat['status']; startedAt: number }>(runs: T[]) =>
  [...runs].sort((a, b) => Number(isActive(b.status)) - Number(isActive(a.status)) || b.startedAt - a.startedAt)

const header = (input: BandInput) => {
  const { Box, Text } = input.canvas.els
  const { snap } = input
  const where =
    `📁 ${snap.dir}` +
    (snap.branch === null ? '' : `  🌿 ${snap.branch}${snap.isWorktree ? ' 🌳' : ''}`) +
    `${snap.ahead ? ` ↑${snap.ahead}` : ''}${snap.behind ? ` ↓${snap.behind}` : ''}${snap.changed ? ` ●${snap.changed}` : ''}`
  const ageMs = input.now - snap.startedAt
  const burn = snap.costUsd !== null && ageMs >= 5 * 60_000 ? `  🔥 ${money(snap.costUsd / (ageMs / 3_600_000))}/h` : ''
  const level = effortCell(input.effort)
  return (
    <Box flexDirection="row" justifyContent="space-between" width="100%">
      <Box flexDirection="row" flexShrink={0}>
        <Text bold color={ACCENT}>{'◆ VITALS'}</Text>
        <Text>{'   🧠 '}</Text>
        <Text bold>{prettyModel(snap.model)}</Text>
        <Text>{'   ⚡ '}</Text>
        <Text bold color={level.color} dimColor={level.dim}>{level.text.toUpperCase()}</Text>
        {input.effort !== null && <Text color={level.color}>{` ${effortPips(input.effort)}`}</Text>}
      </Box>
      <Box flexDirection="row" marginLeft={2} flexShrink={1}>
        <Text dimColor wrap="truncate-end">{`${where}   ⏳ ${ago(ageMs)} · ${snap.prompts} prompt${snap.prompts === 1 ? '' : 's'}   `}</Text>
        {snap.costUsd !== null && <Text bold>{`💸 ${money(snap.costUsd)}`}</Text>}
        {burn !== '' && <Text dimColor>{burn}</Text>}
      </Box>
    </Box>
  )
}

const meters = (input: BandInput) => {
  const { Box, Text } = input.canvas.els
  const { snap } = input
  const items = [
    { label: '⛽ CTX', percent: snap.contextPercent, detail: snap.contextTokens === null ? '' : `${count(snap.contextTokens)}/${count(snap.contextWindow)}` },
    ...snap.limits.map(l => ({
      label: `${LIMIT_ICONS[l.kind] ?? '⏳'} ${limitShortLabel(l.kind)}`,
      percent: l.percent,
      detail: l.resetsAt ? `↻ ${until(l.resetsAt, input.now)}` : '',
    })),
  ]
  const chrome = items.reduce((sum, m) => sum + meterChrome(m.label, m.detail), 0) + 3 * (items.length - 1)
  const cells = Math.max(4, Math.min(24, Math.floor((input.room - chrome) / items.length)))
  return (
    <Box flexDirection="row" flexWrap="wrap">
      {items.map((m, i) => (
        <Box flexDirection="row">
          {i > 0 && <Text dimColor>{' │ '}</Text>}
          {meter(input.canvas, m.label, m.percent, m.detail, cells)}
        </Box>
      ))}
    </Box>
  )
}

/** A one-line section: a bold label, then its parts. */
const lineOf = (input: BandInput, label: string, list: Part[]) => {
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

const ruled = (input: BandInput, title: string, note: string, body: RenderChildren) => {
  const { Box } = input.canvas.els
  return (
    <Box flexDirection="column">
      {rule(input.canvas.els, title, note, input.room)}
      {body}
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

const tokensSection = (input: BandInput): Section | null => {
  const { turn, totals, snap } = input
  const hasTurn = turn !== null && turn.tokens !== null && turn.at >= snap.startedAt
  const hasTotals = totals !== null && totals.since === snap.startedAt
  if (!hasTurn && !hasTotals) return null
  const idleMs = turn === null ? 0 : Math.max(0, input.now - turn.at)
  const isCold = hasTurn && !input.isWorking && idleMs >= input.cacheTtlMs
  const cache = hasTurn ? (isCold ? '🥶 cache cold' : '🧊 cache warm') : ''
  const rows: Record<string, Cell>[] = []
  if (hasTurn && turn.tokens !== null) {
    const note = input.isWorking ? elapsed(turn.durationMs) : `${elapsed(turn.durationMs)} · idle ${ago(idleMs)}`
    rows.push(tokenRow('turn', turn.tokens, { text: note, color: isCold ? 'warning' : undefined, dim: !isCold }))
  }
  if (hasTotals) rows.push(tokenRow('session', totals.tokens, { text: `${totals.turns} turn${totals.turns === 1 ? '' : 's'}`, dim: true }))
  return {
    fullRows: TABLE_CHROME + rows.length,
    full: () => ruled(input, '🔥 TOKENS', cache, table(input.canvas.els, TOKEN_COLUMNS, rows, input.room)),
    mini: () =>
      lineOf(input, '🔥 TOKENS', [
        ...(hasTurn && turn.tokens !== null ? tokenParts('turn', turn.tokens) : []),
        ...(hasTotals ? tokenParts('session', totals.tokens) : []),
        ...(cache === '' ? [] : [{ text: cache, color: isCold ? 'warning' : undefined }]),
      ]),
  }
}

/** Auto-compaction: where it triggers, how far away, and what the compactions so far did. */
const compactionSection = (input: BandInput): Section | null => {
  const { snap, compactions: c } = input
  const done = c !== null && c.since === snap.startedAt ? c : null
  if (snap.autoCompactAt === null && done === null) return null
  const list: Part[] = []
  if (snap.autoCompactAt !== null) {
    const at = Math.round((snap.autoCompactAt / snap.contextWindow) * 100)
    const left = snap.contextTokens === null ? null : snap.autoCompactAt - snap.contextTokens
    list.push({ text: `auto at ${at}% (${count(snap.autoCompactAt)})` })
    if (left !== null) list.push({ text: left > 0 ? `${count(left)} to go` : 'due now', color: left < snap.autoCompactAt * 0.1 ? 'warning' : 'text' })
  } else {
    list.push({ text: 'auto off', color: 'warning' })
  }
  if (done !== null) {
    list.push({ text: `${done.count}× this session`, emphasis: 'strong' })
    if (done.before !== null && done.after !== null) {
      const saved = done.before > 0 ? Math.round((1 - done.after / done.before) * 100) : 0
      list.push({ text: `last ${count(done.before)} → ${count(done.after)} (−${saved}%)` })
    }
    if (done.at !== null) list.push({ text: `${done.trigger ?? 'auto'} · ${ago(input.now - done.at)} ago` })
  }
  const line = () => lineOf(input, '🗜  COMPACT', list)
  return { fullRows: 1, full: line, mini: line }
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

const runNote = (running: number, all: number, hidden: number) =>
  `${running} running · ${all - running} done${hidden > 0 ? ` · +${hidden} in /vitals pane` : ''}`

const agentsSection = (input: BandInput, limit: number): Section | null => {
  const sorted = newestFirst(input.agents)
  const running = sorted.filter(a => isActive(a.status))
  const build = (n: number) => {
    const shown = sorted.slice(0, Math.max(running.length, n))
    const note = sorted.length === 0 ? 'no subagents yet' : runNote(running.length, sorted.length, sorted.length - shown.length)
    return ruled(input, '🤖 AGENTS', note, table(input.canvas.els, AGENT_COLUMNS, [mainRow(input), ...shown.map(a => agentRow(input, a))], input.room))
  }
  const rows = Math.min(sorted.length, limit)
  return {
    fullRows: TABLE_CHROME + 1 + Math.max(running.length, rows),
    full: () => build(rows),
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

const SHELL_COLUMNS: Column[] = [
  { title: ' ', width: 1 },
  { title: 'SHELL', width: 9, priority: 1 },
  { title: 'COMMAND', width: 16, grow: true },
  { title: 'BY', width: 12, priority: 0 },
  { title: 'STATUS', width: 9, priority: 2 },
  { title: 'TIME', width: 6, align: 'right' },
]

const shellsSection = (input: BandInput, limit: number): Section | null => {
  if (input.shells.length === 0) return null
  const sorted = newestFirst(input.shells)
  const running = sorted.filter(s => isActive(s.status))
  const by = (agentId: string | null) => {
    const agent = agentId === null ? undefined : input.agents.find(a => a.id === agentId)
    return agent ? shortType(agent.type) : 'main'
  }
  const rows = Math.min(sorted.length, limit)
  const shown = sorted.slice(0, Math.max(running.length, rows))
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
    fullRows: TABLE_CHROME + shown.length,
    full: () => ruled(input, '🐚 SHELLS', note, table(input.canvas.els, SHELL_COLUMNS, cells, input.room)),
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
const usageSection = (input: BandInput): Section | null => {
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
  const note = `${stale}ccusage · ${ago(input.now - history.at)} ago`
  return {
    fullRows: TABLE_CHROME + rows.length + 1,
    full: () =>
      ruled(
        input,
        '📊 USAGE',
        note,
        <Box flexDirection="column">
          {table(input.canvas.els, USAGE_COLUMNS, rows, input.room)}
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

/** What runs right now, and the session's most used tools. */
const liveSection = (input: BandInput): Section | null => {
  const agentName = (id: string | null) => {
    const agent = id === null ? undefined : input.agents.find(a => a.id === id)
    return agent ? ` ‹${shortType(agent.type)}›` : ''
  }
  const now: Part[] = input.live.map(t => {
    const ms = input.now - t.startedAt
    return { text: `${toolName(t.tool)}${ms >= 1000 ? ` ${elapsed(ms)}` : ''}${agentName(t.agentId)}`, color: 'text' }
  })
  const counts = input.tools?.since === input.snap.startedAt ? [...input.tools.counts].sort((a, b) => b.count - a.count) : []
  const top: Part[] = counts.slice(0, 8).map(c => ({ text: `${toolName(c.tool)} ${c.count}` }))
  if (counts.length > 8) top.push({ text: `+${counts.length - 8}` })
  if (now.length === 0 && top.length === 0) return null
  const nowLine = () => lineOf(input, `${statusMark('running', frame(input)).glyph} NOW`, now)
  const toolsLine = () => lineOf(input, '🔧 TOOLS', top)
  const { Box } = input.canvas.els
  return {
    fullRows: (now.length > 0 ? 1 : 0) + (top.length > 0 ? 1 : 0),
    full: () => (
      <Box flexDirection="column">
        {now.length > 0 && nowLine()}
        {top.length > 0 && toolsLine()}
      </Box>
    ),
    mini: () => (now.length > 0 ? nowLine() : toolsLine()),
  }
}

/** How soon a section gets rows when they are short: lower first. */
const RANK = { tokens: 0, agents: 1, live: 2, compaction: 3, usage: 4, shells: 5 }

type Placed = { section: Section | null; rank: number }

/**
 * Lays sections out in the rows there are, never scrolling. In rank order, every section gets
 * one line (and a blank one before it) first, then grows to full while it fits; a section that
 * does not get even its line is left out. They are drawn in the order given, whatever their rank.
 */
const layout = (input: BandInput, placed: Placed[], budget: number) => {
  const { Box } = input.canvas.els
  const present = placed.filter((p): p is { section: Section; rank: number } => p.section !== null)
  const byRank = [...present].sort((a, b) => a.rank - b.rank)
  const kept = new Set<Section>()
  let used = 0
  for (const p of byRank) {
    const need = kept.size === 0 ? 1 : 2
    if (used + need > budget) break
    kept.add(p.section)
    used += need
  }
  let left = budget - used
  const isFull = new Set<Section>()
  for (const p of byRank) {
    const extra = p.section.fullRows - 1
    if (!kept.has(p.section) || extra > left) continue
    isFull.add(p.section)
    left -= extra
  }
  const shown = present.filter(p => kept.has(p.section))
  return (
    <Box flexDirection="column">
      {shown.map((p, i) => {
        const body = isFull.has(p.section) ? p.section.full() : p.section.mini()
        return i === 0 ? body : <Box marginTop={1}>{body}</Box>
      })}
    </Box>
  )
}

/** A terminal this wide splits the sections in two columns: numbers left, work and agents right. */
const TWO_COLUMNS_FROM = 150
const COLUMN_GAP = 4

/** The framed dashboard, its sections sized to the rows the band has. */
export const drawBand = (input: BandInput, maxBandRows: number) => {
  const { Box } = input.canvas.els
  const inner = { ...input, room: input.room - FRAME_CELLS }
  // The frame, the header, the meters and the blank line under them.
  const budget = Math.min(input.rows, maxBandRows) - FRAME_ROWS - 3
  const frame = (body: RenderChildren) => (
    <Box flexDirection="column" borderStyle="round" borderColor={ACCENT} paddingX={1}>
      {header(inner)}
      {meters(inner)}
      <Box marginTop={1}>{body}</Box>
    </Box>
  )
  // Table sections ask for as many rows as they could show; the layout trims the rest.
  const numbers = (at: BandInput): Placed[] => [
    { section: tokensSection(at), rank: RANK.tokens },
    { section: compactionSection(at), rank: RANK.compaction },
    { section: usageSection(at), rank: RANK.usage },
  ]
  const work = (at: BandInput, rows: number): Placed[] => [
    { section: liveSection(at), rank: RANK.live },
    { section: shellsSection(at, Math.max(1, rows - 10)), rank: RANK.shells },
    { section: agentsSection(at, Math.max(1, rows - 8)), rank: RANK.agents },
  ]
  if (inner.room < TWO_COLUMNS_FROM) return frame(layout(inner, [...numbers(inner), ...work(inner, budget - 10)], budget))

  const leftRoom = Math.floor((inner.room - COLUMN_GAP) / 2)
  const left = { ...inner, room: leftRoom }
  const right = { ...inner, room: inner.room - COLUMN_GAP - leftRoom }
  return frame(
    <Box flexDirection="row" columnGap={COLUMN_GAP}>
      <Box width={left.room} flexShrink={0}>
        {layout(left, numbers(left), budget)}
      </Box>
      <Box width={right.room} flexShrink={0} flexDirection="column" justifyContent="flex-end">
        {layout(right, work(right, budget), budget)}
      </Box>
    </Box>,
  )
}

/** Every section in full, for the pane, which scrolls. */
export const drawAll = (input: BandInput) => {
  const { Box } = input.canvas.els
  const inner = { ...input, room: input.room - FRAME_CELLS }
  const sections = [
    tokensSection(inner),
    compactionSection(inner),
    usageSection(inner),
    liveSection(inner),
    shellsSection(inner, 40),
    agentsSection(inner, 40),
  ].filter((s): s is Section => s !== null)
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={ACCENT} paddingX={1}>
      {header(inner)}
      {meters(inner)}
      {sections.map(s => (
        <Box marginTop={1}>{s.full()}</Box>
      ))}
    </Box>
  )
}

// One line for small windows: model, effort, context, limits, cache hit, cost, week, what runs.
export const drawCompact = (input: BandInput) => {
  const { snap, turn } = input
  const hit = turn?.tokens ? hitRate(turn.tokens) : null
  const runningAgents = input.agents.filter(a => isActive(a.status)).length
  const runningShells = input.shells.filter(s => isActive(s.status)).length
  const level = effortCell(input.effort)
  const week = input.history === null ? undefined : periods(input.history.days, localDate(input.now))[1]
  const warnIf = (percent: number) => (tone(percent) === undefined ? undefined : ('warning' as const))
  const list: Part[] = [
    { text: `🧠 ${prettyModel(snap.model)}`, emphasis: 'strong' },
    ...(input.effort === null ? [] : [{ text: `⚡ ${input.effort}`, color: level.color }]),
    ...(snap.contextPercent === null ? [] : [{ text: `⛽ ${snap.contextPercent}%`, emphasis: warnIf(snap.contextPercent) }]),
    ...snap.limits.map(l => ({ text: `${LIMIT_ICONS[l.kind] ?? '⏳'} ${l.percent}%`, emphasis: warnIf(l.percent) })),
    ...(hit === null ? [] : [{ text: `🧊 ${hit}%`, emphasis: hit < 50 ? ('warning' as const) : undefined }]),
    ...(snap.costUsd === null ? [] : [{ text: `💸 ${money(snap.costUsd)}`, emphasis: 'strong' as const }]),
    ...(week === undefined ? [] : [{ text: `📊 week ${money(week.now.costUsd)}` }]),
    ...(runningAgents === 0 ? [] : [{ text: `${statusMark('running', frame(input)).glyph} 🤖 ${runningAgents}`, color: ACCENT }]),
    ...(runningShells === 0 ? [] : [{ text: `🐚 ${runningShells}`, color: ACCENT }]),
  ]
  return parts(input.canvas.els, list)
}
