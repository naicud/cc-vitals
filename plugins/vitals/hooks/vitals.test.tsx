import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { count, hitRate, prettyModel, tokenParts } from './format'

const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 20,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
}

const TURN_USAGE = {
  model: 'claude-opus-5-5',
  input_tokens: 1200,
  output_tokens: 3400,
  cache_read_input_tokens: 640_000,
  cache_creation_input_tokens: 18_000,
}

// What the engine answers beneath the mod: a session on main with two changed files,
// 680k of a 1M window, both plan limits and $4.21 spent, effort set to high in /config.
const fakeEngine = (on: On, toasts: string[] = []) => {
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('session.usage', () => ({ value: {
    startedAt: 0,
    context: { tokens: 680_000, window: 1_000_000, percent: 68 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 42 },
      { kind: 'seven_day', percentUsed: 85 },
    ],
    cost: { usd: 4.21 },
  } }))
  on('session.cwd', () => ({ value: '/work/cc-vitals' }))
  on('session.turns', () => ({ value: 12 }))
  on('session.model', () => ({ value: 'claude-opus-5-5[1m]' }))
  on('agent.list', () => ({ value: [] }))
  on('clock.now', () => ({ value: 1_000_000 }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.after', () => ({ value: undefined }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('config.list', () => ({ value: [
    { key: 'effort', label: 'Effort', kind: 'choice' as const, value: 'high', provider: { plugin: 'core', tier: 'core' as const }, isLocked: false },
  ] }))
  on('process.run', ($, e) => ({ value: {
    exitCode: 0,
    stdout: e.argv[1] === 'status' ? '# branch.head main\n1 .M N... a\n1 .M N... b' : '.git\n.git',
    stderr: '',
    isStdoutTruncated: false,
    isStderrTruncated: false,
  } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.complete', ($, e) => ({ text: e.answer, usage: e.usage }))
}

const runTurn = async ($: Engine) => {
  await $.session.start({ cwd: '/work/cc-vitals', surface: 'terminal', isInteractive: true })
  await $.turn.complete({ answer: 'ok', durationMs: 12_000, isAborted: false, turnId: 't1', usage: TURN_USAGE, reason: 'answer' })
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

test('token parts flag a low cache hit', () => {
  const parts = tokenParts({ input: 9000, output: 10, cacheRead: 1000, cacheWrite: 0 })
  expect(parts.at(-1)).toEqual({ text: 'hit 10%', emphasis: 'warning' })
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: full band shows model, effort, context, limits and token split`, async ($, on) => {
    fakeEngine(on)
    await runTurn($)

    const ui = await $.ui.mount({ plugin: 'vitals', surface, component: 'AbovePrompt', props: PROPS })
    const expected = [
      '📁 cc-vitals   🌿 main   ● 2 changed',
      '◆ Opus 5.5',
      'effort high',
      '68%',
      '680k / 1M',
      'Weekly',
      '85%',
      'in 1.2k',
      'out 3.4k',
      'cache read 640k',
      'write 18k',
      'hit 97%',
      '1 turn',
    ]
    const band = (await ui.find({ text: /./ }))?.text ?? ''
    for (const text of expected) {
      expect(band).toContain(text)
    }
  })

  test(`${surface}: a plan limit past 80% raises one toast`, async ($, on) => {
    const toasts: string[] = []
    fakeEngine(on, toasts)
    await runTurn($)

    expect(toasts).toEqual(['Weekly usage limit at 85%'])
  })


  test(`${surface}: /vitals switches to one compact line`, async ($, on) => {
    fakeEngine(on)
    await runTurn($)
    await $.command.run({
      command: 'vitals',
      args: '',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 120 },
    })

    const ui = await $.ui.mount({ plugin: 'vitals', surface, component: 'AbovePrompt', props: PROPS })

    const band = (await ui.find({ text: /./ }))?.text ?? ''
    expect(band).toBe('◆ Opus 5.5 · effort high · ctx 68% · 5h 42% · 7d 85% · hit 97% · $4.21')
  })
}
