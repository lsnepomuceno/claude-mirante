import type { ElementTable, RenderChildren } from 'claude-code'

import type { LogLine } from '../types'
import { COLORS, bar, formatClock, plural, shorten, spark } from './core'
import type { Panel } from './core'
import type { AgentView, Dashboard, McpRowView, ServerDetailView } from './view'

type Elements = ElementTable<'terminal'>
type Segment = { text: string; color?: string; bold?: boolean; dim?: boolean }
type Paint = { E: Elements; accent: string; inner: number; openServer: (name: string | null) => void }

const LABEL = 9

const seg = (text: string, color?: string, bold?: boolean): Segment => ({ text, color, bold })
const dim = (text: string): Segment => ({ text, dim: true })
const label = (text: string): Segment => dim(text.padEnd(LABEL))
const pad = (text: string, size: number): string => (text.length >= size ? shorten(text, size) : text.padEnd(size))
const padStart = (text: string, size: number): string => text.padStart(size)

const line = ({ E }: Paint, segments: Segment[]) => {
  const { Text } = E

  return (
    <Text wrap="truncate">
      {segments.map(part => (
        <Text color={part.color} bold={part.bold} dimColor={part.dim}>
          {part.text}
        </Text>
      ))}
    </Text>
  )
}

const meter = (fraction: number, width: number, color: string): Segment[] => {
  const drawn = bar(fraction, width)

  return [seg(drawn.on, color), seg(drawn.off, COLORS.track)]
}

const panel = (paint: Paint, title: string, note: string | null, rows: RenderChildren[]) => {
  const { Box, Text } = paint.E

  return (
    <Box key={`panel:${title}`} position="relative" flexDirection="column">
      <Box flexDirection="column" borderStyle="round" borderColor={COLORS.track} paddingX={1}>
        {rows}
      </Box>
      <Box position="absolute" top={0} left={2}>
        <Text color={paint.accent} bold>
          {` ${title} `}
        </Text>
      </Box>
      {note === null ? null : (
        <Box position="absolute" top={0} right={2}>
          <Text dimColor>{` ${note} `}</Text>
        </Box>
      )}
    </Box>
  )
}

const mainPanel = (paint: Paint, board: Dashboard) => {
  const main = board.main
  const rows: RenderChildren[] = []
  const gauge = Math.max(8, Math.min(26, paint.inner - LABEL - 34))

  if (main.context === null) {
    rows.push(line(paint, [label('context'), dim('waiting for the first request')]))
  } else {
    rows.push(
      line(paint, [
        label('context'),
        ...meter(main.context.fraction, gauge, main.context.percent >= 85 ? COLORS.warn : paint.accent),
        seg(` ${main.context.used}/${main.context.window} `),
        seg(`${main.context.percent}%`, undefined, true),
        dim(main.compactions > 0 ? `  ⟲ ${main.compactions}` : ''),
        dim(main.turnsLeft === null ? '' : ` · full in ~${main.turnsLeft} turns`),
      ]),
    )
  }

  const cost: Segment[] = [label('cost')]
  cost.push(main.cost === null ? dim('not reported') : seg(main.cost, undefined, true))
  cost.push(dim(main.cost === null ? '' : ' session'))

  if (main.lastTurnCost !== null) {
    cost.push(dim(' · '), seg(main.lastTurnCost), dim(' last turn'))
  }

  if (main.cacheHit !== null) {
    cost.push(dim(' · cache hit '), seg(`${main.cacheHit}%`, main.cacheHit >= 60 ? COLORS.ok : COLORS.warn))
  }

  rows.push(line(paint, cost))

  if (main.limits.length > 0) {
    const limits: Segment[] = [label('limits')]

    for (const [index, limit] of main.limits.entries()) {
      limits.push(
        dim(`${index > 0 ? '   ' : ''}${limit.label} `),
        ...meter(limit.fraction, 10, limit.percent >= 80 ? COLORS.error : limit.percent >= 50 ? COLORS.warn : COLORS.ok),
        seg(` ${limit.percent}%`),
        dim(limit.reset === null ? '' : ` ↻ ${limit.reset}`),
      )
    }

    rows.push(line(paint, limits))
  }

  if (main.ttft !== null) {
    rows.push(
      line(paint, [
        label('speed'),
        seg(`ttft ${main.ttft}`),
        dim(main.tokensPerSecond === null ? '' : ' · '),
        seg(main.tokensPerSecond === null ? '' : `${main.tokensPerSecond} tok/s`),
        dim(` · ${plural(main.requests, 'request')}`),
      ]),
    )
  }

  return panel(paint, 'MAIN', [main.model, main.effort].filter(Boolean).join(' · ') || null, rows)
}

