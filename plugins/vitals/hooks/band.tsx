import type { RenderChildren } from 'claude-code'

import type { View } from '../types'

import { ago, count, effortPips, limitShortLabel, money, prettyModel, until } from './format'
import type { Part } from './format'
import type { Forecast } from './forecast'
import { agentsSection, contextSection, effortCell, shellsSection, tokensSection, toolsSection, usageSection } from './sections'
import type { BandInput, Section } from './sections'
import { ACCENT, CARD_CELLS, meter, meterChrome, parts } from './ui'

export type { BandInput } from './sections'

const LIMIT_ICONS: Record<string, string> = { five_hour: '⏳', seven_day: '📅' }
const LIMIT_LABELS: Record<string, string> = { five_hour: '5H LIMIT', seven_day: 'WEEKLY' }

/** A meter's bar never gets narrower than this; below it the meters go two to a row. */
const MIN_BAR = 8
const MAX_BAR = 24
const METER_GAP = 3

/** How soon a section gets rows when they are short: lower first. */
const RANK = { tokens: 0, agents: 1, tools: 2, context: 3, usage: 4, shells: 5 }

/** A terminal this wide splits the sections in two columns: numbers left, agents and work right. */
const TWO_COLUMNS_FROM = 150
const COLUMN_GAP = 2

type Item = { label: string; percent: number | null; detail: string }

/** Context, the road to auto-compaction, and the plan limits: every one a bar. */
const meterItems = (input: BandInput): Item[] => {
  const { snap, compactions: c } = input
  const done = c !== null && c.since === snap.startedAt ? c.count : 0
  const compactAt = snap.autoCompactAt
  const toCompact =
    compactAt === null || snap.contextTokens === null
      ? null
      : { percent: Math.min(100, Math.round((snap.contextTokens / compactAt) * 100)), left: compactAt - snap.contextTokens }
  const compactDetail =
    compactAt === null ? 'auto off' : toCompact === null ? `at ${count(compactAt)}` : toCompact.left > 0 ? `${count(toCompact.left)} to go` : 'due'
  return [
    {
      label: '⛽ CTX',
      percent: snap.contextPercent,
      detail: snap.contextTokens === null ? '' : `${count(snap.contextTokens)}/${count(snap.contextWindow)}`,
    },
    { label: '🗜 COMPACT', percent: toCompact?.percent ?? null, detail: `${compactDetail}${done > 0 ? ` · ×${done}` : ''}` },
    ...snap.limits.map(l => ({
      label: `${LIMIT_ICONS[l.kind] ?? '⏳'} ${LIMIT_LABELS[l.kind] ?? limitShortLabel(l.kind)}`,
      percent: l.percent,
      detail: l.resetsAt ? `↻ ${until(l.resetsAt, input.now)}` : '',
    })),
  ]
}

