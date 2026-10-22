import type {
  AgentCard,
  Check,
  FileChange,
  LogKind,
  LogLine,
  Main,
  McpCall,
  McpServer,
  Repo,
  SlowCall,
  Turn,
  Verdict,
} from '../types'

export const PANELS = ['main', 'repo', 'mcp', 'slowest', 'agents', 'gate', 'turn', 'log'] as const
export type Panel = (typeof PANELS)[number]

export const ACCENTS = {
  blue: '#7AA2F7',
  amber: '#E5B454',
  green: '#5BD39A',
  violet: '#C49BFF',
} as const

export const COLORS = {
  ok: 'success',
  warn: 'warning',
  error: 'error',
  agent: 'merged',
  approved: 'suggestion',
  track: 'subtle',
  label: 'inactive',
} as const

export const SVG_COLORS = {
  ok: '#3FB97F',
  warn: '#D99A2B',
  error: '#E5534B',
  agent: '#A47BE8',
  approved: '#4C8DF6',
  quiet: '#3FB97F66',
  track: '#8A8F9A40',
} as const

export const LIMITS = {
  log: 200,
  checks: 400,
  callsPerServer: 200,
  slow: 10,
  agents: 30,
  hooks: 6,
  files: 40,
} as const

export type Config = {
  panels: Panel[]
  accent: string
  isGitOn: boolean
  slowest: number
  layout: 'pane' | 'band'
  openOnStart: boolean
  statusLine: boolean
}

export const readConfig = (options: Record<string, unknown>): Config => {
  const accentName = String(options.accent ?? 'blue') as keyof typeof ACCENTS
  const slowest = Number(options.slowest ?? 5)
  const isGitOn = options.git !== false

  return {
    panels: parsePanels(String(options.panels ?? PANELS.join(','))).filter(panel => isGitOn || panel !== 'repo'),
    accent: ACCENTS[accentName] ?? ACCENTS.blue,
    isGitOn,
    slowest: Number.isFinite(slowest) ? Math.min(10, Math.max(1, Math.round(slowest))) : 5,
    layout: options.layout === 'band' ? 'band' : 'pane',
    openOnStart: options.openOnStart !== false,
    statusLine: options.statusLine === true,
  }
}

export const parsePanels = (text: string): Panel[] => {
  const known = new Set<string>(PANELS)
  const picked = text
    .split(',')
    .map(name => name.trim().toLowerCase())
    .filter((name): name is Panel => known.has(name))

  return picked.length > 0 ? [...new Set(picked)] : [...PANELS]
}


export const emptyMain = (): Main => ({
  sessionStartedAt: null,
  model: null,
  effort: null,
  requests: 0,
  contextTokens: null,
  contextWindow: null,
  contextPercent: null,
  contextAfterTurn: [],
  compactions: 0,
  costUsd: null,
  lastTurnCostUsd: null,
  cacheReadTokens: 0,
  inputTokens: 0,
  ttftMs: null,
  tokensPerSecond: null,
  rateLimits: [],
})

export const emptyRepo = (): Repo => ({
  cwd: null,
  root: null,
  repository: null,
  worktree: null,
  isWorktree: false,
  branch: null,
  upstream: null,
  ahead: null,
  behind: null,
  files: [],
  untracked: 0,
  stashes: 0,
  hooks: [],
  error: null,
  refreshedAt: null,
})

export const emptyTurn = (): Turn => ({
  id: null,
  startedAt: null,
  endedAt: null,
  agents: 0,
  edits: 0,
  errors: 0,
  costAtStartUsd: null,
})


export const formatMs = (ms: number): string => {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`
  }

  const seconds = ms / 1000

  if (seconds < 10) {
    return `${seconds.toFixed(1)}s`
  }

  if (seconds < 60) {
    return `${Math.round(seconds)}s`
  }

  const whole = Math.round(seconds)
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const rest = String(whole % 60).padStart(2, '0')

  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`
}

