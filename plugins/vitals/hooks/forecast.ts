import type { Limit } from '../types'

// Where each plan limit will be at its reset, at the pace you are spending it now.
//
// The 5-hour limit goes at the last hour's pace, the least-squares slope of its readings (what
// Prometheus' deriv() computes): readings out of order, a dip that comes back or one odd tick
// barely move it, and the reading on show now closes it, so a pause flattens it. It earns its
// weight from ten to thirty minutes of readings, the window's average standing in before.
// The weekly limit goes at the week's own average, which already counts nights and days off:
// an hour of work says nothing about the five days left. It stays quiet for its first tenth,
// when that average has not yet seen a night.

/** How long each window lasts, so its start is its reset less this. */
const WINDOW_MS: Record<string, number> = { five_hour: 5 * 3_600_000, seven_day: 7 * 86_400_000 }

/** How far back the recent pace looks. */
export const RECENT_MS = 60 * 60_000
/** The recent pace counts for nothing under this much history… */
const RECENT_MIN_MS = 10 * 60_000
/** …and in full from this much on, sliding in between. */
const RECENT_FULL_MS = 30 * 60_000
/** The weekly forecast waits for this share of its window. */
const WEEK_QUIET_SHARE = 0.1

/** A reading equal to the last is still kept this long after it, so a pause shows in the pace. */
const HEARTBEAT_MS = 5 * 60_000

export type Sample = { at: number; percent: number }

export type Forecast = {
  kind: string
  percent: number
  resetAt: number
  /** When the limit reaches 100% at this pace, if that comes before the reset; else null. */
  outAt: number | null
  /** Where the limit will stand at the reset at this pace. */
  atReset: number
  /** Which pace the forecast uses: the last hour's, the window's average, or both. */
  pace: 'recent' | 'average' | 'blend'
}

/** The least-squares slope of the readings, in percent per millisecond; 0 under two of them. */
const slope = (points: Sample[]) => {
  const meanAt = points.reduce((sum, p) => sum + p.at, 0) / points.length
  const meanPercent = points.reduce((sum, p) => sum + p.percent, 0) / points.length
  let covariance = 0
  let variance = 0
  for (const p of points) {
    covariance += (p.at - meanAt) * (p.percent - meanPercent)
    variance += (p.at - meanAt) ** 2
  }
  return variance > 0 ? covariance / variance : 0
}

/**
 * The forecast for one limit, from its readings of the last hour and the window's average.
 * Null for a window of unknown length or with no reset time, and for a weekly window in its
 * first tenth.
 */
export const forecast = (limit: Limit, samples: Sample[], now: number): Forecast | null => {
  const length = WINDOW_MS[limit.kind]
  if (length === undefined || limit.resetsAt === null) return null
  const resetAt = Date.parse(limit.resetsAt)
  if (!Number.isFinite(resetAt) || resetAt <= now) return null
  const elapsed = now - (resetAt - length)
  const average = elapsed > 0 ? limit.percent / elapsed : 0

  let perMs = average
  let pace: Forecast['pace'] = 'average'
  if (limit.kind === 'seven_day') {
    if (elapsed < length * WEEK_QUIET_SHARE) return null
  } else {
    const since = Math.max(resetAt - length, now - RECENT_MS)
    const points = [...samples.filter(s => s.at >= since && s.at < now), { at: now, percent: limit.percent }]
    const span = now - Math.min(...points.map(p => p.at))
    const trust = Math.min(1, Math.max(0, (span - RECENT_MIN_MS) / (RECENT_FULL_MS - RECENT_MIN_MS)))
    perMs = trust * Math.max(0, slope(points)) + (1 - trust) * average
    pace = trust === 0 ? 'average' : trust === 1 ? 'recent' : 'blend'
  }

  const outAt = perMs > 0 ? now + (100 - limit.percent) / perMs : null
  return {
    kind: limit.kind,
    percent: limit.percent,
    resetAt,
    outAt: outAt !== null && outAt < resetAt && limit.percent < 100 ? outAt : limit.percent >= 100 ? now : null,
    atReset: Math.min(999, Math.round(limit.percent + perMs * (resetAt - now))),
    pace,
  }
}

/** A reading more for one limit: the last hour of them, one every few minutes through a pause. */
export const addSample = (samples: Sample[], sample: Sample) => {
  const kept = samples.filter(s => s.at >= sample.at - RECENT_MS)
  const last = kept[kept.length - 1]
  return last !== undefined && last.percent === sample.percent && sample.at - last.at < HEARTBEAT_MS ? kept : [...kept, sample]
}
