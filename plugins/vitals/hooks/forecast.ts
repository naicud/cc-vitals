import type { Limit } from '../types'

// Where each plan limit will be at its reset, at the pace you are spending it now.

/** How long each window lasts, so its start is its reset less this. */
const WINDOW_MS: Record<string, number> = { five_hour: 5 * 3_600_000, seven_day: 7 * 86_400_000 }

/** The recent pace needs this much history; with less, the window's average pace stands in. */
const RECENT_MIN_MS = 10 * 60_000
/** How far back the recent pace looks. */
export const RECENT_MS = 60 * 60_000

export type Sample = { at: number; percent: number }

export type Forecast = {
  kind: string
  percent: number
  resetAt: number
  /** When the limit reaches 100% at this pace, if that comes before the reset; else null. */
  outAt: number | null
  /** Where the limit will stand at the reset at this pace. */
  atReset: number
  /** Which pace the forecast uses: the last hour's, or the window's average. */
  pace: 'recent' | 'average'
}

/**
 * The forecast for one limit: the last hour's pace when there is at least ten minutes of it
 * within this window, else the average since the window began. Null for a window of unknown
 * length or with no reset time.
 */
export const forecast = (limit: Limit, samples: Sample[], now: number): Forecast | null => {
  const length = WINDOW_MS[limit.kind]
  if (length === undefined || limit.resetsAt === null) return null
  const resetAt = Date.parse(limit.resetsAt)
  if (!Number.isFinite(resetAt) || resetAt <= now) return null
  const start = resetAt - length
  const recent = samples.filter(s => s.at >= Math.max(start, now - RECENT_MS))
  const first = recent[0]
  const hasRecent = first !== undefined && now - first.at >= RECENT_MIN_MS && limit.percent >= first.percent
  const perMs = hasRecent ? (limit.percent - first.percent) / (now - first.at) : now > start ? limit.percent / (now - start) : 0
  const outAt = perMs > 0 ? now + (100 - limit.percent) / perMs : null
  return {
    kind: limit.kind,
    percent: limit.percent,
    resetAt,
    outAt: outAt !== null && outAt < resetAt && limit.percent < 100 ? outAt : limit.percent >= 100 ? now : null,
    atReset: Math.min(999, Math.round(limit.percent + perMs * (resetAt - now))),
    pace: hasRecent ? 'recent' : 'average',
  }
}

/** A sample more for `kind`, keeping only what the recent pace can use. */
export const addSample = (samples: Sample[], sample: Sample) => {
  const kept = samples.filter(s => s.at >= sample.at - RECENT_MS)
  const last = kept[kept.length - 1]
  return last !== undefined && last.percent === sample.percent ? kept : [...kept, sample]
}
