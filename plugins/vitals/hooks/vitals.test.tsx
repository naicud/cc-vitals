import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { mergeRoster, parseNotification } from './collect'
import { count, hitRate, prettyModel } from './format'
import { parseDaily, periods, weekStart } from './report'
import { blocks, cellWidth, fitColumns } from './ui'

// Thursday 8 October 2026, noon local; the session began 16 minutes before.
const NOW = new Date(2026, 9, 8, 12).getTime()
const STARTED = NOW - 16 * 60_000

const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 60,
  bodyColumns: 140,
  scroll: { offset: 0, bodyRows: 60 },
  view: {},
}

const MAIN_USAGE = {
  model: 'claude-opus-5-5',
  input_tokens: 1200,
  output_tokens: 3400,
  cache_read_input_tokens: 640_000,
  cache_creation_input_tokens: 18_000,
}

const AGENT_USAGE = {
  model: 'claude-sonnet-5-5',
  input_tokens: 2000,
  output_tokens: 1000,
  cache_read_input_tokens: 40_000,
  cache_creation_input_tokens: 4000,
}

const ROSTER = [{ id: 'a1', description: 'Review the diff', type: 'pr-review:code-reviewer', status: 'running' as const }]

const day = (date: string, cost: number, model = 'claude-opus-5-5') => ({
  date,
  inputTokens: 1000,
  outputTokens: 2000,
  cacheCreationTokens: 3000,
  cacheReadTokens: 94_000,
  totalTokens: 100_000,
  totalCost: cost,
  modelBreakdowns: [{ modelName: model, cost, inputTokens: 1000, outputTokens: 2000, cacheReadTokens: 94_000, cacheCreationTokens: 3000 }],
})

// Monday 5 to Thursday 8 October against Monday 28 September to Thursday 1 October.
const CCUSAGE = JSON.stringify({
  daily: [
    day('2026-09-28', 10),
    day('2026-09-29', 10),
    day('2026-10-01', 20),
    day('2026-10-02', 99),
    day('2026-10-05', 30),
    day('2026-10-07', 20, 'claude-sonnet-5-5'),
    day('2026-10-08', 50),
  ],
})

// What the engine answers beneath the mod: a session on main with two changed files, 680k of a
// 1M window auto-compacting at 900k, both plan limits, $4.21 spent, effort high in /config, one
// running subagent and ccusage's daily report.
const fakeEngine = (on: On, toasts: string[] = []) => {
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.usage', ($, e) => ({
    value: {
      startedAt: STARTED,
      context: {
        tokens: 680_000,
        window: 1_000_000,
        percent: 68,
        ...(e.breakdown === undefined
          ? {}
          : { breakdown: { isAutoCompactEnabled: true, rawMaxTokens: 1_000_000, autoCompactThreshold: 900_000 } as never }),
      },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 42 },
        { kind: 'seven_day', percentUsed: 85 },
      ],
      cost: { usd: 4.21 },
    },
  }))
  on('session.cwd', () => ({ value: '/work/cc-vitals' }))
  on('session.turns', () => ({ value: 12 }))
  on('session.model', () => ({ value: 'claude-opus-5-5[1m]' }))
  on('agent.list', () => ({ value: ROSTER }))
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.after', () => ({ value: undefined }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('config.list', () => ({
    value: [{ key: 'effort', label: 'Effort', kind: 'choice' as const, value: 'high', provider: { plugin: 'core', tier: 'core' as const }, isLocked: false }],
  }))
  on('process.run', ($, e) => {
    const stdout =
      e.argv[0] === 'ccusage' ? CCUSAGE : e.argv[1] === 'status' ? '# branch.head main\n1 .M N... a\n1 .M N... b' : '.git\n.git'
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.complete', ($, e) => ({ text: e.answer, usage: e.usage }))
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })
  on('tool.call', { tool: 'Bash' }, () => ({
    result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b8f2' },
  }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
}

const drain = async (stream: AsyncIterable<unknown>) => {
  for await (const _chunk of stream) void _chunk
}

const COMMAND = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 140 } }

