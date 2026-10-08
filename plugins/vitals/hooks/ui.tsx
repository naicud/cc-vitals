import type { Elements, RenderSurface } from 'claude-code'

import { tone } from './format'
import type { Part } from './format'

// The band is raised on the terminal and the desktop only; every surface's table has Box and Text.
export type Els = Elements[RenderSurface]

export type Cell = { text: string; color?: string; dim?: boolean; bold?: boolean }

/**
 * A table column: `width` in cells (the least, for the one that `grow`s), `priority` the order
 * columns give way in when the band is narrow (lowest first; absent never gives way).
 */
export type Column = { title: string; width: number; align?: 'left' | 'right'; grow?: boolean; priority?: number }

export const ACCENT = 'claude'
const BAR_FILL = 'suggestion'

/** Drops the lowest-priority columns until the table fits `room` cells. */
export const fitColumns = (columns: Column[], room: number) => {
  let kept = columns
  const width = (cs: Column[]) => cs.reduce((sum, c) => sum + c.width, 0)
  while (width(kept) > room) {
    const droppable = kept.filter(c => c.priority !== undefined)
    if (droppable.length === 0) break
    const lowest = droppable.reduce((a, b) => ((a.priority ?? 0) <= (b.priority ?? 0) ? a : b))
    kept = kept.filter(c => c !== lowest)
  }
  return kept
}

const cellBox = (els: Els, column: Column, cell: Cell) => {
  const { Box, Text } = els
  return (
    <Box
      width={column.grow ? undefined : column.width}
      minWidth={column.grow ? column.width : undefined}
      flexGrow={column.grow ? 1 : 0}
      flexShrink={column.grow ? 1 : 0}
      justifyContent={column.align === 'right' ? 'flex-end' : 'flex-start'}
      paddingRight={1}
    >
      <Text wrap="truncate-end" color={cell.color} dimColor={cell.dim} bold={cell.bold}>
        {cell.text}
      </Text>
    </Box>
  )
}

/** A table whose cells are keyed by column title, so a dropped column drops its cells too. */
export const table = (els: Els, columns: Column[], rows: Record<string, Cell>[], room: number) => {
  const { Box } = els
  const kept = fitColumns(columns, room)
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">{kept.map(c => cellBox(els, c, { text: c.title, dim: true, bold: true }))}</Box>
      {rows.map(row => (
        <Box flexDirection="row">{kept.map(c => cellBox(els, c, row[c.title] ?? { text: '' }))}</Box>
      ))}
    </Box>
  )
}

/** A section's title row: the name in the accent colour, a dim note after it. */
export const heading = (els: Els, name: string, note: string) => {
  const { Box, Text } = els
  return (
    <Box flexDirection="row" marginTop={1}>
      <Text bold color={ACCENT}>{`▍${name}`}</Text>
      {note !== '' && <Text dimColor>{`  ${note}`}</Text>}
    </Box>
  )
}

/** Parts joined by dim middots; a warning part in the warning colour, a strong one bold. */
export const parts = (els: Els, list: Part[]) => {
  const { Box, Text } = els
  return (
    <Box flexDirection="row" flexWrap="wrap">
      {list.map((p, i) => (
        <Box flexDirection="row">
          {i > 0 && <Text dimColor>{' · '}</Text>}
          <Text
            color={p.emphasis === 'warning' ? 'warning' : p.color}
            bold={p.emphasis === 'strong'}
            dimColor={p.emphasis === undefined && p.color === undefined}
          >
            {p.text}
          </Text>
        </Box>
      ))}
    </Box>
  )
}

// Drawn as an image on the desktop, so it cannot follow the theme: a translucent track reads on both.
const svgBar = (percent: number, width: number) => {
  const fill = percent >= 95 ? '#e5484d' : percent >= 80 ? '#e0a030' : '#2f7de1'
  const filled = Math.round((Math.min(percent, 100) / 100) * width)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="8" viewBox="0 0 ${width} 8">` +
    `<rect width="${width}" height="8" rx="4" fill="#808080" fill-opacity="0.3"/>` +
    `<rect width="${filled}" height="8" rx="4" fill="${fill}"/></svg>`
  )
}

/** A bar `cells` wide: block characters in the terminal, an SVG bar (15px a cell) on the desktop. */
export const gauge = (els: Els, name: string, percent: number, cells: number) => {
  const { Box, Text } = els
  if ('Svg' in els) {
    const { Svg } = els
    const px = cells * 9
    return <Svg source={svgBar(percent, px)} alt={`${name} ${percent}% used`} width={px} height={8} />
  }
  const filled = Math.round((Math.min(percent, 100) / 100) * cells)
  return (
    <Box flexDirection="row">
      {filled > 0 && <Text color={tone(percent) ?? BAR_FILL}>{'█'.repeat(filled)}</Text>}
      {filled < cells && <Text dimColor>{'░'.repeat(cells - filled)}</Text>}
    </Box>
  )
}

/** `CTX ██████░░░░  68%  680k/1M`: a label, a bar, the percentage and a dim detail. */
export const meter = (els: Els, label: string, percent: number | null, detail: string, cells: number) => {
  const { Box, Text } = els
  return (
    <Box flexDirection="row" alignItems="center" flexShrink={0}>
      <Box width={4} flexShrink={0}>
        <Text bold>{label}</Text>
      </Box>
      {percent === null ? (
        <Text dimColor>{'—'}</Text>
      ) : (
        <Box flexDirection="row" alignItems="center">
          {gauge(els, label, percent, cells)}
          <Box width={5} justifyContent="flex-end">
            <Text bold color={tone(percent)}>{`${percent}%`}</Text>
          </Box>
        </Box>
      )}
      {detail !== '' && (
        <Box marginLeft={1}>
          <Text dimColor>{detail}</Text>
        </Box>
      )}
    </Box>
  )
}
