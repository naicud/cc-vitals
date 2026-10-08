import type { Elements, RenderSurface } from 'claude-code'

import type { Compactions, Limit, Snapshot, Totals, TurnStat } from '../types'
import {
  ago,
  count,
  elapsed,
  hitRate,
  limitLabel,
  limitShortLabel,
  prettyModel,
  tokenParts,
  tone,
  until,
} from './format'
import type { Part } from './format'

// The band is raised on the terminal and the desktop only; every surface's table has Box and Text.
type Els = Elements[RenderSurface]

export type BandInput = {
  els: Els
  bodyColumns: number
  isWorking: boolean
  snap: Snapshot
  turn: TurnStat | null
  totals: Totals | null
  compactions: Compactions | null
  effort: string | null
  cacheTtlMs: number
}

// How wide things draw. Desktop bars are SVG in CSS px, measured from screenshots of the band:
// a Box `width` cell, one column of `bodyColumns` and an average glyph of its proportional font,
// with 5% spare for the estimate. The terminal counts everything in cells.
type Metrics = { cell: number; col: number; char: number; spare: number; minBar: number; maxBar: number; floorBar: number }
const DESKTOP: Metrics = { cell: 15, col: 12.5, char: 13, spare: 0.95, minBar: 60, maxBar: 180, floorBar: 40 }
const TERMINAL: Metrics = { cell: 1, col: 1, char: 1, spare: 1, minBar: 10, maxBar: 24, floorBar: 6 }

const LABEL_CELLS = 8
const PERCENT_CELLS = 5
const DETAIL_GAP = 2
const METER_GAP = 3
const AGENT_ROWS = 3

