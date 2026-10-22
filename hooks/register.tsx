import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentCard, Check, LogLine, McpServer, Repo, Slow, View } from '../types'
import {
  EDIT_TOOLS,
  LIMITS,
  TYPOGRAPHY_SINCE,
  contextOf,
  countLines,
  cwdFromCommand,
  describeCall,
  emptyMain,
  emptyRepo,
  emptyTurn,
  formatMs,
  gitActionOf,
  healthOf,
  hookRunOf,
  isAtLeast,
  isHandBack,
  isTimeoutText,
  parseAheadBehind,
  parseMcpTool,
  parseNumstat,
  parseRevParse,
  pushLog,
  readConfig,
  recordAgent,
  recordCheck,
  recordMcpCall,
  recordSlow,
  redact,
  repositoryOf,
  resolvePath,
  settleCheck,
  shorten,
  updateAgent,
  verdictOf,
} from './core'
import type { Config, StepUsage } from './core'
import { drawRich } from './rich'
import { drawDock, drawInline } from './terminal'
import { buildDashboard } from './view'
import type { Snapshot } from './view'

const PANE = 'mirante'
const SLOW_FLOOR_MS = 1000
const TITLE = 'mirante'

const main = atom({ plugin: 'mirante', key: 'main' } as const, emptyMain())
const repo = atom({ plugin: 'mirante', key: 'repo' } as const, emptyRepo())
const mcp = atom({ plugin: 'mirante', key: 'mcp' } as const, [] as McpServer[])
const slow = atom({ plugin: 'mirante', key: 'slow' } as const, { calls: [], spans: [] } as Slow)
const agents = atom({ plugin: 'mirante', key: 'agents' } as const, [] as AgentCard[])
const checks = atom({ plugin: 'mirante', key: 'checks' } as const, [] as Check[])
const turn = atom({ plugin: 'mirante', key: 'turn' } as const, emptyTurn())
const log = atom({ plugin: 'mirante', key: 'log' } as const, [] as LogLine[])
const view = atom({ plugin: 'mirante', key: 'view' } as const, { server: null } as View)
const isBandHidden = atom({ plugin: 'mirante', key: 'isBandHidden' } as const, false)

type Engine = EngineInterface

const snapshotOf = async ($: Engine): Promise<Snapshot> => {
  const [mainValue, repoValue, mcpValue, slowValue, agentsValue, checksValue, turnValue, logValue, viewValue, now] = await Promise.all([
    read($, main),
    read($, repo),
    read($, mcp),
    read($, slow),
    read($, agents),
    read($, checks),
    read($, turn),
    read($, log),
    read($, view),
    $.clock.now(),
  ])

  return {
    main: mainValue,
    repo: repoValue,
    mcp: mcpValue,
    slow: slowValue,
    agents: agentsValue,
    checks: checksValue,
    turn: turnValue,
    log: logValue,
    view: viewValue,
    now,
  }
}

const say = async ($: Engine, kind: LogLine['kind'], text: string) => {
  const at = await $.clock.now()
  await update($, log, lines => pushLog(lines, at, kind, text))
}

const refreshStatus = async ($: Engine, config: Config) => {
  if (!config.statusLine) {
    return
  }

  const [mainValue, mcpValue] = await Promise.all([read($, main), read($, mcp)])
  const parts: string[] = []

  if (mainValue.contextPercent !== null) {
    parts.push(`ctx ${Math.round(mainValue.contextPercent)}%`)
  }

  if (mainValue.costUsd !== null) {
    parts.push(`$${mainValue.costUsd.toFixed(2)}`)
  }

  const troubled = mcpValue.filter(server => healthOf(server.calls) !== 'ok').map(server => server.name)

  if (troubled.length > 0) {
    parts.push(`mcp ✗ ${troubled.slice(0, 2).join(', ')}`)
  }

  $.ui.status(parts.length === 0 ? undefined : `◆ ${parts.join(' · ')}`)
}

const git = async ($: Engine, cwd: string, args: string[]): Promise<string | null> => {
  try {
    const ran = await $.process.run(['git', ...args], { cwd, timeoutMs: 5000 })

    return ran.exitCode === 0 ? ran.stdout : null
  } catch {
    return null
  }
}

