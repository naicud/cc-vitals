import type { HistoryProblem, PlanUsage, UsageHistory } from '../types'
import { ago, cash, count, delta, limitLabel, meterTone, money, prettyModel, until } from './format'
import { REPORT_WEEKS, addDays, change, firstDate, localDate, modelShares, monthSpans, periods, weekSpans } from './report'
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

const PLAN_COLUMNS: Column[] = [
  { title: 'LIMIT', width: 22 },
  { title: 'USED', width: 6, align: 'right' },
  { title: 'RESETS', width: 7, align: 'right' },
  { title: 'NOTE', width: 22, priority: 1 },
  { title: 'BAR', width: 10, grow: true },
]

const SHARE_COLUMNS: Column[] = [
  { title: 'PRODUCT', width: 22 },
  { title: 'SHARE', width: 6, align: 'right' },
  { title: 'BAR', width: 10, grow: true },
]

/** A limit's bar against 100%, in the tone its meter in the band has. */
const limitBar = (percent: number, severity: string | undefined, cells: number): Cell => ({
  text: blocks(percent, cells).filled,
  color: meterTone(percent, severity) ?? ACCENT,
})

/**
 * The account's plan limits as its usage endpoint reports them, every session, machine and claude.ai
 * chat counted: the 5-hour and weekly windows, each model's own weekly limit, usage credits, and the
 * weekly limit's shares by product. `▸` marks the limit the server names as the one that counts now.
 */
const drawPlan = (canvas: Canvas, inner: number, now: number, plan: PlanUsage) => {
  const { Box, Text } = canvas.els
  const barCells = Math.max(6, inner - 22 - 6 - 7 - 22 - 3 * 4)
  const resets = (iso: string | null): Cell => (iso === null ? { text: '—', dim: true } : { text: until(iso, now), dim: true })
  const graded = (severity: string | undefined, isActive: boolean) =>
    [isActive ? 'counts now' : '', severity !== undefined && severity !== 'normal' ? severity : ''].filter(t => t !== '').join(' · ')
  const limitRows = plan.limits.map((l): Record<string, Cell> => ({
    LIMIT: { text: `${l.isActive === true ? '▸ ' : ''}${limitLabel(l.kind)}${l.kind === 'seven_day' ? ' · all models' : ''}`, bold: true },
    USED: { text: `${l.percent}%`, bold: true, color: meterTone(l.percent, l.severity) },
    RESETS: resets(l.resetsAt),
    NOTE: { text: graded(l.severity, l.isActive === true), color: meterTone(l.percent, l.severity) },
    BAR: limitBar(l.percent, l.severity, barCells),
  }))
  const otherRows = plan.rows.map((r): Record<string, Cell> => ({
    LIMIT: { text: `${r.isActive ? '▸ ' : ''}${r.kind.startsWith('weekly') ? 'Weekly · ' : ''}${r.label}`, bold: true },
    USED: { text: `${r.percent}%`, bold: true, color: meterTone(r.percent, r.severity) },
    RESETS: resets(r.resetsAt),
    NOTE: { text: [r.ofWeekly === null ? '' : `up to ${r.ofWeekly}% of weekly`, graded(r.severity, r.isActive)].filter(t => t !== '').join(' · '), dim: true },
    BAR: limitBar(r.percent, r.severity, barCells),
  }))
  const c = plan.credits
  const creditRows: Record<string, Cell>[] =
    c === null
      ? []
      : [
          {
            LIMIT: { text: 'Usage credits', bold: true },
            USED: c.limit === null || c.limit <= 0 ? { text: '—', dim: true } : { text: `${Math.round((c.used / c.limit) * 100)}%`, bold: true },
            RESETS: { text: 'monthly', dim: true },
            NOTE: { text: `${cash(c.used, c.currency)}${c.limit === null ? ' · no cap' : ` of ${cash(c.limit, c.currency)}`}${c.isOn ? '' : ' · off'}`, dim: true },
            BAR: c.limit === null || c.limit <= 0 ? { text: '' } : limitBar((c.used / c.limit) * 100, undefined, barCells),
          },
        ]
  const b = plan.breakdown
  const shareCells = Math.max(6, inner - 22 - 6 - 3 * 2)
  const shareRows = (b?.rows ?? []).map((r): Record<string, Cell> => ({
    PRODUCT: { text: r.name, bold: r.percent > 0, dim: r.percent === 0 },
    SHARE: { text: `${r.percent}%`, dim: r.percent === 0 },
    BAR: { text: blocks(r.percent, shareCells).filled, color: ACCENT },
  }))
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={ACCENT} paddingX={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold color={ACCENT}>{'🎯 PLAN LIMITS  ·  your account, every session and claude.ai'}</Text>
        <Text dimColor>{`/api/oauth/usage · ${ago(now - plan.at)} ago`}</Text>
      </Box>
      {table(canvas.els, PLAN_COLUMNS, [...limitRows, ...otherRows, ...creditRows], inner)}
      {b !== null && rule(canvas.els, '🧭 THIS WEEK BY PRODUCT', `share of the weekly limit${b.asOf === null ? '' : ` · as of ${ago(now - Date.parse(b.asOf))} ago`}`, inner)}
      {b !== null && table(canvas.els, SHARE_COLUMNS, shareRows, inner)}
    </Box>
  )
}