export const formatTokens = (count: number): string => {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(count >= 10_000_000 ? 0 : 1)}M`
  }

  if (count >= 1000) {
    return `${(count / 1000).toFixed(count >= 10_000 ? 0 : 1)}k`
  }

  return String(Math.round(count))
}

export const formatUsd = (usd: number): string => (usd >= 100 ? `$${usd.toFixed(0)}` : `$${usd.toFixed(2)}`)

export const formatClock = (at: number): string => {
  const date = new Date(at)

  return [date.getHours(), date.getMinutes(), date.getSeconds()].map(part => String(part).padStart(2, '0')).join(':')
}

export const formatReset = (resetsAt: string | null, now: number): string | null => {
  if (resetsAt === null) {
    return null
  }

  const left = Date.parse(resetsAt) - now

  if (!Number.isFinite(left) || left <= 0) {
    return null
  }

  const minutes = Math.round(left / 60_000)

  if (minutes < 60) {
    return `${minutes}m`
  }

  const hours = Math.floor(minutes / 60)

  return hours < 48 ? `${hours}h${String(minutes % 60).padStart(2, '0')}` : `${Math.round(hours / 24)}d`
}

export const shorten = (text: string, room: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim()

  return flat.length <= room ? flat : `${flat.slice(0, Math.max(1, room - 1))}…`
}

export const bar = (fraction: number, width: number): { on: string; off: string } => {
  const size = Math.max(1, Math.round(width))
  const on = Math.min(size, Math.max(0, Math.round(clamp01(fraction) * size)))

  return { on: '█'.repeat(on), off: '░'.repeat(size - on) }
}

const SPARK = '▁▂▃▄▅▆▇█'

export const spark = (values: readonly number[], ceiling: number): string =>
  values
    .map(value => SPARK[Math.min(SPARK.length - 1, Math.floor(clamp01(value / ceiling) * (SPARK.length - 1)))] ?? '▁')
    .join('')

export const clamp01 = (value: number): number => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0)

export const percentile = (values: readonly number[], p: number): number | null => {
  if (values.length === 0) {
    return null
  }

  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))

  return sorted[rank] ?? null
}


const SECRET_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(authorization|proxy-authorization)(\s*[:=]\s*)(?:(basic|bearer|token)\s+)?[^\s"',]+/gi, '$1$2$3 •••'],
  [/\b(bearer)\s+[\w.~+/-]{6,}=*/gi, '$1 •••'],
  [/\b(?:sk|pk|rk)-[\w-]{10,}/g, '•••'],
  [/\b(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{10,}/g, '•••'],
  [/\bgithub_pat_[A-Za-z0-9_]{10,}/g, '•••'],
  [/\bxox[abposr]-[\w-]{8,}/g, '•••'],
  [/\b(?:AKIA|ASIA)[A-Z0-9]{12,}/g, '•••'],
  [/\b((?:[A-Za-z_][\w-]*?)?(?:token|secret|password|passwd|pwd|api[_-]?key|access[_-]?key|private[_-]?key)\w*)(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s&;]+)/gi, '$1$2•••'],
  [/(--(?:token|password|passwd|secret|api-key|auth)(?:=|\s+))(\S+)/gi, '$1•••'],
  [/(\s-u\s+|--user(?:=|\s+))(["']?)([^\s:"']+):([^\s"']+)\2/g, '$1$2$3:•••$2'],
  [/\b([a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s/@]+@/gi, '$1•••@'],
]

export const redact = (text: string): string =>
  SECRET_PATTERNS.reduce((masked, [pattern, replacement]) => masked.replace(pattern, replacement), text)


export const basename = (path: string): string => {
  const trimmed = path.replace(/\/+$/, '')

  return trimmed.slice(trimmed.lastIndexOf('/') + 1) || trimmed
}

export const dirname = (path: string): string => {
  const trimmed = path.replace(/\/+$/, '')
  const cut = trimmed.lastIndexOf('/')

  return cut <= 0 ? '/' : trimmed.slice(0, cut)
}

export const resolvePath = (base: string, path: string, home: string | null): string => {
  const expanded = path === '~' || path.startsWith('~/') ? (home === null ? path : home + path.slice(1)) : path
  const joined = expanded.startsWith('/') ? expanded : `${base.replace(/\/+$/, '')}/${expanded}`
  const parts: string[] = []

  for (const part of joined.split('/')) {
    if (part === '' || part === '.') {
      continue
    }

    if (part === '..') {
      parts.pop()
    } else {
      parts.push(part)
    }
  }

  return `/${parts.join('/')}`
}

const unquote = (word: string): string => word.replace(/^(["'])(.*)\1$/, '$2')

export const cwdFromCommand = (command: string, cwd: string, home: string | null): string | null => {
  const match = /^\s*cd\s+("[^"]+"|'[^']+'|[^\s;&|]+)\s*(?:&&|;|$)/.exec(command)

  if (match === null || match[1] === undefined) {
    return null
  }

  const target = unquote(match[1])

  return target === '-' ? null : resolvePath(cwd, target, home)
}

export type GitAction = { action: 'commit' | 'push'; dir: string | null }

export const gitActionOf = (command: string): GitAction | null => {
  const match = /(?:^|&&|;|\|\|)\s*(?:[A-Z_][A-Z0-9_]*=\S*\s+)*git\s+(?:-C\s+("[^"]+"|'[^']+'|\S+)\s+)?(?:-c\s+\S+\s+)*(commit|push)(?=\s|$)/.exec(command)

  if (match === null) {
    return null
  }

  return { action: match[2] === 'push' ? 'push' : 'commit', dir: match[1] === undefined ? null : unquote(match[1]) }
}

const HOOK_NAMES = ['pre-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit', 'pre-push'] as const

export const hookRunOf = (
  action: GitAction['action'],
  output: string,
  isError: boolean,
  ms: number,
  at: number,
): { name: string; isOk: boolean; ms: number; detail: string | null; at: number } => {
  const lower = output.toLowerCase()
  const mentioned = HOOK_NAMES.filter(name => lower.includes(name))
  const failedHook = isError ? mentioned.find(name => new RegExp(`${name}[^\\n]*(fail|error|exit)`, 'i').test(output)) : undefined
  const name = failedHook ?? (action === 'push' ? 'pre-push' : 'pre-commit')
  const reason = isError
    ? output
        .split('\n')
        .map(line => line.replace(/\x1b\[[0-9;]*m/g, '').trim())
        .find(line => /error|fail|denied|rejected|fatal/i.test(line) && !/^\s*$/.test(line))
    : undefined

  return {
    name: mentioned.length > 0 || isError ? name : `git ${action}`,
    isOk: !isError,
    ms,
    detail: reason === undefined ? null : shorten(redact(reason), 60),
    at,
  }
}


export type RevParse = {
  root: string
  branch: string
  gitDir: string
  commonDir: string
}

export const parseRevParse = (stdout: string, cwd: string): RevParse | null => {
  const [root, branch, gitDir, commonDir] = stdout.split('\n').map(line => line.trim())

  if (!root || !branch || !gitDir || !commonDir) {
    return null
  }

  return {
    root,
    branch,
    gitDir: resolvePath(cwd, gitDir, null),
    commonDir: resolvePath(cwd, commonDir, null),
  }
}

export const repositoryOf = (parsed: RevParse): { repository: string; worktree: string; isWorktree: boolean } => {
  const isWorktree = parsed.gitDir !== parsed.commonDir
  const commonParent = basename(parsed.commonDir) === '.git' ? basename(dirname(parsed.commonDir)) : basename(parsed.commonDir).replace(/\.git$/, '')

  return {
    repository: isWorktree ? commonParent : basename(parsed.root),
    worktree: basename(parsed.root),
    isWorktree,
  }
}

export const parseAheadBehind = (stdout: string): { behind: number; ahead: number } | null => {
  const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(stdout)

  return match === null ? null : { behind: Number(match[1]), ahead: Number(match[2]) }
}

export const parseNumstat = (stdout: string): FileChange[] =>
  stdout
    .split('\n')
    .map(line => line.split('\t'))
    .filter((parts): parts is [string, string, string] => parts.length >= 3 && parts[2] !== '')
    .map(([added, removed, path]) => ({
      path: renamedPath(path),
      added: added === '-' ? 0 : Number(added) || 0,
      removed: removed === '-' ? 0 : Number(removed) || 0,
    }))
    .sort((a, b) => b.added + b.removed - (a.added + a.removed))

const renamedPath = (path: string): string => {
  const braces = /^(.*)\{[^}]* => ([^}]*)\}(.*)$/.exec(path)

  if (braces !== null) {
    return `${braces[1] ?? ''}${braces[2] ?? ''}${braces[3] ?? ''}`.replace(/\/\//g, '/')
  }

  const arrow = path.split(' => ')

  return arrow[arrow.length - 1] ?? path
}

export const countLines = (stdout: string): number => stdout.split('\n').filter(line => line.trim() !== '').length


export const parseMcpTool = (tool: string): { server: string; tool: string } | null => {
  if (!tool.startsWith('mcp__')) {
    return null
  }

  const rest = tool.slice(5)
  const cut = rest.indexOf('__')

  if (cut <= 0) {
    return null
  }

  return { server: rest.slice(0, cut), tool: rest.slice(cut + 2) }
}

export const displayServer = (server: string): string => {
  if (!server.startsWith('plugin_')) {
    return server
  }

  const parts = server.slice(7).split('_')

  return parts[parts.length - 1] || server
}

export const isTimeoutText = (text: string): boolean => /timed?\s*out|timeout|deadline exceeded/i.test(text)

export type ServerHealth = 'ok' | 'degraded' | 'down'

export const healthOf = (calls: readonly McpCall[]): ServerHealth => {
  const recent = calls.slice(-5)
  const lastThree = calls.slice(-3)

  if (lastThree.length === 3 && lastThree.every(call => !call.isOk)) {
    return 'down'
  }

  return recent.some(call => !call.isOk) ? 'degraded' : 'ok'
}

export const recordMcpCall = (servers: readonly McpServer[], name: string, call: McpCall): McpServer[] => {
  const known = servers.find(server => server.name === name)

  if (known === undefined) {
    return [...servers, { name, calls: [call], total: 1 }]
  }

  return servers.map(server =>
    server === known
      ? { ...server, calls: [...server.calls, call].slice(-LIMITS.callsPerServer), total: server.total + 1 }
      : server,
  )
}

export type ServerSummary = {
  name: string
  label: string
  total: number
  errors: number
  timeouts: number
  p50: number | null
  p95: number | null
  max: number | null
  health: ServerHealth
  lastError: McpCall | null
}

export const summarizeServer = (server: McpServer): ServerSummary => {
  const durations = server.calls.map(call => call.ms)
  const failed = server.calls.filter(call => !call.isOk)

  return {
    name: server.name,
    label: displayServer(server.name),
    total: server.total,
    errors: failed.length,
    timeouts: failed.filter(call => call.isTimeout).length,
    p50: percentile(durations, 50),
    p95: percentile(durations, 95),
    max: durations.length === 0 ? null : Math.max(...durations),
    health: healthOf(server.calls),
    lastError: failed[failed.length - 1] ?? null,
  }
}

export type ToolSummary = { tool: string; calls: number; p50: number | null; max: number | null; errors: number }

export const summarizeTools = (server: McpServer): ToolSummary[] => {
  const byTool = new Map<string, McpCall[]>()

  for (const call of server.calls) {
    byTool.set(call.tool, [...(byTool.get(call.tool) ?? []), call])
  }

  return [...byTool.entries()]
    .map(([tool, calls]) => ({
      tool,
      calls: calls.length,
      p50: percentile(
        calls.map(call => call.ms),
        50,
      ),
      max: Math.max(...calls.map(call => call.ms)),
      errors: calls.filter(call => !call.isOk).length,
    }))
    .sort((a, b) => b.calls - a.calls)
}


const WEB_TOOLS = new Set(['WebFetch', 'WebSearch'])
export const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])

export const describeCall = (tool: string, input: Record<string, unknown>): { kind: string; label: string } => {
  const mcp = parseMcpTool(tool)

  if (mcp !== null) {
    return { kind: 'MCP', label: `${displayServer(mcp.server)}.${mcp.tool}` }
  }

  if (tool === 'Bash' || tool === 'PowerShell') {
    const command = String(input.command ?? '')
    const withoutCd = command.replace(/^\s*cd\s+("[^"]+"|'[^']+'|\S+)\s*(?:&&|;)\s*/, '')

    return { kind: 'Bash', label: redact(shorten(withoutCd, 120)) }
  }

  if (tool === 'Agent' || tool === 'Task') {
    return { kind: 'Agent', label: String(input.description ?? input.subagent_type ?? 'subagent') }
  }

  if (WEB_TOOLS.has(tool)) {
    const target = String(input.url ?? input.query ?? '')

    return { kind: 'Web', label: redact(hostOf(target) ?? shorten(target, 120)) }
  }

  const path = input.file_path ?? input.path ?? input.pattern

  return { kind: tool, label: typeof path === 'string' ? redact(path) : tool }
}

const hostOf = (url: string): string | null => {
  const match = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:?#]+)/i.exec(url)

  return match?.[1] ?? null
}

export const busyMs = (spans: readonly (readonly [number, number])[]): number => {
  const sorted = [...spans].sort((a, b) => a[0] - b[0])
  let total = 0
  let open: [number, number] | null = null

  for (const [start, end] of sorted) {
    if (open !== null && start <= open[1]) {
      open[1] = Math.max(open[1], end)
    } else {
      total += open === null ? 0 : open[1] - open[0]
      open = [start, end]
    }
  }

  return total + (open === null ? 0 : open[1] - open[0])
}

export const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

export const recordSlow = (calls: readonly SlowCall[], call: SlowCall): SlowCall[] =>
  [...calls.filter(known => known.id !== call.id), call].sort((a, b) => b.ms - a.ms).slice(0, LIMITS.slow)


export const verdictOf = (decision: string): Verdict => {
  if (decision === 'allow') {
    return 'rule'
  }

  return decision === 'deny' ? 'denied' : 'pending'
}

export const recordCheck = (checks: readonly Check[], check: Check): Check[] =>
  [...checks.filter(known => known.id !== check.id), check].slice(-LIMITS.checks)

export const settleCheck = (checks: readonly Check[], id: string, isDenied: boolean): Check[] =>
  checks.map(check => {
    if (check.id !== id || check.verdict === 'rule' || check.verdict === 'denied') {
      return check
    }

    return { ...check, verdict: isDenied ? 'denied' : 'approved' }
  })

export type GateTotals = { rule: number; approved: number; pending: number; denied: number; byTool: [string, number][] }

export const gateTotals = (checks: readonly Check[]): GateTotals => {
  const byTool = new Map<string, number>()
  const totals = { rule: 0, approved: 0, pending: 0, denied: 0 }

  for (const check of checks) {
    totals[check.verdict] += 1
    const family = parseMcpTool(check.tool) === null ? check.tool : 'MCP'
    byTool.set(family, (byTool.get(family) ?? 0) + 1)
  }

  return { ...totals, byTool: [...byTool.entries()].sort((a, b) => b[1] - a[1]) }
}


export const recordAgent = (agents: readonly AgentCard[], card: AgentCard): AgentCard[] =>
  [...agents.filter(known => known.id !== card.id), card].slice(-LIMITS.agents)

export const updateAgent = (
  agents: readonly AgentCard[],
  match: (card: AgentCard) => boolean,
  change: (card: AgentCard) => AgentCard,
): AgentCard[] => agents.map(card => (match(card) ? change(card) : card))


export type StepUsage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

export const contextOf = (usage: StepUsage): number =>
  usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens

export const cacheHitPercent = (main: Main): number | null =>
  main.inputTokens === 0 ? null : Math.round((main.cacheReadTokens / main.inputTokens) * 100)

export const turnsUntilFull = (main: Main): number | null => {
  const history = main.contextAfterTurn.slice(-6)

  if (history.length < 3 || main.contextTokens === null || main.contextWindow === null) {
    return null
  }

  const growth = history.slice(1).map((value, index) => value - (history[index] ?? value))
  const rising = growth.filter(delta => delta > 0)

  if (rising.length === 0) {
    return null
  }

  const average = rising.reduce((sum, delta) => sum + delta, 0) / growth.length

  if (average <= 0) {
    return null
  }

  return Math.max(0, Math.floor((main.contextWindow - main.contextTokens) / average))
}


export const TYPOGRAPHY_SINCE = '2.1.307'

export const isAtLeast = (version: string, wanted: string): boolean => {
  const parse = (text: string) => (/^(\d+)\.(\d+)\.(\d+)/.exec(text) ?? []).slice(1, 4).map(Number)
  const have = parse(version)
  const need = parse(wanted)

  if (have.length < 3) {
    return false
  }

  for (let index = 0; index < 3; index += 1) {
    if ((have[index] ?? 0) !== (need[index] ?? 0)) {
      return (have[index] ?? 0) > (need[index] ?? 0)
    }
  }

  return true
}

export const isHandBack = (text: string): boolean => /^\s*<(agent-message|task-notification|teammate-message)\b/.test(text)

export const pushLog = (log: readonly LogLine[], at: number, kind: LogKind, text: string): LogLine[] =>
  [...log, { at, kind, text: redact(shorten(text, 160)) }].slice(-LIMITS.log)
