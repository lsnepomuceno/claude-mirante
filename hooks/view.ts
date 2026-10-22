import type { AgentCard, Check, LogLine, Main, McpServer, Repo, Slow, Turn, Verdict, View } from '../types'
import {
  busyMs,
  cacheHitPercent,
  formatMs,
  formatReset,
  formatTokens,
  formatUsd,
  gateTotals,
  summarizeServer,
  summarizeTools,
  turnsUntilFull,
} from './core'
import type { Config, GateTotals, Panel, ServerSummary, ToolSummary } from './core'

export type Snapshot = {
  main: Main
  repo: Repo
  mcp: McpServer[]
  slow: Slow
  agents: AgentCard[]
  checks: Check[]
  turn: Turn
  log: LogLine[]
  view: View
  now: number
}

export type LimitView = { label: string; fraction: number; percent: number; reset: string | null }

export type MainView = {
  model: string | null
  effort: string | null
  requests: number
  sessionTime: string | null
  context: { fraction: number; percent: number; used: string; window: string } | null
  compactions: number
  turnsLeft: number | null
  cost: string | null
  lastTurnCost: string | null
  cacheHit: number | null
  limits: LimitView[]
  ttft: string | null
  tokensPerSecond: number | null
}

export type RepoView = {
  repository: string
  worktree: string | null
  branch: string
  upstream: string | null
  ahead: number | null
  behind: number | null
  files: { path: string; added: number; removed: number; fraction: number }[]
  moreFiles: number
  added: number
  removed: number
  untracked: number
  stashes: number
  hooks: { name: string; isOk: boolean; time: string; detail: string | null }[]
}

export type McpRowView = ServerSummary & {
  p50Text: string
  p95Text: string
  durations: number[]
  failures: boolean[]
}

export type McpView = {
  servers: McpRowView[]
  calls: number
  timeouts: number
  lastTimeout: { server: string; tool: string; time: string; at: number } | null
}

export type SlowView = {
  rows: { kind: string; label: string; time: string; fraction: number; isFailed: boolean }[]
  toolTime: string
  turnTime: string | null
}

export type AgentView = {
  id: string
  label: string
  type: string
  state: 'running' | 'done' | 'failed'
  context: string
  output: string
  steps: number
  elapsed: string
  hitMaxTokens: boolean
}

export type AgentsView = { cards: AgentView[]; running: number; done: number }

export type GateView = { cells: { verdict: Verdict; isSubagent: boolean }[]; totals: GateTotals }

export type TurnView = {
  isRunning: boolean
  time: string
  agents: number
  edits: number
  errors: number
  cost: string | null
}

export type ServerDetailView = {
  summary: McpRowView
  tools: (ToolSummary & { p50Text: string; maxText: string })[]
  calls: { at: number; tool: string; ms: number; time: string; isOk: boolean; isTimeout: boolean }[]
  timeInServer: string
}

export type Dashboard = {
  panels: Panel[]
  main: MainView
  repo: RepoView | null
  mcp: McpView | null
  slow: SlowView | null
  agents: AgentsView | null
  gate: GateView | null
  turn: TurnView | null
  log: LogLine[]
  detail: ServerDetailView | null
}

const LIMIT_LABELS: Record<string, string> = {
  five_hour: '5h',
  seven_day: '7d',
  seven_day_opus: '7d opus',
  seven_day_sonnet: '7d sonnet',
}

const limitLabel = (kind: string): string => LIMIT_LABELS[kind] ?? kind.replace(/_/g, ' ')