/**
 * The usage report: the account's plan limits when there is a reading of them, then this machine's
 * Claude Code spend from ccusage: the last 14 days, the last 6 weeks, this month and the last, and
 * the models.
 */
export const drawReport = (
  canvas: Canvas,
  room: number,
  now: number,
  history: UsageHistory | null,
  problem: HistoryProblem | null,
  isReading: boolean,
  plan: PlanUsage | null = null,
) => {
  const { Box, Text } = canvas.els
  const inner = room - FRAME_CELLS
  const planBox = plan === null ? null : drawPlan(canvas, inner, now, plan)
  if (history === null) {
    return (
      <Box flexDirection="column">
        {planBox}
        <Text dimColor>{problem === null ? 'Reading usage history…' : `No usage history: ${problem.reason}`}</Text>
      </Box>
    )
  }
  const today = localDate(now)
  // Days before the history's first one have no data at all: not zero spent, nothing known.
  const first = firstDate(history.days) ?? today
  const noData: Cell = { text: 'no data', dim: true }
  const barCells = Math.max(6, inner - 14 - 7 - 6 - 12 - 3 * 4)
  const byDate = new Map(history.days.map(d => [d.date, d]))
  const dates = Array.from({ length: 14 }, (_, i) => addDays(today, -i))
  const dayTop = Math.max(0, ...dates.map(d => byDate.get(d)?.costUsd ?? 0))
  const dayRows = dates.map((date): Record<string, Cell> => {
    const day = byDate.get(date)
    const top = day?.models.slice().sort((a, b) => b.costUsd - a.costUsd)[0]
    if (date < first) return { DAY: { text: `${weekday(date)} ${date.slice(5)}`, dim: true }, COST: noData }
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
  const weekRows = weeks.map((w, i): Record<string, Cell> => {
    const name = i === 0 ? 'this week' : `week of ${w.from.slice(5)}`
    if (w.to < first) return { PERIOD: { text: name, dim: true }, COST: noData }
    const before = weeks[i + 1]
    const beforeCost = i === 0 ? thisWeek?.before?.costUsd : before !== undefined && before.from >= first ? before.costUsd : undefined
    return {
      PERIOD: { text: `${name}${w.from < first ? ` (from ${first.slice(5)})` : ''}`, bold: i === 0 },
      COST: { text: money(w.costUsd), bold: i === 0 },
      TOKENS: { text: count(w.tokens), dim: true },
      'VS BEFORE': w.from < first ? { text: '—', dim: true } : deltaCell(w.costUsd, beforeCost),
      BAR: barCell(w.costUsd, weekTop, barCells),
    }
  })
  const months = monthSpans(history.days, today)
  const monthTop = Math.max(0, ...months.map(m => m.costUsd))
  const monthRows = months.map((m, i): Record<string, Cell> => ({
    PERIOD: {
      text: `${MONTHS[Number(m.from.slice(5, 7)) - 1] ?? m.from} ${m.from.slice(0, 4)}${i === 0 ? ' (so far)' : m.from < first ? ` (from ${first.slice(5)})` : ''}`,
      bold: i === 0,
    },
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
    <Box flexDirection="column">
      {planBox}
      <Box flexDirection="column" borderStyle="round" borderColor={ACCENT} paddingX={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold color={ACCENT}>{'📊 USAGE REPORT  ·  Claude Code on this machine'}</Text>
          <Text dimColor>
            {`ccusage · data from ${first.slice(5)} · ${isReading ? 'reading…' : `${ago(now - history.at)} ago`}${problem !== null && problem.at > history.at ? ' · ⚠ stale' : ''}`}
          </Text>
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
    </Box>
  )
}
