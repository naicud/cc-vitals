import type { ModelUsage } from 'claude-code'

import type { RunStatus, Tokens } from '../types'

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

/** Everything the requests sent and got back: uncached, cache read and written, output. */
export const totalTokens = (t: Tokens) => t.input + t.cacheRead + t.cacheWrite + t.output

// Share of the prompt the cache served: read over everything sent (uncached, written, read).
export const hitRate = (t: Tokens) => {
  const sent = t.input + t.cacheRead + t.cacheWrite
  return sent === 0 ? null : Math.round((t.cacheRead / sent) * 100)
}

export const count = (n: number) =>
  n >= 1_000_000_000
    ? `${+(n / 1_000_000_000).toFixed(1)}B`
    : n >= 1_000_000
      ? `${+(n / 1_000_000).toFixed(1)}M`
      : n >= 1000
        ? `${+(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
        : `${n}`

/** A tool's short name: an MCP tool's own, without its server prefix (`mcp__srv__ctx_execute` → `ctx_execute`). */
export const toolName = (tool: string) => (tool.startsWith('mcp__') ? (tool.split('__').pop() ?? tool) : tool)

export const tone = (percent: number) => (percent >= 95 ? 'error' : percent >= 80 ? 'warning' : undefined)

const LABELS: Record<string, string> = { five_hour: '5-hour', seven_day: 'Weekly' }
const SHORT_LABELS: Record<string, string> = { five_hour: '5H', seven_day: '7D' }

export const limitLabel = (kind: string) => LABELS[kind] ?? kind.replace(/_/g, ' ')
export const limitShortLabel = (kind: string) => SHORT_LABELS[kind] ?? kind.replace(/_/g, ' ').toUpperCase()

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
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
}

export const ago = (ms: number) => {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
  return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/** The glyph and colour of a run's status; a running one spins with the band's tick. */
export const statusMark = (status: RunStatus, tick: number): { glyph: string; color?: string } => {
  if (status === 'running') return { glyph: SPINNER[tick % SPINNER.length]!, color: 'claude' }
  if (status === 'waiting') return { glyph: '◷', color: 'suggestion' }
  if (status === 'completed') return { glyph: '✓', color: 'success' }
  if (status === 'failed') return { glyph: '✗', color: 'error' }
  return { glyph: '■', color: 'warning' }
}

export const isActive = (status: RunStatus) => status === 'running' || status === 'waiting'

/** How long a run that has ended stays in the band, its ✓ or ✗ on show, before it leaves. */
export const LINGER_MS = 3000

/** Whether the band still shows a run: while it runs, and for LINGER_MS after it ends. */
export const isShown = (run: { status: RunStatus; endedAt: number | null }, now: number) =>
  isActive(run.status) || (run.endedAt !== null && now - run.endedAt < LINGER_MS)

/** The engine's agent statuses folded into the band's five. */
export const runStatus = (status: string): RunStatus => {
  if (status === 'completed' || status === 'failed' || status === 'killed' || status === 'waiting') return status
  if (status === 'idle') return 'waiting'
  return 'running'
}

/** A task notification's status word (`completed`, `failed`, `killed`, `stopped`, ...). */
export const notifiedStatus = (status: string): RunStatus =>
  status === 'completed' ? 'completed' : status === 'killed' || status === 'stopped' ? 'killed' : status === 'running' ? 'running' : 'failed'

/** The last segment of a plugin-scoped agent type: `pr-review:code-reviewer` → `code-reviewer`. */
export const shortType = (type: string) => type.split(':').pop() || type

/** One line of a shell command, its whitespace folded. */
export const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

/** Dollars as a glance reads them: `$9.23`, `$118`, `$4.4k`. */
export const money = (usd: number) =>
  usd >= 1000 ? `$${+(usd / 1000).toFixed(1)}k` : usd >= 100 ? `$${Math.round(usd)}` : `$${usd.toFixed(2)}`

const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']

/** The effort as pips out of five: `high` → `▰▰▰▱▱`; a numeric budget draws none. */
export const effortPips = (level: string) => {
  const i = LEVELS.indexOf(level)
  return i < 0 ? '' : '▰'.repeat(i + 1) + '▱'.repeat(LEVELS.length - i - 1)
}

/** A change as an arrow and a signed percentage, or empty with nothing to compare against. */
export const delta = (percent: number | null) =>
  percent === null ? '' : percent > 0 ? `▲ +${percent}%` : percent < 0 ? `▼ ${percent}%` : '= 0%'

export type Part ={ text: string; color?: string; emphasis?: 'warning' | 'strong' | 'plain' }