export const buildMain = (main: Main, startedAt: number | null, now: number): MainView => {
  const percent =
    main.contextPercent ??
    (main.contextTokens !== null && main.contextWindow ? (main.contextTokens / main.contextWindow) * 100 : null)

  return {
    model: main.model === null ? null : shortModel(main.model),
    effort: main.effort,
    requests: main.requests,
    sessionTime: startedAt === null ? null : formatMs(Math.max(0, now - startedAt)),
    context:
      percent === null || main.contextWindow === null
        ? null
        : {
            fraction: percent / 100,
            percent: Math.round(percent),
            used: formatTokens(main.contextTokens ?? (percent / 100) * main.contextWindow),
            window: formatTokens(main.contextWindow),
          },
    compactions: main.compactions,
    turnsLeft: turnsUntilFull(main),
    cost: main.costUsd === null ? null : formatUsd(main.costUsd),
    lastTurnCost: main.lastTurnCostUsd === null ? null : `+${formatUsd(main.lastTurnCostUsd)}`,
    cacheHit: cacheHitPercent(main),
    limits: main.rateLimits.slice(0, 2).map(limit => ({
      label: limitLabel(limit.kind),
      fraction: limit.percent / 100,
      percent: Math.round(limit.percent),
      reset: formatReset(limit.resetsAt, now),
    })),
    ttft: main.ttftMs === null ? null : formatMs(main.ttftMs),
    tokensPerSecond: main.tokensPerSecond === null ? null : Math.round(main.tokensPerSecond),
  }
}

export const shortModel = (model: string): string => {
  const family = /claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/i.exec(model)

  if (family !== null) {
    return `${family[1]}-${family[2]}${family[3] === undefined ? '' : `.${family[3]}`}`
  }

  return model.replace(/^claude-/, '').replace(/\[[^\]]*\]$/, '')
}

export const buildRepo = (repo: Repo, fileRows: number): RepoView | null => {
  if (repo.repository === null || repo.branch === null) {
    return null
  }

  const largest = Math.max(1, ...repo.files.map(file => file.added + file.removed))

  return {
    repository: repo.repository,
    worktree: repo.isWorktree ? repo.worktree : null,
    branch: repo.branch,
    upstream: repo.upstream,
    ahead: repo.ahead,
    behind: repo.behind,
    files: repo.files.slice(0, fileRows).map(file => ({ ...file, fraction: (file.added + file.removed) / largest })),
    moreFiles: Math.max(0, repo.files.length - fileRows),
    added: repo.files.reduce((sum, file) => sum + file.added, 0),
    removed: repo.files.reduce((sum, file) => sum + file.removed, 0),
    untracked: repo.untracked,
    stashes: repo.stashes,
    hooks: latestHooks(repo).map(hook => ({ name: hook.name, isOk: hook.isOk, time: formatMs(hook.ms), detail: hook.detail })),
  }
}

const latestHooks = (repo: Repo) => {
  const seen = new Set<string>()

  return [...repo.hooks].reverse().filter(hook => (seen.has(hook.name) ? false : (seen.add(hook.name), true))).reverse()
}

const mcpRow = (server: McpServer): McpRowView => {
  const summary = summarizeServer(server)

  return {
    ...summary,
    p50Text: summary.p50 === null ? '·' : formatMs(summary.p50),
    p95Text: summary.p95 === null ? '·' : formatMs(summary.p95),
    durations: server.calls.map(call => call.ms),
    failures: server.calls.map(call => !call.isOk),
  }
}

export const buildMcp = (servers: readonly McpServer[], now: number): McpView | null => {
  if (servers.length === 0) {
    return null
  }

  const rows = servers.map(mcpRow).sort((a, b) => b.total - a.total)
  const timeouts = servers.flatMap(server => server.calls.filter(call => call.isTimeout).map(call => ({ server, call })))
  const last = timeouts.sort((a, b) => a.call.at - b.call.at)[timeouts.length - 1]

  return {
    servers: rows,
    calls: rows.reduce((sum, row) => sum + row.total, 0),
    timeouts: rows.reduce((sum, row) => sum + row.timeouts, 0),
    lastTimeout:
      last === undefined || now - last.call.at > 15 * 60_000
        ? null
        : { server: rows.find(row => row.name === last.server.name)?.label ?? last.server.name, tool: last.call.tool, time: formatMs(last.call.ms), at: last.call.at },
  }
}