// Drawn as an image, so it cannot follow the theme: a translucent track reads on light and dark.
const svgBar = (percent: number, width: number) => {
  const fill = percent >= 95 ? '#e5484d' : percent >= 80 ? '#e0a030' : '#2f7de1'
  const filled = Math.round((Math.min(percent, 100) / 100) * width)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="8" viewBox="0 0 ${width} 8">` +
    `<rect width="${width}" height="8" rx="4" fill="#808080" fill-opacity="0.3"/>` +
    `<rect width="${filled}" height="8" rx="4" fill="${fill}"/></svg>`
  )
}

const gauge = (els: Els, name: string, percent: number, size: number) => {
  const { Box, Text } = els
  if ('Svg' in els) {
    const { Svg } = els
    return <Svg source={svgBar(percent, size)} alt={`${name} ${percent}% used`} width={size} height={8} />
  }
  const filled = Math.round((Math.min(percent, 100) / 100) * size)
  return (
    <Box flexDirection="row">
      {filled > 0 && <Text color={tone(percent) ?? 'suggestion'}>{'█'.repeat(filled)}</Text>}
      {filled < size && <Text dimColor>{'░'.repeat(size - filled)}</Text>}
    </Box>
  )
}

const meter = (els: Els, name: string, percent: number | null, detail: string, size: number) => {
  const { Box, Text } = els
  return (
    <Box flexDirection="row" alignItems="center">
      <Box width={LABEL_CELLS} flexShrink={0}>
        <Text>{name}</Text>
      </Box>
      {percent === null ? (
        <Text dimColor>{'waiting for first response'}</Text>
      ) : (
        <Box flexDirection="row" alignItems="center" flexShrink={0}>
          {gauge(els, name, percent, size)}
          <Box width={PERCENT_CELLS} justifyContent="flex-end">
            <Text color={tone(percent)}>{`${percent}%`}</Text>
          </Box>
        </Box>
      )}
      {detail !== '' && (
        <Box marginLeft={DETAIL_GAP} flexShrink={0}>
          <Text dimColor>{detail}</Text>
        </Box>
      )}
    </Box>
  )
}

const line = (els: Els, label: string | null, parts: Part[]) => {
  const { Box, Text } = els
  return (
    <Box flexDirection="row" flexWrap="wrap">
      {label !== null && (
        <Box width={LABEL_CELLS} flexShrink={0}>
          <Text>{label}</Text>
        </Box>
      )}
      {parts.map((p, i) => (
        <Box flexDirection="row">
          {i > 0 && <Text dimColor>{' · '}</Text>}
          <Text
            color={p.emphasis === 'warning' ? 'warning' : undefined}
            bold={p.emphasis === 'strong'}
            dimColor={p.emphasis === undefined}
          >
            {p.text}
          </Text>
        </Box>
      ))}
    </Box>
  )
}

// Fit the limit meters on one row: try "resets in 2h 8m", then "↻ 2h 8m", and stack them only
// when even the short form leaves a bar under the surface's minimum.
const fitLimits = (m: Metrics, bodyColumns: number, limits: Limit[], now: number) => {
  const avail = bodyColumns * m.col * m.spare
  const fixed = (LABEL_CELLS + PERCENT_CELLS + DETAIL_GAP) * m.cell
  const n = Math.max(1, limits.length)
  const fit = (isLong: boolean) => {
    const details = limits.map(l => (l.resetsAt ? `${isLong ? 'resets in ' : '↻ '}${until(l.resetsAt, now)}` : ''))
    const text = details.reduce((sum, d) => sum + d.length * m.char, 0)
    const bar = Math.floor((avail - n * fixed - (n - 1) * METER_GAP * m.cell - text) / n)
    return { details, bar: Math.min(m.maxBar, bar) }
  }
  const long = fit(true)
  const { details, bar: shared } = long.bar >= m.minBar ? long : fit(false)
  const isStacked = shared < m.minBar
  const longest = Math.max(0, ...details.map(d => d.length * m.char))
  const bar = isStacked ? Math.max(m.floorBar, Math.min(m.maxBar, Math.floor(avail - fixed - longest))) : shared
  return { avail, fixed, details, bar, isStacked }
}

const modelParts = (input: BandInput): Part[] => [
  { text: `◆ ${prettyModel(input.turn?.model ?? input.snap.model)}`, emphasis: 'strong' },
  ...(input.effort === null ? [] : [{ text: `effort ${input.effort}`, emphasis: 'strong' as const }]),
]

const turnParts = (input: BandInput): Part[] => {
  const { turn, snap } = input
  if (turn === null || turn.at < snap.startedAt) return []
  const idleMs = Math.max(0, snap.at - turn.at)
  const isCold = idleMs >= input.cacheTtlMs
  return [
    { text: elapsed(turn.durationMs) },
    ...(turn.tokens === null ? [] : tokenParts(turn.tokens)),
    ...(input.isWorking
      ? []
      : [{ text: `idle ${ago(idleMs)}${isCold ? ' (cache cold)' : ''}`, emphasis: isCold ? ('warning' as const) : undefined }]),
  ]
}

const sessionParts = (input: BandInput): Part[] => {
  const { totals, compactions: c, snap } = input
  const parts: Part[] = []
  if (totals !== null && totals.since === snap.startedAt) {
    parts.push(...tokenParts(totals.tokens), { text: `${totals.turns} turn${totals.turns === 1 ? '' : 's'}` })
  }
  if (c !== null && c.since === snap.startedAt) {
    const sizes = c.before === null || c.after === null ? '' : ` (last ${count(c.before)} → ${count(c.after)})`
    parts.push({ text: `compacted ${c.count}×${sizes}` })
  }
  return parts
}

export const drawBand = (input: BandInput) => {
  const { els, snap } = input
  const { Box, Text } = els
  const m = 'Svg' in els ? DESKTOP : TERMINAL
  const limits = fitLimits(m, input.bodyColumns, snap.limits, snap.at)
  const used = snap.contextTokens === null ? '' : `${count(snap.contextTokens)} / ${count(snap.contextWindow)}`
  const contextRoom = Math.floor(limits.avail - limits.fixed - used.length * m.char)
  const contextBar = Math.max(m.floorBar, Math.min(limits.isStacked ? limits.bar : 2 * limits.bar, contextRoom))

  const where =
    `📁 ${snap.dir}` +
    (snap.branch === null ? '' : `   🌿 ${snap.branch}${snap.isWorktree ? ' 🌳' : ''}`) +
    `${snap.ahead ? ` ↑${snap.ahead}` : ''}${snap.behind ? ` ↓${snap.behind}` : ''}` +
    `${snap.changed ? `   ● ${snap.changed} changed` : ''}`
  const session =
    `session ${ago(snap.at - snap.startedAt)} · ${snap.prompts} prompt${snap.prompts === 1 ? '' : 's'}` +
    (snap.costUsd === null ? '' : ` · $${snap.costUsd.toFixed(2)}`)
  const turn = turnParts(input)
  const totals = sessionParts(input)
  // Running agents get rows of their own (description truncated, type kept).
  const agentRows = snap.agents.slice(0, AGENT_ROWS)
  const moreAgents = snap.agents.length - agentRows.length

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between" width="100%">
        <Text wrap="truncate-end">{where}</Text>
        <Box marginLeft={2} flexShrink={0}>
          <Text dimColor>{session}</Text>
        </Box>
      </Box>
      <Box flexDirection="row" justifyContent="space-between" width="100%">
        {meter(els, 'Context', snap.contextPercent, used, contextBar)}
        <Box marginLeft={2} flexShrink={0}>
          {line(els, null, modelParts(input))}
        </Box>
      </Box>
      {snap.limits.length > 0 && (
        <Box flexDirection={limits.isStacked ? 'column' : 'row'} columnGap={METER_GAP}>
          {snap.limits.map((l, i) => meter(els, limitLabel(l.kind), l.percent, limits.details[i] ?? '', limits.bar))}
        </Box>
      )}
      {turn.length > 0 && line(els, 'Turn', turn)}
      {totals.length > 0 && line(els, 'Session', totals)}
      {agentRows.map(a => (
        <Box flexDirection="row" justifyContent="space-between" width="100%">
          <Text wrap="truncate-end">{`⏳ ${a.description || a.type}`}</Text>
          <Box marginLeft={2} flexShrink={0}>
            <Text dimColor>{a.type.split(':').pop()}</Text>
          </Box>
        </Box>
      ))}
      {moreAgents > 0 && <Text dimColor>{`   +${moreAgents} more agent${moreAgents > 1 ? 's' : ''} running`}</Text>}
    </Box>
  )
}

// One line for small windows: model, effort, context, limits, last-turn cache hit, cost, agents.
export const drawCompact = (input: BandInput) => {
  const { snap, turn } = input
  const hit = turn?.tokens ? hitRate(turn.tokens) : null
  const parts: Part[] = [
    ...modelParts(input),
    ...(snap.contextPercent === null
      ? []
      : [{ text: `ctx ${snap.contextPercent}%`, emphasis: tone(snap.contextPercent) === undefined ? undefined : ('warning' as const) }]),
    ...snap.limits.map(l => ({
      text: `${limitShortLabel(l.kind)} ${l.percent}%`,
      emphasis: tone(l.percent) === undefined ? undefined : ('warning' as const),
    })),
    ...(hit === null ? [] : [{ text: `hit ${hit}%`, emphasis: hit < 50 ? ('warning' as const) : undefined }]),
    ...(snap.costUsd === null ? [] : [{ text: `$${snap.costUsd.toFixed(2)}` }]),
    ...(snap.agents.length === 0 ? [] : [{ text: `⏳ ${snap.agents.length}` }]),
  ]
  return line(input.els, null, parts)
}