const repoPanel = (paint: Paint, board: Dashboard) => {
  const repo = board.repo

  if (repo === null) {
    return null
  }

  const rows: RenderChildren[] = [
    line(paint, [
      label('repo'),
      seg(repo.repository, undefined, true),
      dim(repo.worktree === null ? '' : '   worktree '),
      seg(repo.worktree ?? '', paint.accent),
    ]),
    line(paint, [
      label('branch'),
      seg(repo.branch),
      seg(repo.ahead === null ? '' : `  ↑${repo.ahead}`, repo.ahead ? COLORS.ok : undefined),
      dim(repo.behind === null ? '' : ` ↓${repo.behind}`),
      dim(repo.upstream === null ? '  no upstream' : ` vs ${repo.upstream}`),
    ]),
    line(paint, [
      label('diff'),
      repo.files.length === 0 ? dim('clean') : seg(`${repo.files.length + repo.moreFiles} files · `),
      seg(repo.files.length === 0 ? '' : `+${repo.added}`, COLORS.ok),
      seg(repo.files.length === 0 ? '' : ` −${repo.removed}`, COLORS.error),
      dim(repo.untracked > 0 ? ` · ${repo.untracked} untracked` : ''),
      dim(repo.stashes > 0 ? ` · ${repo.stashes} stash${repo.stashes > 1 ? 'es' : ''}` : ''),
    ]),
  ]

  const pathRoom = Math.max(12, paint.inner - LABEL - 30)

  for (const file of repo.files) {
    const size = Math.max(1, Math.round(file.fraction * 16))
    const added = Math.round((file.added / Math.max(1, file.added + file.removed)) * size)

    rows.push(
      line(paint, [
        dim(''.padEnd(LABEL)),
        seg(pad(shortenPath(file.path, pathRoom), pathRoom)),
        seg(` ${'▮'.repeat(added)}`, COLORS.ok),
        seg('▮'.repeat(size - added), COLORS.error),
        seg(''.padEnd(17 - size)),
        seg(padStart(`+${file.added}`, 6), COLORS.ok),
        seg(padStart(`−${file.removed}`, 6), COLORS.error),
      ]),
    )
  }

  if (repo.moreFiles > 0) {
    rows.push(line(paint, [dim(''.padEnd(LABEL)), dim(`and ${repo.moreFiles} more`)]))
  }

  if (repo.hooks.length > 0) {
    const hooks: Segment[] = [label('hooks')]

    for (const [index, hook] of repo.hooks.entries()) {
      hooks.push(
        dim(index > 0 ? '   ' : ''),
        seg(`${hook.isOk ? '✓' : '✗'} ${hook.name}`, hook.isOk ? COLORS.ok : COLORS.error),
        dim(` ${hook.detail === null ? '' : `· ${hook.detail} · `}${hook.time}`),
      )
    }

    rows.push(line(paint, hooks))
  }

  return panel(paint, 'REPO', 'git', rows)
}

const shortenPath = (path: string, room: number): string => {
  if (path.length <= room) {
    return path
  }

  const name = path.slice(path.lastIndexOf('/') + 1)

  return name.length + 2 >= room ? shorten(name, room) : `…${path.slice(path.length - room + 1)}`
}

const healthMark = (row: McpRowView): Segment =>
  row.health === 'ok' ? seg('●', COLORS.ok) : row.health === 'degraded' ? seg('◐', COLORS.warn) : seg('○', COLORS.error)