const readGit = async ($: Engine, cwd: string): Promise<Partial<Repo>> => {
  const head = await git($, cwd, ['rev-parse', '--show-toplevel', '--abbrev-ref', 'HEAD', '--git-dir', '--git-common-dir'])
  const parsed = head === null ? null : parseRevParse(head, cwd)

  if (parsed === null) {
    return { root: null, repository: null, worktree: null, isWorktree: false, branch: null, files: [], error: 'not a git repository' }
  }

  const [upstreamOut, untrackedOut, stashOut] = await Promise.all([
    git($, cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']),
    git($, cwd, ['ls-files', '--others', '--exclude-standard']),
    git($, cwd, ['stash', 'list']),
  ])
  const upstream = upstreamOut?.trim() || null
  const [countsOut, baseOut] = upstream === null
    ? [null, null]
    : await Promise.all([git($, cwd, ['rev-list', '--left-right', '--count', `${upstream}...HEAD`]), git($, cwd, ['merge-base', 'HEAD', upstream])])
  const base = baseOut?.trim() || 'HEAD'
  const numstat = await git($, cwd, ['diff', '--numstat', base])
  const counts = countsOut === null ? null : parseAheadBehind(countsOut)

  return {
    root: parsed.root,
    ...repositoryOf(parsed),
    branch: parsed.branch,
    upstream,
    ahead: counts?.ahead ?? null,
    behind: counts?.behind ?? null,
    files: numstat === null ? [] : parseNumstat(numstat).slice(0, LIMITS.files),
    untracked: untrackedOut === null ? 0 : countLines(untrackedOut),
    stashes: stashOut === null ? 0 : countLines(stashOut),
    error: null,
  }
}

let home: string | null = null
let hasTypography = false
let isRefreshing = false
let isRefreshWanted = false

const refreshRepo = ($: Engine, config: Config) => {
  if (!config.isGitOn) {
    return
  }

  if (isRefreshing) {
    isRefreshWanted = true

    return
  }

  isRefreshing = true
  $.clock.after(250, () => {
    void runRefresh($, config)
  })
}

const runRefresh = async ($: Engine, config: Config) => {
  try {
    const cwd = (await read($, repo)).cwd

    if (cwd !== null) {
      const found = await readGit($, cwd)
      const at = await $.clock.now()
      await update($, repo, current => ({ ...current, ...found, refreshedAt: at }))
    }
  } finally {
    isRefreshing = false

    if (isRefreshWanted) {
      isRefreshWanted = false
      refreshRepo($, config)
    }
  }
}

const showServer = ($: Engine, name: string | null) => {
  void update($, view, () => ({ server: name }))
}

const isLive = async ($: Engine) => {
  const [turnValue, agentsValue] = await Promise.all([read($, turn), read($, agents)])

  return (turnValue.startedAt !== null && turnValue.endedAt === null) || agentsValue.some(card => card.endedAt === null)
}

const tick = async ($: Engine) => {
  if (await isLive($)) {
    $.ui.invalidate('ui.render')
  }
}

export const register: Register = (on, options) => {
  const config = readConfig(options as Record<string, unknown>)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'mirante',
      description: 'Open the mirante dashboard (close, hide, show, reset, or mcp <server>)',
      argumentHint: '[close | hide | show | reset | mcp <server>]',
    })

    home = (await $.env.get('HOME').catch(() => undefined)) ?? null
    hasTypography = isAtLeast((await $.session.version().catch(() => null))?.version ?? '0.0.0', TYPOGRAPHY_SINCE)
    const usage = await $.session.usage().catch(() => null)
    await update($, main, current => ({ ...current, sessionStartedAt: usage?.startedAt ?? null }))
    await update($, repo, current => ({ ...current, cwd: e.cwd }))
    refreshRepo($, config)

    $.clock.every(1000, () => {
      void tick($)
    })

    if (config.openOnStart && config.layout === 'pane') {
      void $.ui.open({ id: PANE, title: TITLE })
    }

    return next(e)
  })

  on('command.run', { command: 'mirante' }, async ($, e) => {
    const [action, ...rest] = e.args.trim().split(/\s+/)

    if (action === 'close') {
      await $.ui.close({ id: PANE })

      return { text: 'mirante closed.' }
    }

    if (action === 'hide' || action === 'show') {
      await update($, isBandHidden, () => action === 'hide')

      return { text: action === 'hide' ? 'mirante band hidden (/mirante show brings it back).' : 'mirante band shown.' }
    }

    if (action === 'reset') {
      await Promise.all([
        update($, mcp, () => []),
        update($, slow, () => ({ calls: [], spans: [] })),
        update($, agents, () => []),
        update($, checks, () => []),
        update($, log, () => []),
        update($, view, () => ({ server: null })),
        update($, turn, () => emptyTurn()),
      ])

      return { text: 'mirante counters cleared (context, cost and limits stay).' }
    }

    if (action === 'mcp') {
      const wanted = rest.join(' ')
      const servers = await read($, mcp)
      const found = servers.find(server => server.name === wanted || server.name.endsWith(wanted))

      if (found === undefined) {
        return { text: servers.length === 0 ? 'No MCP calls yet.' : `No MCP server named "${wanted}". Known: ${servers.map(server => server.name).join(', ')}.` }
      }

      await update($, view, () => ({ server: found.name }))
      await $.ui.open({ id: PANE, title: TITLE })

      return { text: `mirante: showing ${found.name}.` }
    }

    await update($, view, () => ({ server: null }))
    const opened = await $.ui.open({ id: PANE, title: TITLE })

    return { text: opened.isPlaced ? 'mirante opened.' : `mirante could not open: ${opened.reason}` }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined && isHandBack(e.text)) {
      await update($, turn, current => ({ ...current, endedAt: null }))
    } else if (e.agentId === undefined) {
      const [at, mainValue] = await Promise.all([$.clock.now(), read($, main)])
      await update($, turn, () => ({ ...emptyTurn(), id: e.turnId, startedAt: at, costAtStartUsd: mainValue.costUsd }))
      await update($, slow, current => ({ ...current, spans: [] }))
      await say($, 'prompt', shorten(e.text, 70))
    }

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const startedAt = await $.clock.now()
    let firstAt: number | null = null
    const stream = next(e)
    let step = await stream.next()

    while (step.done !== true) {
      if (firstAt === null) {
        firstAt = await $.clock.now()
      }

      yield step.value
      step = await stream.next()
    }

    const result = step.value
    const endedAt = await $.clock.now()
    const usage = result.usage as StepUsage | null

    if (e.agentId !== undefined) {
      const agentId = e.agentId
      await update($, agents, list => {
        const owner = list.find(card => card.agentId === agentId) ?? [...list].reverse().find(card => card.agentId === null && card.endedAt === null)

        return owner === undefined
          ? list
          : updateAgent(list, card => card.id === owner.id, card => ({
              ...card,
              agentId,
              steps: card.steps + 1,
              contextTokens: usage === null ? card.contextTokens : contextOf(usage),
              outputTokens: card.outputTokens + (usage?.output_tokens ?? 0),
              hitMaxTokens: card.hitMaxTokens || result.stopReason === 'max_tokens',
            }))
      })
    } else {
      const streamedMs = firstAt === null ? 0 : endedAt - firstAt
      await update($, main, current => ({
        ...current,
        model: e.model,
        effort: e.effort === undefined ? current.effort : String(e.effort),
        requests: current.requests + 1,
        cacheReadTokens: current.cacheReadTokens + (usage?.cache_read_input_tokens ?? 0),
        inputTokens: current.inputTokens + (usage === null ? 0 : contextOf(usage)),
        contextTokens: usage === null ? current.contextTokens : contextOf(usage),
        ttftMs: firstAt === null ? current.ttftMs : firstAt - startedAt,
        tokensPerSecond: usage !== null && streamedMs > 250 ? usage.output_tokens / (streamedMs / 1000) : current.tokensPerSecond,
      }))
    }

    return result
  })

  on('session.measure', async ($, e, next) => {
    await update($, main, current => ({
      ...current,
      contextTokens: e.context.tokens ?? current.contextTokens,
      contextWindow: e.context.window,
      contextPercent: e.context.percent ?? current.contextPercent,
      rateLimits: e.rateLimits.map(limit => ({ kind: limit.kind, percent: limit.percentUsed, resetsAt: limit.resetsAt ?? null })),
      costUsd: e.cost?.usd ?? current.costUsd,
    }))
    await refreshStatus($, config)

    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, main, current => ({ ...current, compactions: current.compactions + 1 }))
      await say($, 'compact', `context compacted (${e.trigger})`)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)

    if (e.tool_use_id !== undefined) {
      const check: Check = { id: e.tool_use_id, tool: e.tool, verdict: verdictOf(verdict.decision), isSubagent: e.agentId !== undefined }
      await update($, checks, list => recordCheck(list, check))

      if (check.verdict === 'denied') {
        const described = describeCall(e.tool, (e.input ?? {}) as Record<string, unknown>)
        await say($, 'denied', `denied ${described.kind} ${described.label}`)
      }
    }

    return verdict
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const startedAt = await $.clock.now()
    const ran = await next(e)
    const endedAt = await $.clock.now()
    const ms = endedAt - startedAt
    const input = e as unknown as Record<string, unknown>
    const tool = String(e.tool)
    const isDenied = ran.deny !== undefined
    const isError = ran.isError === true
    const described = describeCall(tool, input)

    await update($, checks, list => settleCheck(list, e.tool_use_id, isDenied))

    if (isDenied) {
      return ran
    }

    const output = outputOf(ran.result, ran.text)

    await update($, slow, current => ({
      calls: ms < SLOW_FLOOR_MS ? current.calls : recordSlow(current.calls, { id: e.tool_use_id, kind: described.kind, label: described.label, ms, isFailed: isError }),
      spans: e.agentId === undefined ? [...current.spans, [startedAt, endedAt] as [number, number]].slice(-500) : current.spans,
    }))

    const server = parseMcpTool(tool)

    if (server !== null) {
      await update($, mcp, servers =>
        recordMcpCall(servers, server.server, {
          tool: server.tool,
          ms,
          isOk: !isError,
          isTimeout: isError && isTimeoutText(output),
          at: endedAt,
          detail: isError ? shorten(redact(output), 160) : null,
        }),
      )

      if (isError) {
        await refreshStatus($, config)
      }
    }

    if (e.agentId === undefined && EDIT_TOOLS.has(tool) && !isError) {
      await update($, turn, current => ({ ...current, edits: current.edits + 1 }))
      await say($, 'edit', `${tool.toLowerCase()} ${described.label}`)
    }

    if (isError) {
      await update($, turn, current => ({ ...current, errors: current.errors + 1 }))
      await say($, 'error', `${described.kind} ${described.label}${server !== null && isTimeoutText(output) ? ` timed out (${formatMs(ms)})` : ''}`)
    }

    if (tool === 'Agent' || tool === 'Task') {
      await update($, agents, list => updateAgent(list, card => card.id === e.tool_use_id && !card.isBackground, card => ({ ...card, endedAt, isFailed: isError })))
    }

    if (tool === 'Bash') {
      const command = String(input.command ?? '')
      const current = await read($, repo)
      const base = current.cwd ?? '/'
      const moved = cwdFromCommand(command, base, home)

      if (moved !== null && moved !== current.cwd) {
        await update($, repo, value => ({ ...value, cwd: moved }))
      }

      const action = gitActionOf(command)

      if (action !== null && /\bhook|husky|lefthook|pre-commit|pre-push|commit-msg/i.test(output + (isError ? ' hook' : ''))) {
        const hook = hookRunOf(action.action, output, isError, ms, endedAt)
        await update($, repo, value => ({
          ...value,
          cwd: action.dir === null ? value.cwd : resolvePath(moved ?? base, action.dir, home),
          hooks: [...value.hooks, hook].slice(-LIMITS.hooks),
        }))

        if (!hook.isOk) {
          await say($, 'hook', `${hook.name} failed${hook.detail === null ? '' : `: ${hook.detail}`}`)
        }
      }
    }

    if (tool === 'Bash' || EDIT_TOOLS.has(tool)) {
      refreshRepo($, config)
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const at = await $.clock.now()
    const card: AgentCard = {
      id: e.tool_use_id,
      agentId: e.resume?.agentId ?? null,
      label: shorten(e.name ?? e.description ?? e.subagentType, 40),
      type: e.subagentType,
      isBackground: e.background,
      startedAt: at,
      endedAt: null,
      steps: 0,
      contextTokens: 0,
      outputTokens: 0,
      isFailed: false,
      hitMaxTokens: false,
    }

    await update($, agents, list => recordAgent(list, card))
    await update($, turn, current => ({ ...current, agents: current.agents + 1 }))
    await say($, 'spawn', `spawn ${card.label} (${card.type})`)

    const started = await next(e)

    if (started.deny !== undefined) {
      await update($, agents, list => updateAgent(list, known => known.id === card.id, known => ({ ...known, endedAt: at, isFailed: true })))
    } else if (started.agentId !== undefined) {
      const agentId = started.agentId
      await update($, agents, list => updateAgent(list, known => known.id === card.id, known => ({ ...known, agentId })))
    }

    return started
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const at = await $.clock.now()

    if (e.agentId !== undefined) {
      const agentId = e.agentId
      const list = await read($, agents)
      const card = list.find(known => known.agentId === agentId)

      if (card !== undefined && card.endedAt === null) {
        await update($, agents, cards => updateAgent(cards, known => known.id === card.id, known => ({ ...known, endedAt: at, isFailed: e.isAborted })))
        await say($, e.isAborted ? 'error' : 'done', `${card.label} ${e.isAborted ? 'stopped' : 'done'} in ${formatMs(at - card.startedAt)}`)
      }
    } else {
      const [mainValue, turnValue] = await Promise.all([read($, main), read($, turn)])
      const spent = mainValue.costUsd !== null && turnValue.costAtStartUsd !== null ? mainValue.costUsd - turnValue.costAtStartUsd : null

      await update($, turn, current => ({ ...current, endedAt: at }))
      await update($, main, current => ({
        ...current,
        lastTurnCostUsd: spent ?? current.lastTurnCostUsd,
        contextAfterTurn: current.contextTokens === null ? current.contextAfterTurn : [...current.contextAfterTurn, current.contextTokens].slice(-12),
      }))
      await refreshStatus($, config)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (config.layout !== 'band' || e.props.hasSurvey || (await read($, isBandHidden))) {
      return next(e)
    }

    const board = buildDashboard(await snapshotOf($), config, { fileRows: 0, slowRows: 3, agentCards: 3, gateCells: 0, logRows: 0 })
    const { Box, Text } = $.ui.resolve(e)

    return drawInline({ Box, Text } as Parameters<typeof drawInline>[0], board, config.accent, e.props.bodyColumns, Math.min(8, e.props.maxRows), true)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const snapshot = await snapshotOf($)
    const columns = e.props.bodyColumns
    const inner = Math.max(20, columns - 4)
    const board = buildDashboard(snapshot, config, {
      fileRows: 6,
      slowRows: config.slowest,
      agentCards: inner >= 72 ? 6 : 4,
      gateCells: Math.max(30, Math.floor(inner / 2) * 3),
      logRows: 8,
    })

    if (e.surface === 'terminal') {
      const elements = $.ui.resolve(e)

      return e.props.placement === 'inline'
        ? drawInline(elements, board, config.accent, columns, 8)
        : drawDock(elements, board, config.accent, columns, name => showServer($, name))
    }

    const { Box, Text, Button, Svg } = $.ui.resolve(e)

    return drawRich({ Box, Text, Button, Svg }, board, config.accent, name => showServer($, name), hasTypography)
  })
}

const outputOf = (result: unknown, text: string | undefined): string => {
  if (typeof result === 'string') {
    return `${result}\n${text ?? ''}`
  }

  if (result !== null && typeof result === 'object') {
    const shaped = result as { stdout?: unknown; stderr?: unknown }
    const parts = [shaped.stdout, shaped.stderr].filter((part): part is string => typeof part === 'string')

    if (parts.length > 0) {
      return `${parts.join('\n')}\n${text ?? ''}`
    }
  }

  return text ?? ''
}

