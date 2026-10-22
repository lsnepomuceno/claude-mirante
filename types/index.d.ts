export type RateLimit = { kind: string; percent: number; resetsAt: string | null }

export type Main = {
  sessionStartedAt: number | null
  model: string | null
  effort: string | null
  requests: number
  contextTokens: number | null
  contextWindow: number | null
  contextPercent: number | null
  contextAfterTurn: number[]
  compactions: number
  costUsd: number | null
  lastTurnCostUsd: number | null
  cacheReadTokens: number
  inputTokens: number
  ttftMs: number | null
  tokensPerSecond: number | null
  rateLimits: RateLimit[]
}

export type FileChange = { path: string; added: number; removed: number }

export type HookRun = {
  name: string
  isOk: boolean
  ms: number
  detail: string | null
  at: number
}

export type Repo = {
  cwd: string | null
  root: string | null
  repository: string | null
  worktree: string | null
  isWorktree: boolean
  branch: string | null
  upstream: string | null
  ahead: number | null
  behind: number | null
  files: FileChange[]
  untracked: number
  stashes: number
  hooks: HookRun[]
  error: string | null
  refreshedAt: number | null
}

export type McpCall = {
  tool: string
  ms: number
  isOk: boolean
  isTimeout: boolean
  at: number
  detail: string | null
}

export type McpServer = { name: string; calls: McpCall[]; total: number }

export type SlowCall = {
  id: string
  kind: string
  label: string
  ms: number
  isFailed: boolean
}

export type Span = [number, number]

export type Slow = { calls: SlowCall[]; spans: Span[] }

export type AgentCard = {
  id: string
  agentId: string | null
  label: string
  type: string
  isBackground: boolean
  startedAt: number
  endedAt: number | null
  steps: number
  contextTokens: number
  outputTokens: number
  isFailed: boolean
  hitMaxTokens: boolean
}

export type Verdict = 'rule' | 'approved' | 'pending' | 'denied'

export type Check = {
  id: string
  tool: string
  verdict: Verdict
  isSubagent: boolean
}

export type Turn = {
  id: string | null
  startedAt: number | null
  endedAt: number | null
  agents: number
  edits: number
  errors: number
  costAtStartUsd: number | null
}

export type LogKind = 'prompt' | 'spawn' | 'done' | 'edit' | 'error' | 'denied' | 'compact' | 'hook'

export type LogLine = { at: number; kind: LogKind; text: string }

export type View = { server: string | null }

declare module 'claude-code' {
  interface PluginState {
    mirante: {
      main: Main
      repo: Repo
      mcp: McpServer[]
      slow: Slow
      agents: AgentCard[]
      checks: Check[]
      turn: Turn
      log: LogLine[]
      view: View
    }
  }
}