/** The meters in as few rows as keep every bar at least MIN_BAR wide: all in one, or two a row. */
const meterRows = (items: Item[], room: number) => {
  const fit = (perRow: number) => {
    const rows = Array.from({ length: Math.ceil(items.length / perRow) }, (_, i) => items.slice(i * perRow, (i + 1) * perRow))
    const widest = Math.max(...rows.map(r => r.reduce((s, m) => s + meterChrome(m.label, m.detail), 0) + METER_GAP * (r.length - 1)))
    return { rows, bar: Math.max(4, Math.min(MAX_BAR, Math.floor((room - widest) / perRow))) }
  }
  const all = fit(items.length)
  return all.bar >= MIN_BAR || items.length <= 2 ? all : fit(2)
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** A moment as a glance reads it: `14:05` today, `Thu 14:05` further off. */
const clockTime = (ms: number, now: number) => {
  const d = new Date(ms)
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return ms - now < 20 * 3_600_000 && d.getDate() === new Date(now).getDate() ? hhmm : `${WEEKDAYS[d.getDay()] ?? ''} ${hhmm}`
}

/** Each limit at this pace: when it runs out before its reset, or where it stands at the reset. */
const forecastParts = (forecasts: Forecast[], now: number): Part[] =>
  forecasts.map(f => {
    const name = LIMIT_LABELS[f.kind] ?? limitShortLabel(f.kind)
    const pace = f.pace === 'recent' ? 'last hour' : 'window avg'
    return f.outAt === null
      ? { text: `${name} ≈ ${f.atReset}% at reset ✓ (${pace})`, color: f.atReset >= 80 ? 'warning' : 'success' }
      : { text: `${name} out at ${clockTime(f.outAt, now)}, reset ${clockTime(f.resetAt, now)} ⚠ (${pace})`, emphasis: 'warning' as const }
  })

/** The top box: model, effort, where, session, cost; then the meters. */
const vitals = (input: BandInput, room: number) => {
  const { Box, Text } = input.canvas.els
  const { snap } = input
  const where =
    `📁 ${snap.dir}` +
    (snap.branch === null ? '' : `  🌿 ${snap.branch}${snap.isWorktree ? ' 🌳' : ''}`) +
    `${snap.ahead ? ` ↑${snap.ahead}` : ''}${snap.behind ? ` ↓${snap.behind}` : ''}${snap.changed ? ` ●${snap.changed}` : ''}`
  const ageMs = input.now - snap.startedAt
  const burn = snap.costUsd !== null && ageMs >= 5 * 60_000 ? `  🔥 ${money(snap.costUsd / (ageMs / 3_600_000))}/h` : ''
  const level = effortCell(input.effort)
  const { rows, bar } = meterRows(meterItems(input), room - CARD_CELLS)
  const ahead = forecastParts(input.forecasts, input.now)
  return {
    rows: 2 + 1 + rows.length + (ahead.length > 0 ? 1 : 0),
    box: (
      <Box flexDirection="column" width={room} borderStyle="round" borderColor={ACCENT} paddingX={1}>
        <Box flexDirection="row" justifyContent="space-between">
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
        {rows.map(row => (
          <Box flexDirection="row">
            {row.map((m, i) => (
              <Box flexDirection="row">
                {i > 0 && <Text dimColor>{' │ '}</Text>}
                {meter(input.canvas, m.label, m.percent, m.detail, bar)}
              </Box>
            ))}
          </Box>
        ))}
        {ahead.length > 0 && (
          <Box flexDirection="row">
            <Box width={13} flexShrink={0}>
              <Text bold color={ACCENT}>{'🔮 FORECAST'}</Text>
            </Box>
            {parts(input.canvas.els, ahead)}
          </Box>
        )}
      </Box>
    ),
  }
}

type Placed = { section: Section | null; rank: number }

/**
 * Lays sections out in the rows there are, never scrolling. In rank order, every section gets
 * one line first, then grows to its box while it fits; a section that does not get even its line
 * is left out. They are drawn in the order given, whatever their rank.
 */
const layout = (input: BandInput, placed: Placed[], budget: number) => {
  const { Box } = input.canvas.els
  const present = placed.filter((p): p is { section: Section; rank: number } => p.section !== null)
  const byRank = [...present].sort((a, b) => a.rank - b.rank)
  const kept = new Set<Section>(byRank.slice(0, Math.max(0, budget)).map(p => p.section))
  let left = budget - kept.size
  const isFull = new Set<Section>()
  for (const p of byRank) {
    const extra = p.section.fullRows - 1
    if (!kept.has(p.section) || extra > left) continue
    isFull.add(p.section)
    left -= extra
  }
  return (
    <Box flexDirection="column">
      {present.filter(p => kept.has(p.section)).map(p => (isFull.has(p.section) ? p.section.full() : p.section.mini()))}
    </Box>
  )
}

/** The numbers: tokens, what fills the context, and usage. */
const numbers = (input: BandInput, room: number): Placed[] => [
  { section: tokensSection(input, room), rank: RANK.tokens },
  { section: contextSection(input, room), rank: RANK.context },
  { section: usageSection(input, room), rank: RANK.usage },
]

/** The work: agents on top, then the tools and the shells; tables ask for what they could show. */
const work = (input: BandInput, room: number, rows: number): Placed[] => [
  { section: agentsSection(input, room, Math.max(1, rows - 12)), rank: RANK.agents },
  { section: toolsSection(input, room, Math.max(1, Math.min(8, rows - 12))), rank: RANK.tools },
  { section: shellsSection(input, room, Math.max(1, rows - 16)), rank: RANK.shells },
]

/** The dashboard: the vitals box on top, then the section boxes, sized to the rows the band has. */
export const drawBand = (input: BandInput, maxBandRows: number) => {
  const { Box } = input.canvas.els
  const top = vitals(input, input.room)
  const budget = Math.min(input.rows, maxBandRows) - top.rows
  let body: RenderChildren
  if (input.room < TWO_COLUMNS_FROM) {
    const [tokens, context, usage] = numbers(input, input.room)
    const none = { section: null, rank: 0 }
    body = layout(input, [tokens ?? none, ...work(input, input.room, budget - 10), context ?? none, usage ?? none], budget)
  } else {
    const leftRoom = Math.floor((input.room - COLUMN_GAP) / 2)
    const rightRoom = input.room - COLUMN_GAP - leftRoom
    body = (
      <Box flexDirection="row" columnGap={COLUMN_GAP}>
        <Box width={leftRoom} flexShrink={0}>
          {layout(input, numbers(input, leftRoom), budget)}
        </Box>
        <Box width={rightRoom} flexShrink={0}>
          {layout(input, work(input, rightRoom, budget), budget)}
        </Box>
      </Box>
    )
  }
  return (
    <Box flexDirection="column">
      {top.box}
      {body}
    </Box>
  )
}

/** Every section in its box, for the pane, which scrolls. */
export const drawAll = (input: BandInput) => {
  const { Box } = input.canvas.els
  const sections = [
    tokensSection(input, input.room),
    contextSection(input, input.room),
    agentsSection(input, input.room, 40),
    toolsSection(input, input.room, 40),
    shellsSection(input, input.room, 40),
    usageSection(input, input.room),
  ]
  return (
    <Box flexDirection="column">
      {vitals(input, input.room).box}
      {sections.map(s => (s === null ? null : s.full()))}
    </Box>
  )
}

/** The medium dashboard: the vitals box, what fills the context, and the agents. */
const drawMedium = (input: BandInput, maxBandRows: number) => {
  const { Box } = input.canvas.els
  const top = vitals(input, input.room)
  const budget = Math.min(input.rows, maxBandRows) - top.rows
  const placed = (contextRoom: number, agentsRoom: number) => ({
    context: { section: contextSection(input, contextRoom), rank: 1 },
    agents: { section: agentsSection(input, agentsRoom, Math.max(1, budget - 6)), rank: 0 },
  })
  let body: RenderChildren
  if (input.room < TWO_COLUMNS_FROM) {
    const { context, agents } = placed(input.room, input.room)
    body = layout(input, [context, agents], budget)
  } else {
    const leftRoom = Math.floor((input.room - COLUMN_GAP) / 2)
    const rightRoom = input.room - COLUMN_GAP - leftRoom
    const { context, agents } = placed(leftRoom, rightRoom)
    body = (
      <Box flexDirection="row" columnGap={COLUMN_GAP}>
        <Box width={leftRoom} flexShrink={0}>
          {layout(input, [context], budget)}
        </Box>
        <Box width={rightRoom} flexShrink={0}>
          {layout(input, [agents], budget)}
        </Box>
      </Box>
    )
  }
  return (
    <Box flexDirection="column">
      {top.box}
      {body}
    </Box>
  )
}

/** The band at its detail level: low the vitals box alone, medium with context and agents, high everything. */
export const drawLevel = (input: BandInput, level: View, maxBandRows: number) =>
  level === 'low' ? vitals(input, input.room).box : level === 'medium' ? drawMedium(input, maxBandRows) : drawBand(input, maxBandRows)