const mcpPanel = (paint: Paint, board: Dashboard) => {
  const mcp = board.mcp

  if (mcp === null) {
    return null
  }

  const { Button } = paint.E
  const stripRoom = Math.max(6, paint.inner - 46)
  const rows: RenderChildren[] = [
    line(paint, [
      dim(pad('server', 16)),
      dim(padStart('calls', 6)),
      dim(padStart('p50', 8)),
      dim(padStart('p95', 8)),
      dim(padStart('err', 5)),
      dim('   each call, oldest first'),
    ]),
  ]

  for (const row of mcp.servers) {
    const recent = row.durations.slice(-stripRoom)
    const ceiling = Math.max(1000, ...recent)

    rows.push(
      <Button key={`mcp:${row.name}`} plain onPress={() => paint.openServer(row.name)}>
        {line(paint, [
          healthMark(row),
          seg(` ${pad(row.label, 14)}`),
          seg(padStart(String(row.total), 6)),
          seg(padStart(row.p50Text, 8)),
          seg(padStart(row.p95Text, 8)),
          seg(padStart(String(row.errors), 5), row.errors > 0 ? COLORS.error : COLORS.track),
          seg(`   ${spark(recent, ceiling)}`, row.health === 'ok' ? paint.accent : COLORS.warn),
        ])}
      </Button>,
    )
  }

  if (mcp.lastTimeout !== null) {
    rows.push(
      line(paint, [
        seg(`✗ ${mcp.lastTimeout.server} · ${mcp.lastTimeout.tool} timed out after ${mcp.lastTimeout.time}`, COLORS.error),
        dim(`  ${formatClock(mcp.lastTimeout.at)}`),
      ]),
    )
  }

  return panel(paint, 'MCP', `${mcp.servers.length} server${mcp.servers.length === 1 ? '' : 's'} · ${mcp.calls} calls`, rows)
}

const slowPanel = (paint: Paint, board: Dashboard) => {
  const slow = board.slow

  if (slow === null) {
    return null
  }

  const labelRoom = Math.max(10, paint.inner - 8 - 22 - 9)
  const rows = slow.rows.map(row =>
    line(paint, [
      dim(pad(shorten(row.kind, 7), 8)),
      seg(pad(row.label, labelRoom)),
      seg(' '),
      ...meter(row.fraction, 20, row.isFailed ? COLORS.error : row.kind === 'Agent' ? COLORS.agent : paint.accent),
      seg(padStart(`${row.time}${row.isFailed ? ' ✗' : ''}`, 9), row.isFailed ? COLORS.error : undefined),
    ]),
  )
  const note = slow.turnTime === null ? `tools took ${slow.toolTime}` : `tools took ${slow.toolTime} of a ${slow.turnTime} turn`

  return panel(paint, 'SLOWEST', note, rows)
}

const agentCard = (paint: Paint, card: AgentView, width: number) => {
  const { Box } = paint.E
  const mark = card.state === 'running' ? seg(`● ${card.label}`, COLORS.agent) : card.state === 'failed' ? seg(`✗ ${card.label}`, COLORS.error) : seg(`✓ ${card.label}`, COLORS.ok)

  return (
    <Box key={`agent:${card.id}`} flexDirection="column" borderStyle="round" borderColor={card.state === 'running' ? COLORS.agent : COLORS.track} paddingX={1} width={width}>
      {line(paint, [mark])}
      {line(paint, [dim(card.type)])}
      {line(paint, [dim('ctx '), seg(card.context, undefined, true), dim(' · out '), seg(card.output)])}
      {line(paint, [
        seg(plural(card.steps, 'step')),
        dim(' · '),
        seg(card.state === 'running' ? `⏱ ${card.elapsed}` : card.elapsed, card.state === 'running' ? COLORS.agent : undefined),
        seg(card.hitMaxTokens ? ' max_tokens' : '', COLORS.error),
      ])}
    </Box>
  )
}

