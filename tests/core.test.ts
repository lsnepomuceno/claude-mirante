import { describe, expect, test } from 'claude-code/testing'

import {
  busyMs,
  cwdFromCommand,
  describeCall,
  displayServer,
  formatMs,
  gitActionOf,
  healthOf,
  hookRunOf,
  isAtLeast,
  isHandBack,
  parseAheadBehind,
  parseMcpTool,
  parseNumstat,
  parseRevParse,
  percentile,
  readConfig,
  redact,
  repositoryOf,
  settleCheck,
  turnsUntilFull,
  emptyMain,
} from '../hooks/core'

describe('redact', () => {
  test('masks credentials in commands before they are kept', async () => {
    expect(redact('curl -H "Authorization: Bearer abc.def.ghi" https://api.example.com')).not.toContain('abc.def.ghi')
    expect(redact('GITHUB_TOKEN=ghp_0123456789abcdefABCDEF npm publish')).not.toContain('ghp_0123456789')
    expect(redact('curl -u me@example.com:s3cr3tvalue https://x')).toContain('me@example.com:•••')
    expect(redact('git clone https://user:hunter2@github.com/a/b')).toBe('git clone https://user:•••@github.com/a/b')
    expect(redact('mysql --password=topsecret')).toBe('mysql --password=•••')
    expect(redact('export AWS_SECRET_ACCESS_KEY="wJalrXUtnFEMI"')).not.toContain('wJalrXUtnFEMI')
  })

  test('leaves ordinary commands alone', async () => {
    expect(redact('npm test -- --watch=false')).toBe('npm test -- --watch=false')
    expect(redact('git push origin feat/token-refresh')).toBe('git push origin feat/token-refresh')
  })
})

describe('shell', () => {
  test('follows a leading cd, relative, absolute and home', async () => {
    expect(cwdFromCommand('cd api && npm test', '/work', '/home/me')).toBe('/work/api')
    expect(cwdFromCommand('cd /srv/app; ls', '/work', null)).toBe('/srv/app')
    expect(cwdFromCommand('cd ~/code/../site && make', '/work', '/home/me')).toBe('/home/me/site')
    expect(cwdFromCommand('cd "my dir" && ls', '/work', null)).toBe('/work/my dir')
    expect(cwdFromCommand('ls && cd api', '/work', null)).toBeNull()
  })

  test('recognizes commits and pushes, with -C and env prefixes', async () => {
    expect(gitActionOf('git commit -m "x"')).toEqual({ action: 'commit', dir: null })
    expect(gitActionOf('cd api && HUSKY=0 git push -u origin main')).toEqual({ action: 'push', dir: null })
    expect(gitActionOf('git -C ../api push')).toEqual({ action: 'push', dir: '../api' })
    expect(gitActionOf('git commit-tree abc')).toBeNull()
    expect(gitActionOf('echo git push')).toBeNull()
  })

  test('names the hook that failed and the line that says why', async () => {
    const output = 'husky - pre-push script failed (code 1)\nsrc/a.ts:3:1 error Unexpected any\n'
    const hook = hookRunOf('push', output, true, 48_000, 1)

    expect(hook.name).toBe('pre-push')
    expect(hook.isOk).toBe(false)
    expect(hook.detail).toContain('pre-push script failed')
  })
})

describe('git output', () => {
  test('tells a linked worktree from the main checkout', async () => {
    const linked = parseRevParse('/code/api-review\nfeat/x\n/code/api/.git/worktrees/api-review\n/code/api/.git\n', '/code/api-review')
    const main = parseRevParse('/code/api\nmain\n.git\n.git\n', '/code/api')

    expect(linked && repositoryOf(linked)).toEqual({ repository: 'api', worktree: 'api-review', isWorktree: true })
    expect(main && repositoryOf(main)).toEqual({ repository: 'api', worktree: 'api', isWorktree: false })
  })

  test('reads numstat with renames and binary files, largest first', async () => {
    const files = parseNumstat('3\t1\tsrc/a.ts\n-\t-\tlogo.png\n10\t2\tsrc/{old => new}/b.ts\n')

    expect(files.map(file => file.path)).toEqual(['src/new/b.ts', 'src/a.ts', 'logo.png'])
    expect(files[2]).toEqual({ path: 'logo.png', added: 0, removed: 0 })
  })

  test('reads behind and ahead in that order', async () => {
    expect(parseAheadBehind('2\t5\n')).toEqual({ behind: 2, ahead: 5 })
    expect(parseAheadBehind('fatal: no upstream')).toBeNull()
  })
})

