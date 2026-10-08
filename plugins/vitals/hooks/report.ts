import type { DayUsage, ModelDay } from '../types'

// Usage history from `ccusage claude daily --json`: parsed defensively (it is another program's
// output), then folded into today, this week and this month against the period before.

const num = (o: object, key: string) => {
  const v: unknown = Reflect.get(o, key)
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

const str = (o: object, key: string) => {
  const v: unknown = Reflect.get(o, key)
  return typeof v === 'string' ? v : null
}

const isObject = (v: unknown): v is object => typeof v === 'object' && v !== null

const parseModels = (raw: unknown): ModelDay[] =>
  Array.isArray(raw)
    ? raw.filter(isObject).flatMap(m => {
        const model = str(m, 'modelName')
        if (model === null) return []
        const tokens = num(m, 'inputTokens') + num(m, 'outputTokens') + num(m, 'cacheReadTokens') + num(m, 'cacheCreationTokens')
        return [{ model, costUsd: num(m, 'cost'), tokens }]
      })
    : []

/** The days of a ccusage daily report, or null when the text is not one. */
export const parseDaily = (text: string): DayUsage[] | null => {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (!isObject(data)) return null
  const daily: unknown = Reflect.get(data, 'daily')
  if (!Array.isArray(daily)) return null
  return daily.filter(isObject).flatMap(d => {
    const date = str(d, 'date') ?? str(d, 'period')
    if (date === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return []
    return [
      {
        date,
        costUsd: num(d, 'totalCost'),
        tokens: num(d, 'totalTokens'),
        input: num(d, 'inputTokens'),
        output: num(d, 'outputTokens'),
        cacheRead: num(d, 'cacheReadTokens'),
        cacheWrite: num(d, 'cacheCreationTokens'),
        models: parseModels(Reflect.get(d, 'modelBreakdowns')),
      },
    ]
  })
}

const pad = (n: number) => String(n).padStart(2, '0')

/** The local calendar day of `ms`, as ccusage groups by default: `2026-10-08`. */
export const localDate = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** `date` moved by `n` days, in calendar terms (noon keeps a DST shift off the date). */
export const addDays = (date: string, n: number) => {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number)
  return localDate(new Date(y, m - 1, d + n, 12).getTime())
}

/** The Monday that starts `date`'s week. */
export const weekStart = (date: string) => {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number)
  const weekday = (new Date(y, m - 1, d, 12).getDay() + 6) % 7
  return addDays(date, -weekday)
}

/** The first day of `date`'s month, and of the month before. */
export const monthStart = (date: string) => `${date.slice(0, 7)}-01`
export const previousMonthStart = (date: string) => monthStart(addDays(monthStart(date), -1))

/** The ccusage `--since` that covers this month and the one before: `20260901`. */
export const historySince = (today: string) => previousMonthStart(today).replace(/-/g, '')

export type Span = { costUsd: number; tokens: number; days: number }

/** The days from `from` to `to`, both included. */
export const span = (days: DayUsage[], from: string, to: string): Span => {
  const inside = days.filter(d => d.date >= from && d.date <= to)
  return {
    costUsd: inside.reduce((s, d) => s + d.costUsd, 0),
    tokens: inside.reduce((s, d) => s + d.tokens, 0),
    days: inside.length,
  }
}

/** Every model's share of the days from `from` to `to`, the costliest first. */
export const modelShares = (days: DayUsage[], from: string, to: string) => {
  const byModel = new Map<string, ModelDay>()
  for (const day of days) {
    if (day.date < from || day.date > to) continue
    for (const m of day.models) {
      const held = byModel.get(m.model)
      byModel.set(m.model, held ? { model: m.model, costUsd: held.costUsd + m.costUsd, tokens: held.tokens + m.tokens } : m)
    }
  }
  return [...byModel.values()].sort((a, b) => b.costUsd - a.costUsd)
}

export type Period = { name: string; now: Span; before: Span | null; from: string; to: string }

/**
 * Today against yesterday, this week against last week's same days, this month against last
 * month's same days: the comparison is like for like however far into the period we are.
 */
export const periods = (days: DayUsage[], today: string): Period[] => {
  const week = weekStart(today)
  const intoWeek = Math.round((Date.parse(today) - Date.parse(week)) / 86_400_000)
  const month = monthStart(today)
  const lastMonth = previousMonthStart(today)
  const intoMonth = Number(today.slice(8, 10)) - 1
  const lastMonthSame = addDays(lastMonth, intoMonth) < month ? addDays(lastMonth, intoMonth) : addDays(month, -1)
  return [
    { name: 'today', now: span(days, today, today), before: span(days, addDays(today, -1), addDays(today, -1)), from: today, to: today },
    { name: 'week', now: span(days, week, today), before: span(days, addDays(week, -7), addDays(week, intoWeek - 7)), from: week, to: today },
    { name: 'month', now: span(days, month, today), before: span(days, lastMonth, lastMonthSame), from: month, to: today },
  ]
}

/** The cost of each of the last `n` days, oldest first, a missing day as zero. */
export const dailyCosts = (days: DayUsage[], today: string, n: number) => {
  const byDate = new Map(days.map(d => [d.date, d.costUsd]))
  return Array.from({ length: n }, (_, i) => byDate.get(addDays(today, i - n + 1)) ?? 0)
}

/** The change from `before` to `now` as a whole percentage, or null when there is nothing to compare. */
export const change = (now: number, before: number) => (before <= 0 ? null : Math.round(((now - before) / before) * 100))

/** Whole weeks (Monday first) back from this one, newest first. */
export const weekSpans = (days: DayUsage[], today: string, n: number) =>
  Array.from({ length: n }, (_, i) => {
    const from = addDays(weekStart(today), -7 * i)
    const to = i === 0 ? today : addDays(from, 6)
    return { from, to, ...span(days, from, to) }
  })

/** This month and the one before, newest first. */
export const monthSpans = (days: DayUsage[], today: string) => {
  const month = monthStart(today)
  const lastMonth = previousMonthStart(today)
  return [
    { from: month, to: today, ...span(days, month, today) },
    { from: lastMonth, to: addDays(month, -1), ...span(days, lastMonth, addDays(month, -1)) },
  ]
}