const agentsPanel = (paint: Paint, board: Dashboard) => {
  const agents = board.agents

  if (agents === null) {
    return null
  }

  const { Box } = paint.E
  const columns = paint.inner >= 72 ? 3 : paint.inner >= 46 ? 2 : 1
  const width = Math.floor((paint.inner - (columns - 1)) / Math.max(Math.min(2, columns), Math.min(columns, agents.cards.length)))
  const rows: RenderChildren[] = []

  for (let start = 0; start < agents.cards.length; start += columns) {
    rows.push(
      <Box key={`agents:${start}`} flexDirection="row" gap={1}>
        {agents.cards.slice(start, start + columns).map(card => agentCard(paint, card, width))}
      </Box>,
    )
  }

  return panel(paint, 'AGENTS', `${agents.running} running · ${agents.done} done`, rows)
}

const VERDICT_COLOR = { rule: COLORS.ok, approved: COLORS.approved, pending: COLORS.warn, denied: COLORS.error } as const

const gatePanel = (paint: Paint, board: Dashboard) => {
  const gate = board.gate

  if (gate === null) {
    return null
  }

  const { Text } = paint.E
  const { totals } = gate
  const families = totals.byTool
    .slice(0, 3)
    .map(([tool, count]) => `${tool} ${count}`)
    .join(' · ')

  return panel(paint, 'GATE', `${totals.rule + totals.approved + totals.pending + totals.denied} checks`, [
    <Text wrap="wrap">
      {gate.cells.map(cell => (
        <Text color={VERDICT_COLOR[cell.verdict]} dimColor={cell.isSubagent}>
          ■{' '}
        </Text>
      ))}
    </Text>,
    line(paint, [
      seg(`${totals.rule} allowed`, COLORS.ok),
      dim(' · '),
      seg(`${totals.approved} approved`, COLORS.approved),
      dim(' · '),
      seg(`${totals.pending} pending`, COLORS.warn),
      dim(' · '),
      seg(`${totals.denied} denied`, COLORS.error),
      dim(families === '' ? '' : `   ${families}`),
    ]),
  ])
}

const turnPanel = (paint: Paint, board: Dashboard) => {
  const turn = board.turn

  if (turn === null) {
    return null
  }

  return panel(paint, 'TURN', null, [
    line(paint, [
      seg(turn.isRunning ? `▶ running ${turn.time}` : `■ took ${turn.time}`, turn.isRunning ? paint.accent : undefined),
      dim(' · '),
      seg(plural(turn.agents, 'agent')),
      dim(' · '),
      seg(plural(turn.edits, 'edit')),
      dim(' · '),
      seg(`${turn.errors} error${turn.errors === 1 ? '' : 's'}`, turn.errors > 0 ? COLORS.error : undefined),
      dim(turn.cost === null ? '' : ' · '),
      seg(turn.cost ?? ''),
    ]),
  ])
}

const LOG_MARK: Record<LogLine['kind'], [string, string | undefined]> = {
  prompt: ['›', undefined],
  spawn: ['⇢', COLORS.agent],
  done: ['✓', COLORS.ok],
  edit: ['✎', undefined],
  error: ['✗', COLORS.error],
  denied: ['■', COLORS.error],
  compact: ['⟲', COLORS.warn],
  hook: ['⚑', COLORS.warn],
}

const logPanel = (paint: Paint, board: Dashboard) => {
  if (board.log.length === 0) {
    return null
  }

  return panel(
    paint,
    'LOG',
    null,
    board.log.map(entry => {
      const [mark, color] = LOG_MARK[entry.kind]

      return line(paint, [
        dim(`${formatClock(entry.at)}  `),
        seg(`${mark} `, color ?? paint.accent),
        seg(entry.text, entry.kind === 'error' ? COLORS.error : undefined, entry.kind === 'prompt'),
      ])
    }),
  )
}

const DRAW: Record<Panel, (paint: Paint, board: Dashboard) => RenderChildren> = {
  main: mainPanel,
  repo: repoPanel,
  mcp: mcpPanel,
  slowest: slowPanel,
  agents: agentsPanel,
  gate: gatePanel,
  turn: turnPanel,
  log: logPanel,
}

