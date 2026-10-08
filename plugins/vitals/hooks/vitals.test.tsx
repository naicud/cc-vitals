import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { mergeRoster, parseNotification } from './collect'
import { count, hitRate, prettyModel } from './format'
import { fitColumns } from './ui'

const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 40,
  bodyColumns: 130,
  scroll: { offset: 0, bodyRows: 40 },
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

// What the engine answers beneath the mod: a session on main with two changed files, 680k of a
// 1M window, both plan limits, $4.21 spent, effort high in /config and one running subagent.
const fakeEngine = (on: On, toasts: string[] = []) => {
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 680_000, window: 1_000_000, percent: 68 },
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
  on('clock.now', () => ({ value: 1_000_000 }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.after', () => ({ value: undefined }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('config.list', () => ({
    value: [{ key: 'effort', label: 'Effort', kind: 'choice' as const, value: 'high', provider: { plugin: 'core', tier: 'core' as const }, isLocked: false }],
  }))
  on('process.run', ($, e) => ({
    value: {
      exitCode: 0,
      stdout: e.argv[1] === 'status' ? '# branch.head main\n1 .M N... a\n1 .M N... b' : '.git\n.git',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
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

/** A session: one main turn, a Sonnet subagent at medium effort, and a dev server in the background. */
const runSession = async ($: Engine) => {
  await $.session.start({ cwd: '/work/cc-vitals', surface: 'terminal', isInteractive: true })
  await drain($.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 3 }))
  await drain($.turn.step({ turnId: 't2', index: 0, model: 'claude-sonnet-5-5', effort: 'medium', messageCount: 1, agentId: 'a1' }))
  await $.turn.complete({ answer: '', durationMs: 40_000, isAborted: false, turnId: 't2', usage: AGENT_USAGE, reason: 'answer', agentId: 'a1' })
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', description: 'Start the dev server', run_in_background: true })
  await $.turn.complete({ answer: 'ok', durationMs: 12_000, isAborted: false, turnId: 't1', usage: MAIN_USAGE, reason: 'answer' })
}

const bandText = async ($: Engine, surface: 'terminal' | 'desktop') => {
  const ui = await $.ui.mount({ plugin: 'vitals', surface, component: 'AbovePrompt', props: PROPS })
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

test('a task notification names each task and how it ended', () => {
  const text = '<task-notification><task-id>b8f2</task-id><status>completed</status></task-notification>' +
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

test('narrow tables drop their lowest-priority columns first', () => {
  const columns = [
    { title: 'A', width: 10 },
    { title: 'B', width: 10, priority: 2 },
    { title: 'C', width: 10, priority: 1 },
  ]
  expect(fitColumns(columns, 30).map(c => c.title)).toEqual(['A', 'B', 'C'])
  expect(fitColumns(columns, 20).map(c => c.title)).toEqual(['A', 'B'])
  expect(fitColumns(columns, 5).map(c => c.title)).toEqual(['A'])
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: the dashboard shows tokens, every agent's model and effort, and shells`, async ($, on) => {
    fakeEngine(on)
    await runSession($)

    const band = await bandText($, surface)
    const expected = [
      '◆ VITALS',
      'Opus 5.5 1M',
      'effort',
      'high',
      '📁 cc-vitals  ⎇ main ●2',
      '$4.21',
      'CTX',
      '68%',
      '7D',
      '85%',
      'TOKENS',
      'CACHE R',
      '640k',
      '97%',
      'AGENTS',
      'main',
      'Review the diff',
      'code-reviewer',
      'Sonnet 5.5',
      'medium',
      'SHELLS',
      'b8f2',
      '$ Start the dev server',
      'running',
      'TOOLS',
      'Bash 1',
    ]
    for (const text of expected) expect(band).toContain(text)
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
    await $.command.run({ command: 'vitals', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })

    const band = await bandText($, surface)
    expect(band).toContain('◆ Opus 5.5 1M · effort high · ctx 68% · 5h 42% · 7d 85% · hit 97% · $4.21')
    expect(band).not.toContain('AGENTS')
  })
}

test('a plan limit past 80% raises one toast', async ($, on) => {
  const toasts: string[] = []
  fakeEngine(on, toasts)
  await runSession($)

  expect(toasts).toEqual(['Weekly usage limit at 85%'])
})

test('/vitals pane opens the full history', async ($, on) => {
  fakeEngine(on)
  await runSession($)
  const answer = await $.command.run({ command: 'vitals', args: 'pane', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })

  expect(answer).toMatchObject({ text: 'Vitals pane opened.' })
})
