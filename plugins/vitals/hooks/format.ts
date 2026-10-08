import type { ModelUsage } from 'claude-code'

import type { Tokens } from '../types'

export const NO_TOKENS: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

export const toTokens = (u: ModelUsage): Tokens => ({
  input: u.input_tokens,
  output: u.output_tokens,
  cacheRead: u.cache_read_input_tokens,
  cacheWrite: u.cache_creation_input_tokens,
})

export const addTokens = (a: Tokens, b: Tokens): Tokens => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
})

// Share of the prompt the cache served: read over everything sent (uncached, written, read).
export const hitRate = (t: Tokens) => {
  const sent = t.input + t.cacheRead + t.cacheWrite
  return sent === 0 ? null : Math.round((t.cacheRead / sent) * 100)
}

export const count = (n: number) =>
  n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${+(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k` : `${n}`

export const tone = (percent: number) => (percent >= 95 ? 'error' : percent >= 80 ? 'warning' : undefined)

const LABELS: Record<string, string> = { five_hour: '5-hour', seven_day: 'Weekly' }
const SHORT_LABELS: Record<string, string> = { five_hour: '5h', seven_day: '7d' }

export const limitLabel = (kind: string) => LABELS[kind] ?? kind.replace(/_/g, ' ')
export const limitShortLabel = (kind: string) => SHORT_LABELS[kind] ?? kind.replace(/_/g, ' ')

// `claude-opus-5-5[1m]` → `Opus 5.5 1M`; a display name such as `Opus 5.5` passes unchanged.
export const prettyModel = (id: string) => {
  const isLongContext = /\[1m\]$/i.test(id)
  const bare = id.replace(/\[1m\]$/i, '').replace(/^claude-/, '').replace(/-\d{8}$/, '')
  const [family = '', ...rest] = bare.split('-')
  if (family === '') return id
  const version = rest.filter(p => /^\d+$/.test(p)).join('.')
  const name = family[0]!.toUpperCase() + family.slice(1)
  return `${name}${version ? ` ${version}` : ''}${isLongContext ? ' 1M' : ''}`
}

export const until = (iso: string, now: number) => {
  const minutes = Math.max(0, Math.round((Date.parse(iso) - now) / 60_000))
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
  return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`
}

export const elapsed = (ms: number) => {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

export const ago = (ms: number) => {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
  return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`
}

export type Part = { text: string; emphasis?: 'warning' | 'strong' }

// The token figures of a turn or a session, as band parts: in, out, cache read/write, hit rate.
export const tokenParts = (t: Tokens): Part[] => {
  const hit = hitRate(t)
  return [
    { text: `in ${count(t.input)}` },
    { text: `out ${count(t.output)}` },
    { text: `cache read ${count(t.cacheRead)}` },
    { text: `write ${count(t.cacheWrite)}` },
    ...(hit === null ? [] : [{ text: `hit ${hit}%`, emphasis: hit < 50 ? ('warning' as const) : undefined }]),
  ]
}