export const drawDock = (E: Elements, board: Dashboard, accent: string, columns: number, openServer: (name: string | null) => void) => {
  const { Box } = E
  const paint: Paint = { E, accent, inner: Math.max(20, columns - 4), openServer }

  if (board.detail !== null) {
    return drawDetail(paint, board.detail)
  }

  return (
    <Box flexDirection="column" gap={1} paddingTop={1}>
      {board.panels.map(name => DRAW[name](paint, board)).filter(drawn => drawn !== null)}
    </Box>
  )
}

const drawDetail = (paint: Paint, detail: ServerDetailView) => {
  const { Box, Button } = paint.E
  const summary = detail.summary
  const longest = Math.max(1000, ...detail.calls.map(call => call.ms))
  const toolRoom = Math.max(12, paint.inner - 30)

  return (
    <Box flexDirection="column" gap={1} paddingTop={1}>
      <Box flexDirection="row" justifyContent="space-between">
        {line(paint, [seg(`MCP › ${summary.label}`, paint.accent, true), seg(`  ${summary.health}`, summary.health === 'ok' ? COLORS.ok : COLORS.warn)])}
        <Button key="back" label="back" hotkey="b" onPress={() => paint.openServer(null)} />
      </Box>
      {panel(paint, 'SUMMARY', null, [
        line(paint, [
          seg(`${summary.total}`, undefined, true),
          seg(' calls'),
          dim(' · '),
          seg(`${summary.errors} errors`, summary.errors > 0 ? COLORS.error : undefined),
          dim(' · '),
          seg(`p50 ${summary.p50Text} · p95 ${summary.p95Text}`),
        ]),
        line(paint, [dim('time inside this server '), seg(detail.timeInServer, undefined, true)]),
      ])}
      {panel(paint, 'BY TOOL', null, [
        line(paint, [dim(pad('tool', toolRoom)), dim(padStart('calls', 6)), dim(padStart('p50', 8)), dim(padStart('max', 8)), dim(padStart('err', 5))]),
        ...detail.tools.map(tool =>
          line(paint, [
            seg(pad(tool.tool, toolRoom)),
            seg(padStart(String(tool.calls), 6)),
            seg(padStart(tool.p50Text, 8)),
            seg(padStart(tool.maxText, 8)),
            seg(padStart(String(tool.errors), 5), tool.errors > 0 ? COLORS.error : COLORS.track),
          ]),
        ),
      ])}
      {panel(paint, 'CALLS', 'latest last', detail.calls.map(call =>
        line(paint, [
          dim(`${formatClock(call.at)}  `),
          seg(pad(call.tool, Math.max(10, paint.inner - 46))),
          seg(' '),
          ...meter(call.ms / longest, 20, call.isOk ? paint.accent : COLORS.error),
          seg(padStart(call.time, 8), call.isOk ? undefined : COLORS.error),
          seg(call.isOk ? '  ✓' : call.isTimeout ? '  ✗ timeout' : '  ✗', call.isOk ? COLORS.ok : COLORS.error),
        ]),
      ))}
      {summary.lastError === null
        ? null
        : panel(paint, 'LAST ERROR', null, [
            line(paint, [seg(summary.lastError.tool, COLORS.error), dim(` at ${formatClock(summary.lastError.at)}`)]),
            line(paint, [seg(summary.lastError.detail ?? 'no message')]),
          ])}
    </Box>
  )
}