describe('mcp', () => {
  test('splits server and tool, keeping underscores in the tool', async () => {
    expect(parseMcpTool('mcp__github__get_me')).toEqual({ server: 'github', tool: 'get_me' })
    expect(parseMcpTool('mcp__aws-api__aws___run_script')).toEqual({ server: 'aws-api', tool: 'aws___run_script' })
    expect(parseMcpTool('Bash')).toBeNull()
    expect(displayServer('plugin_github_github')).toBe('github')
  })

  test('health turns degraded on a recent failure and down on three in a row', async () => {
    const call = (isOk: boolean) => ({ tool: 't', ms: 10, isOk, isTimeout: false, at: 0, detail: null })

    expect(healthOf([call(true), call(true)])).toBe('ok')
    expect(healthOf([call(true), call(false), call(true)])).toBe('degraded')
    expect(healthOf([call(true), call(false), call(false), call(false)])).toBe('down')
  })

  test('describes calls by kind, without credentials', async () => {
    expect(describeCall('mcp__plugin_github_github__list_issues', {})).toEqual({ kind: 'MCP', label: 'github.list_issues' })
    expect(describeCall('Bash', { command: 'cd api && TOKEN=abc123456 npm test' }).label).toBe('TOKEN=••• npm test')
    expect(describeCall('WebFetch', { url: 'https://docs.example.com/a?b=1' })).toEqual({ kind: 'Web', label: 'docs.example.com' })
  })
})

describe('numbers', () => {
  test('formats durations the way the panels show them', async () => {
    expect(formatMs(420)).toBe('420ms')
    expect(formatMs(8_200)).toBe('8.2s')
    expect(formatMs(41_000)).toBe('41s')
    expect(formatMs(108_000)).toBe('1:48')
    expect(formatMs(4_360_000)).toBe('1:12:40')
  })

  test('percentile picks the nearest rank', async () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3)
    expect(percentile([1, 2, 3, 4, 100], 95)).toBe(100)
    expect(percentile([], 50)).toBeNull()
  })

  test('estimates turns left only from real growth', async () => {
    const growing = { ...emptyMain(), contextTokens: 120_000, contextWindow: 200_000, contextAfterTurn: [90_000, 100_000, 110_000, 120_000] }
    const flat = { ...growing, contextAfterTurn: [120_000, 120_000, 120_000] }

    expect(turnsUntilFull(growing)).toBe(8)
    expect(turnsUntilFull(flat)).toBeNull()
    expect(turnsUntilFull({ ...growing, contextAfterTurn: [100_000, 110_000] })).toBeNull()
  })
})

describe('gate and config', () => {
  test('an asked check becomes approved when the call runs, denied when refused', async () => {
    const asked = [{ id: 'a', tool: 'Bash', verdict: 'pending' as const, isSubagent: false }]
    const allowed = [{ id: 'b', tool: 'Read', verdict: 'rule' as const, isSubagent: false }]

    expect(settleCheck(asked, 'a', false)[0]?.verdict).toBe('approved')
    expect(settleCheck(asked, 'a', true)[0]?.verdict).toBe('denied')
    expect(settleCheck(allowed, 'b', false)[0]?.verdict).toBe('rule')
  })

  test('turning git off hides the repo panel', async () => {
    expect(readConfig({ git: false }).panels).not.toContain('repo')
    expect(readConfig({ panels: 'log, mcp ,bogus' }).panels).toEqual(['log', 'mcp'])
    expect(readConfig({ slowest: 40 }).slowest).toBe(10)
  })
})

describe('tool time', () => {
  test('overlapping calls count once, gaps not at all', async () => {
    expect(busyMs([[0, 10], [5, 20], [30, 40]])).toBe(30)
    expect(busyMs([])).toBe(0)
  })
})

describe('turns', () => {
  test('a subagent hand-back continues the turn instead of starting one', async () => {
    expect(isHandBack('<agent-message from="a1"> [Subagent hand-back] done')).toBe(true)
    expect(isHandBack('<task-notification> build finished')).toBe(true)
    expect(isHandBack('review the <agent-message> parser')).toBe(false)
  })
})

describe('engine version', () => {
  test('compares versions part by part', async () => {
    expect(isAtLeast('2.1.308 (Claude Code)', '2.1.307')).toBe(true)
    expect(isAtLeast('2.1.295', '2.1.307')).toBe(false)
    expect(isAtLeast('2.2.0', '2.1.307')).toBe(true)
    expect(isAtLeast('unknown', '2.1.307')).toBe(false)
  })
})
