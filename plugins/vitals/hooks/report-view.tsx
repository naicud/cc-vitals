import type { HistoryProblem, UsageHistory } from '../types'
import { ago, count, delta, money, prettyModel } from './format'
import { REPORT_WEEKS, addDays, change, localDate, modelShares, monthSpans, periods, weekSpans } from './report'
import { ACCENT, blocks, rule, table } from './ui'
import type { Canvas, Cell, Column } from './ui'

const FRAME_CELLS = 4
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const weekday = (date: string) => {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number)
  return WEEKDAYS[new Date(y, m - 1, d, 12).getDay()] ?? ''
}

/** A cost bar against the period's largest, as a cell of the BAR column. */
const barCell = (value: number, top: number, cells: number): Cell => ({ text: blocks(top > 0 ? (value / top) * 100 : 0, cells).filled, color: ACCENT })

const deltaCell = (now: number, before: number | undefined): Cell => {
  const pct = before === undefined ? null : change(now, before)
  return pct === null ? { text: '—', dim: true } : { text: delta(pct), color: pct > 0 ? 'warning' : 'success' }
}

const DAY_COLUMNS: Column[] = [
  { title: 'DAY', width: 14 },
  { title: 'COST', width: 7, align: 'right' },
  { title: 'TOKENS', width: 6, align: 'right' },
  { title: 'TOP MODEL', width: 12, priority: 1 },
  { title: 'BAR', width: 10, grow: true },
]

const PERIOD_COLUMNS: Column[] = [
  { title: 'PERIOD', width: 17 },
  { title: 'COST', width: 7, align: 'right' },
  { title: 'TOKENS', width: 6, align: 'right' },
  { title: 'VS BEFORE', width: 9, align: 'right', priority: 1 },
  { title: 'BAR', width: 10, grow: true },
]

const MODEL_COLUMNS: Column[] = [
  { title: 'MODEL', width: 14 },
  { title: 'COST', width: 7, align: 'right' },
  { title: 'TOKENS', width: 6, align: 'right' },
  { title: 'SHARE', width: 5, align: 'right' },
  { title: 'BAR', width: 10, grow: true },
]

/** The usage report: the last 14 days, the last 6 weeks, this month and the last, and the models. */
export const drawReport = (canvas: Canvas, room: number, now: number, history: UsageHistory | null, problem: HistoryProblem | null) => {
  const { Box, Text } = canvas.els
  const inner = room - FRAME_CELLS
  if (history === null) {
    return <Text dimColor>{problem === null ? 'Reading usage history…' : `No usage history: ${problem.reason}`}</Text>
  }
  const today = localDate(now)
  const barCells = Math.max(6, inner - 14 - 7 - 6 - 12 - 3 * 4)
  const byDate = new Map(history.days.map(d => [d.date, d]))
  const dates = Array.from({ length: 14 }, (_, i) => addDays(today, -i))
  const dayTop = Math.max(0, ...dates.map(d => byDate.get(d)?.costUsd ?? 0))
  const dayRows = dates.map((date): Record<string, Cell> => {
    const day = byDate.get(date)
    const top = day?.models.slice().sort((a, b) => b.costUsd - a.costUsd)[0]
    return {
      DAY: { text: `${weekday(date)} ${date.slice(5)}${date === today ? ' ◀' : ''}`, bold: date === today },
      COST: { text: money(day?.costUsd ?? 0), dim: day === undefined },
      TOKENS: { text: count(day?.tokens ?? 0), dim: true },
      'TOP MODEL': { text: top ? prettyModel(top.model) : '—', dim: true },
      BAR: barCell(day?.costUsd ?? 0, dayTop, barCells),
    }
  })
  // The week and the month still running are set against the same days of the one before.
  const [, thisWeek, thisMonth] = periods(history.days, today)
  const weeks = weekSpans(history.days, today, REPORT_WEEKS)
  const weekTop = Math.max(0, ...weeks.map(w => w.costUsd))
  const weekRows = weeks.map((w, i): Record<string, Cell> => ({
    PERIOD: { text: i === 0 ? 'this week' : `week of ${w.from.slice(5)}`, bold: i === 0 },
    COST: { text: money(w.costUsd), bold: i === 0 },
    TOKENS: { text: count(w.tokens), dim: true },
    'VS BEFORE': deltaCell(w.costUsd, i === 0 ? thisWeek?.before?.costUsd : weeks[i + 1]?.costUsd),
    BAR: barCell(w.costUsd, weekTop, barCells),
  }))
  const months = monthSpans(history.days, today)
  const monthTop = Math.max(0, ...months.map(m => m.costUsd))
  const monthRows = months.map((m, i): Record<string, Cell> => ({
    PERIOD: { text: `${MONTHS[Number(m.from.slice(5, 7)) - 1] ?? m.from} ${m.from.slice(0, 4)}${i === 0 ? ' (so far)' : ''}`, bold: i === 0 },
    COST: { text: money(m.costUsd), bold: i === 0 },
    TOKENS: { text: count(m.tokens), dim: true },
    'VS BEFORE': i === 0 ? deltaCell(m.costUsd, thisMonth?.before?.costUsd) : { text: '—', dim: true },
    BAR: barCell(m.costUsd, monthTop, barCells),
  }))
  const month = months[0]
  const models = month === undefined ? [] : modelShares(history.days, month.from, month.to)
  const monthCost = month?.costUsd ?? 0
  const modelRows = models.map((m): Record<string, Cell> => ({
    MODEL: { text: prettyModel(m.model), bold: true },
    COST: { text: money(m.costUsd) },
    TOKENS: { text: count(m.tokens), dim: true },
    SHARE: { text: `${monthCost > 0 ? Math.round((m.costUsd / monthCost) * 100) : 0}%` },
    BAR: barCell(m.costUsd, models[0]?.costUsd ?? 0, barCells),
  }))
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={ACCENT} paddingX={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold color={ACCENT}>{'📊 USAGE REPORT  ·  Claude Code on this machine'}</Text>
        <Text dimColor>{`ccusage · ${ago(now - history.at)} ago${problem !== null && problem.at > history.at ? ' · ⚠ stale' : ''}`}</Text>
      </Box>
      {rule(canvas.els, '📅 LAST 14 DAYS', '', inner)}
      {table(canvas.els, DAY_COLUMNS, dayRows, inner)}
      {rule(canvas.els, '🗓  WEEKS', 'Monday to Sunday · this week against the same days last week', inner)}
      {table(canvas.els, PERIOD_COLUMNS, weekRows, inner)}
      {rule(canvas.els, '🌙 MONTHS', 'this month against the same days last month', inner)}
      {table(canvas.els, PERIOD_COLUMNS, monthRows, inner)}
      {rule(canvas.els, '🧠 MODELS THIS MONTH', '', inner)}
      {table(canvas.els, MODEL_COLUMNS, modelRows, inner)}
    </Box>
  )
}