export const drawInline = (E: Elements, board: Dashboard, accent: string, columns: number, maxRows: number, isFramed = false) => {
  const paint: Paint = { E, accent, inner: Math.max(20, columns - (isFramed ? 4 : 2)), openServer: () => undefined }
  const rows: RenderChildren[] = []
  const main = board.main

  rows.push(
    line(paint, [
      label('main'),
      seg([main.model, main.effort].filter(Boolean).join(' · ') + '  '),
      ...(main.context === null ? [] : [...meter(main.context.fraction, 14, paint.accent), seg(` ${main.context.percent}%`, undefined, true)]),
      dim(main.cost === null ? '' : ' · '),
      seg(main.cost ?? '', undefined, true),
      ...main.limits.slice(0, 1).flatMap(limit => [dim(` · ${limit.label} `), seg(`${limit.percent}%`, limit.percent >= 50 ? COLORS.warn : COLORS.ok), dim(limit.reset === null ? '' : ` ↻ ${limit.reset}`)]),
      dim(main.cacheHit === null ? '' : ` · cache ${main.cacheHit}%`),
    ]),
  )

  if (board.repo !== null && board.panels.includes('repo')) {
    const repo = board.repo
    rows.push(
      line(paint, [
        label('repo'),
        seg(repo.worktree ?? repo.repository, paint.accent),
        dim(' ⎇ '),
        seg(repo.branch),
        seg(repo.ahead ? ` ↑${repo.ahead}` : '', COLORS.ok),
        dim(' · '),
        seg(`+${repo.added}`, COLORS.ok),
        seg(` −${repo.removed}`, COLORS.error),
        ...repo.hooks.flatMap(hook => [dim(' · '), seg(`${hook.isOk ? '✓' : '✗'} ${hook.name}`, hook.isOk ? COLORS.ok : COLORS.error)]),
      ]),
    )
  }

  if (board.mcp !== null && board.panels.includes('mcp')) {
    rows.push(
      line(paint, [
        label('mcp'),
        ...board.mcp.servers.flatMap(row => [healthMark(row), seg(` ${row.label}  `)]),
        seg(board.mcp.timeouts > 0 ? `${board.mcp.timeouts} timeout${board.mcp.timeouts === 1 ? '' : 's'}` : '', COLORS.error),
      ]),
    )
  }

  if (board.slow !== null && board.panels.includes('slowest')) {
    rows.push(
      line(paint, [
        label('slowest'),
        ...board.slow.rows.slice(0, 3).flatMap((row, index) => [
          dim(index > 0 ? ' · ' : ''),
          seg(`${shorten(row.label, 28)} ${row.time}${row.isFailed ? ' ✗' : ''}`, row.isFailed ? COLORS.error : row.kind === 'Agent' ? COLORS.agent : undefined),
        ]),
      ]),
    )
  }

  if ((board.agents !== null && board.panels.includes('agents')) || (board.gate !== null && board.panels.includes('gate'))) {
    const parts: Segment[] = [label((board.agents?.cards.length ?? 0) > 0 ? 'agents' : 'gate')]

    for (const [index, card] of (board.agents?.cards ?? []).slice(0, 3).entries()) {
      parts.push(dim(index > 0 ? ' · ' : ''), seg(`${card.state === 'running' ? '●' : card.state === 'failed' ? '✗' : '✓'} ${card.label} ${card.elapsed}`, card.state === 'running' ? COLORS.agent : card.state === 'failed' ? COLORS.error : COLORS.ok))
    }

    if (board.gate !== null) {
      const totals = board.gate.totals
      parts.push(dim(board.agents === null ? '' : '    gate '), seg(String(totals.rule), COLORS.ok), dim(' · '), seg(String(totals.approved), COLORS.approved), dim(' · '), seg(`${totals.denied} ✗`, COLORS.error))
    }

    rows.push(line(paint, parts))
  }

  if (board.turn !== null && board.panels.includes('turn')) {
    const turn = board.turn
    rows.push(
      line(paint, [
        label('turn'),
        seg(turn.isRunning ? `▶ ${turn.time}` : `■ ${turn.time}`, turn.isRunning ? paint.accent : undefined),
        dim(` · ${plural(turn.edits, 'edit')} · `),
        seg(`${turn.errors} error${turn.errors === 1 ? '' : 's'}`, turn.errors > 0 ? COLORS.error : undefined),
        dim(turn.cost === null ? '' : ` · ${turn.cost}`),
      ]),
    )
  }

  const { Box } = paint.E

  if (isFramed) {
    return panel(paint, '◆ mirante', '/mirante', rows.slice(0, Math.max(1, maxRows - 2)))
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      {rows.slice(0, Math.max(1, maxRows))}
    </Box>
  )
}
