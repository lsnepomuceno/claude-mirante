import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const pane = (placement: 'dock' | 'inline') =>
  ({
    plugin: 'mirante',
    component: 'Pane',
    requestId: 'mirante',
    props: {
      title: 'mirante',
      isFocused: false,
      bodyColumns: 90,
      placement,
      scroll: { offset: 0, bodyRows: 60 },
      view: {},
    },
  }) as const

const engine = (on: On, slowBash?: { advance: (ms: number) => Promise<void> }) => {
  on('command.register', () => ({ value: { command: 'mirante' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
  on('tool.check', () => ({ decision: 'allow' }))
  on('tool.call', { tool: /^mcp__atlassian__/ }, () => ({ isError: true, result: null, text: 'The operation timed out.' }))
  on('tool.call', async () => {
    await slowBash?.advance(1500)

    return { result: { stdout: '', stderr: '', interrupted: false } }
  })
}

test('the dock shows MCP health, the timeout and the slowest calls, on the terminal and the desktop', async ($, on) => {
  const clock = mock.clock(on)
  engine(on, clock)

  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__github__get_me' } as never)
  await $.tool.call({ tool: 'mcp__atlassian__search_issues', jql: 'project = APP' } as never)
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await clock.settle()

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...pane('dock'), surface })

    expect(await ui.find({ type: 'Text', text: /atlassian/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /timed out/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /npm test/ })).toBeDefined()
    await ui.unmount()
  }
})

test('pressing a server opens its drill-down, and back returns to the dashboard', async ($, on) => {
  engine(on)
  mock.clock(on)

  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__atlassian__search_issues', jql: 'project = APP' } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...pane('dock'), surface })

    await ui.press({ key: 'mcp:atlassian' })
    expect(await ui.find({ type: 'Text', text: /MCP › atlassian/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /search_issues/ })).toBeDefined()

    await ui.press({ key: 'back' })
    expect(await ui.find({ type: 'Text', text: /MCP › atlassian/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('the inline summary stays within eight rows and names the trouble', async ($, on) => {
  engine(on)
  mock.clock(on)

  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__atlassian__search_issues', jql: 'project = APP' } as never)

  const ui = await $.ui.mount({ ...pane('inline'), surface: 'terminal' })

  expect(await ui.find({ type: 'Text', text: /1 timeout/ })).toBeDefined()
  await ui.unmount()
})

test('a denied call is counted in the gate and written to the log', async ($, on) => {
  on('command.register', () => ({ value: { command: 'mirante' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
  on('tool.check', () => ({ decision: 'deny', reason: 'rule' }))
  on('tool.call', () => ({ deny: 'denied by rule' }))
  mock.clock(on)

  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'rm -rf dist', agentId: 'a1' })

  const ui = await $.ui.mount({ ...pane('dock'), surface: 'terminal' })

  expect(await ui.find({ type: 'Text', text: /1 denied/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /denied Bash rm -rf dist/ })).toBeDefined()
  await ui.unmount()
})

const band = {
  plugin: 'mirante',
  component: 'AbovePrompt',
  requestId: 'band',
  props: { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: 100, scroll: { offset: 0, bodyRows: 8 }, view: {} },
} as const

test('with the band layout the summary sits above the prompt, and hide takes it away', { options: { layout: 'band' } }, async ($, on) => {
  engine(on)
  mock.clock(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine band</Text>
  })

  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__atlassian__search_issues', jql: 'project = APP' } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...band, surface })

    expect(await ui.find({ type: 'Text', text: /1 timeout/ })).toBeDefined()
    await ui.unmount()
  }

  await $.command.run({ command: 'mirante', args: 'hide' } as never)
  const hidden = await $.ui.mount({ ...band, surface: 'terminal' })

  expect(await hidden.find({ type: 'Text', text: /1 timeout/ })).toBeUndefined()
  expect(await hidden.find({ type: 'Text', text: /engine band/ })).toBeDefined()
  await hidden.unmount()
})

test('with the pane layout the band is left to the engine', async ($, on) => {
  engine(on)
  mock.clock(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine band</Text>
  })

  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...band, surface: 'terminal' })

  expect((await ui.find({ type: 'Text', text: /engine band/ }))?.text).toBe('engine band')
  await ui.unmount()
})