export const buildServerDetail = (servers: readonly McpServer[], name: string): ServerDetailView | null => {
  const server = servers.find(known => known.name === name)

  if (server === undefined) {
    return null
  }

  return {
    summary: mcpRow(server),
    tools: summarizeTools(server).map(tool => ({
      ...tool,
      p50Text: tool.p50 === null ? '·' : formatMs(tool.p50),
      maxText: tool.max === null ? '·' : formatMs(tool.max),
    })),
    calls: server.calls.slice(-12).map(call => ({
      at: call.at,
      tool: call.tool,
      ms: call.ms,
      time: formatMs(call.ms),
      isOk: call.isOk,
      isTimeout: call.isTimeout,
    })),
    timeInServer: formatMs(server.calls.reduce((sum, call) => sum + call.ms, 0)),
  }
}

export const buildSlow = (slow: Slow, turn: Turn, now: number, rows: number): SlowView | null => {
  if (slow.calls.length === 0) {
    return null
  }

  const top = slow.calls.slice(0, rows)
  const longest = Math.max(1, ...top.map(call => call.ms))
  const turnMs = turn.startedAt === null ? null : (turn.endedAt ?? now) - turn.startedAt

  return {
    rows: top.map(call => ({
      kind: call.kind,
      label: call.label,
      time: formatMs(call.ms),
      fraction: call.ms / longest,
      isFailed: call.isFailed,
    })),
    toolTime: formatMs(busyMs(slow.spans)),
    turnTime: turnMs === null ? null : formatMs(turnMs),
  }
}

export const buildAgents = (agents: readonly AgentCard[], now: number, limit: number): AgentsView | null => {
  if (agents.length === 0) {
    return null
  }

  const running = agents.filter(card => card.endedAt === null)
  const finished = agents.filter(card => card.endedAt !== null)
  const shown = [...running, ...finished.slice(-Math.max(0, limit - running.length))].slice(0, limit)

  return {
    cards: shown.map(card => ({
      id: card.id,
      label: card.label,
      type: card.type,
      state: card.endedAt === null ? 'running' : card.isFailed ? 'failed' : 'done',
      context: formatTokens(card.contextTokens),
      output: formatTokens(card.outputTokens),
      steps: card.steps,
      elapsed: formatMs((card.endedAt ?? now) - card.startedAt),
      hitMaxTokens: card.hitMaxTokens,
    })),
    running: running.length,
    done: finished.length,
  }
}

export const buildGate = (checks: readonly Check[], cells: number): GateView | null =>
  checks.length === 0
    ? null
    : {
        cells: checks.slice(-cells).map(check => ({ verdict: check.verdict, isSubagent: check.isSubagent })),
        totals: gateTotals(checks),
      }

export const buildTurn = (turn: Turn, main: Main, now: number): TurnView | null => {
  if (turn.startedAt === null) {
    return null
  }

  const spent = main.costUsd !== null && turn.costAtStartUsd !== null ? main.costUsd - turn.costAtStartUsd : null

  return {
    isRunning: turn.endedAt === null,
    time: formatMs((turn.endedAt ?? now) - turn.startedAt),
    agents: turn.agents,
    edits: turn.edits,
    errors: turn.errors,
    cost: spent === null || spent < 0.005 ? null : `+${formatUsd(spent)}`,
  }
}

export type DashboardSizes = { fileRows: number; slowRows: number; agentCards: number; gateCells: number; logRows: number }

export const buildDashboard = (snapshot: Snapshot, config: Config, sizes: DashboardSizes): Dashboard => ({
  panels: config.panels,
  main: buildMain(snapshot.main, snapshot.main.sessionStartedAt, snapshot.now),
  repo: config.isGitOn ? buildRepo(snapshot.repo, sizes.fileRows) : null,
  mcp: buildMcp(snapshot.mcp, snapshot.now),
  slow: buildSlow(snapshot.slow, snapshot.turn, snapshot.now, Math.min(sizes.slowRows, config.slowest)),
  agents: buildAgents(snapshot.agents, snapshot.now, sizes.agentCards),
  gate: buildGate(snapshot.checks, sizes.gateCells),
  turn: buildTurn(snapshot.turn, snapshot.main, snapshot.now),
  log: snapshot.log.slice(-sizes.logRows),
  detail: snapshot.view.server === null ? null : buildServerDetail(snapshot.mcp, snapshot.view.server),
})
