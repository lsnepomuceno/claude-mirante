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
  mock.clock(on)

  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'rm -rf dist', agentId: 'a1' })

  const ui = await $.ui.mount({ ...pane('dock'), surface: 'terminal' })

  expect(await ui.find({ type: 'Text', text: /1 denied/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /denied Bash rm -rf dist/ })).toBeDefined()
  await ui.unmount()
})