/** A session: one main turn, a Sonnet subagent at medium effort, a dev server in the background. */
const runSession = async ($: Engine) => {
  await $.session.start({ cwd: '/work/cc-vitals', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'vitals', args: 'report', ...COMMAND })
  await drain($.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 3 }))
  await drain($.turn.step({ turnId: 't2', index: 0, model: 'claude-sonnet-5-5', effort: 'medium', messageCount: 1, agentId: 'a1' }))
  await $.turn.complete({ answer: '', durationMs: 40_000, isAborted: false, turnId: 't2', usage: AGENT_USAGE, reason: 'answer', agentId: 'a1' })
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', description: 'Start the dev server', run_in_background: true })
  await $.turn.complete({ answer: 'ok', durationMs: 12_000, isAborted: false, turnId: 't1', usage: MAIN_USAGE, reason: 'answer' })
}

const bandText = async ($: Engine, surface: 'terminal' | 'desktop', props = PROPS) => {
  const ui = await $.ui.mount({ plugin: 'vitals', surface, component: 'AbovePrompt', props })
  return (await ui.find({ text: /./ }))?.text ?? ''
}

test('hit rate is cache read over everything sent', () => {
  expect(hitRate({ input: 1200, output: 3400, cacheRead: 640_000, cacheWrite: 18_000 })).toBe(97)
  expect(hitRate({ input: 0, output: 5, cacheRead: 0, cacheWrite: 0 })).toBe(null)
})

test('model ids read as names', () => {
  expect(prettyModel('claude-opus-5-5[1m]')).toBe('Opus 5.5 1M')
  expect(prettyModel('claude-haiku-5-5-20260101')).toBe('Haiku 5.5')
  expect(prettyModel('Opus 5.5')).toBe('Opus 5.5')
})

test('token counts shorten', () => {
  expect(count(950)).toBe('950')
  expect(count(1234)).toBe('1.2k')
  expect(count(18_000)).toBe('18k')
  expect(count(12_340_000)).toBe('12.3M')
})

test('emoji take two cells, box drawing one', () => {
  expect(cellWidth('── 🔥 TOKENS')).toBe(12)
  expect(cellWidth('⚡ HIGH')).toBe(7)
})

test('bars resolve to an eighth of a cell', () => {
  expect(blocks(50, 10)).toEqual({ filled: '█████', track: '░░░░░' })
  expect(blocks(55, 10)).toEqual({ filled: '█████▌', track: '░░░░' })
})

test('a task notification names each task and how it ended', () => {
  const text =
    '<task-notification><task-id>b8f2</task-id><status>completed</status></task-notification>' +
    '<task-notification><task-id>b9a0</task-id><status>killed</status></task-notification>'
  expect(parseNotification(text)).toEqual([
    { id: 'b8f2', status: 'completed' },
    { id: 'b9a0', status: 'killed' },
  ])
})

test('an agent the roster no longer lists has ended', () => {
  const merged = mergeRoster([], ROSTER, 10)
  expect(merged[0]?.status).toBe('running')
  expect(mergeRoster(merged, [], 20)[0]).toMatchObject({ status: 'completed', endedAt: 20 })
})

test('narrow tables drop their lowest-priority columns first, the growing one takes the rest', () => {
  const columns = [
    { title: 'A', width: 10, grow: true },
    { title: 'B', width: 10, priority: 2 },
    { title: 'C', width: 10, priority: 1 },
  ]
  expect(fitColumns(columns, 40).map(c => [c.title, c.width])).toEqual([['A', 14], ['B', 10], ['C', 10]])
  expect(fitColumns(columns, 23).map(c => c.title)).toEqual(['A', 'B'])
  expect(fitColumns(columns, 5).map(c => c.title)).toEqual(['A'])
})

test('ccusage days fold into today, week and month against the same days before', () => {
  const days = parseDaily(CCUSAGE)
  expect(days?.length).toBe(7)
  expect(parseDaily('not json')).toBe(null)
  expect(weekStart('2026-10-08')).toBe('2026-10-05')
  const [today, week, month] = periods(days ?? [], '2026-10-08')
  expect(today?.now.costUsd).toBe(50)
  expect(week?.now.costUsd).toBe(100)
  expect(week?.before?.costUsd).toBe(40) // Mon 28 Sep to Thu 1 Oct, not Fri 2 Oct's 99
  expect(month?.now.costUsd).toBe(219)
  expect(month?.before?.costUsd).toBe(0) // 1 to 8 September: the September days on record are later
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: the dashboard shows tokens, agents with model and effort, shells, compaction and usage`, async ($, on) => {
    fakeEngine(on)
    await runSession($)

    // A wide terminal: two columns, the numbers left, the work and the agents right.
    const band = await bandText($, surface, { ...PROPS, bodyColumns: 200 })
    const expected = [
      '◆ VITALS',
      '🧠 ',
      'Opus 5.5 1M',
      'HIGH',
      '▰▰▰▱▱',
      '📁 cc-vitals  🌿 main ●2',
      '💸 $4.21',
      '⛽ CTX',
      '68%',
      '⏳ 5H LIMIT',
      '📅 WEEKLY',
      '85%',
      '🔥 TOKENS',
      'CACHE R',
      '640k',
      '97%',
      '🤖 AGENTS',
      'Review the diff',
      'code-reviewer',
      'Sonnet 5.5',
      'medium',
      '🐚 SHELLS',
      'Start the dev server',
      '🗜 COMPACT',
      '76%',
      '220k to go',
      '📊 USAGE',
      'week',
      '$100',
      '▲ +150%',
      '🔧 TOOLS',
      'CALLS',
      '1 calls · 0 errors',
    ]
    for (const text of expected) expect(band).toContain(text)
  })

  test(`${surface}: a short band gives every section one line instead of scrolling`, async ($, on) => {
    fakeEngine(on)
    await runSession($)

    const band = await bandText($, surface, { ...PROPS, maxRows: 10, scroll: { offset: 0, bodyRows: 10 } })
    for (const text of ['🔥 TOKENS', '🤖 AGENTS', '📊 USAGE', '🐚 SHELLS', 'hit 97%']) expect(band).toContain(text)
    expect(band).not.toContain('CACHE R')
  })

  test(`${surface}: one column draws the agents right under the tokens, the usage last`, async ($, on) => {
    fakeEngine(on)
    await runSession($)

    const band = await bandText($, surface)
    expect(band.indexOf('🤖 AGENTS')).toBeGreaterThan(band.indexOf('🔥 TOKENS'))
    expect(band.indexOf('🤖 AGENTS')).toBeLessThan(band.indexOf('📊 USAGE'))
    expect(band).toContain('Review the diff')
  })

  test(`${surface}: a task notification ends the shell it names`, async ($, on) => {
    fakeEngine(on)
    await runSession($)
    await $.prompt.submit({
      text: '<task-notification><task-id>b8f2</task-id><status>completed</status></task-notification>',
      wait: false,
      origin: { kind: 'task-notification' },
    })

    expect(await bandText($, surface)).toContain('completed')
  })

  test(`${surface}: /vitals switches to one compact line`, async ($, on) => {
    fakeEngine(on)
    await runSession($)
    await $.command.run({ command: 'vitals', args: '', ...COMMAND })

    const band = await bandText($, surface)
    expect(band).toContain('🧠 Opus 5.5 1M · ⚡ high · ⛽ 68% · ⏳ 42% · 📅 85% · 🧊 97% · 💸 $4.21 · 📊 week $100')
    expect(band).not.toContain('AGENTS')
  })

  test(`${surface}: /vitals report draws days, weeks, months and models`, async ($, on) => {
    fakeEngine(on)
    await runSession($)

    const ui = await $.ui.mount({ plugin: 'vitals', surface, component: 'Pane', requestId: 'vitals-report', props: { title: 'r', isFocused: false, bodyColumns: 120, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} } })
    const pane = (await ui.find({ text: /./ }))?.text ?? ''
    for (const text of ['📊 USAGE REPORT', 'Thu 10-08 ◀', '$50.00', 'this week', 'Oct 2026 (so far)', 'Sonnet 5.5']) expect(pane).toContain(text)
  })
}

test('an interrupted turn keeps the last counted tokens on show', async ($, on) => {
  fakeEngine(on)
  await runSession($)
  await $.turn.complete({ answer: '', durationMs: 1000, isAborted: true, turnId: 't3', reason: 'aborted' })

  expect(await bandText($, 'terminal')).toContain('640k')
})

test('a plan limit past 80% raises one toast', async ($, on) => {
  const toasts: string[] = []
  fakeEngine(on, toasts)
  await runSession($)

  expect(toasts).toEqual(['Weekly usage limit at 85%'])
})
