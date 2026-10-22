import type { ElementTable, RenderChildren } from 'claude-code'

import { COLORS, SVG_COLORS, formatClock, plural } from './core'
import type { Panel } from './core'
import type { Dashboard, GateView, McpRowView, ServerDetailView } from './view'

type Elements = Pick<ElementTable<'desktop'>, 'Box' | 'Text' | 'Button' | 'Svg'>
type Paint = { E: Elements; accent: string; openServer: (name: string | null) => void }

const BAR_WIDTH = 300

const ringSvg = (fraction: number, color: string): string => {
  const radius = 34
  const length = 2 * Math.PI * radius
  const drawn = Math.min(1, Math.max(0, fraction)) * length

  return `<svg xmlns="http://www.w3.org/2000/svg" width="84" height="84" viewBox="0 0 84 84"><circle cx="42" cy="42" r="${radius}" fill="none" stroke="${SVG_COLORS.track}" stroke-width="8"/><circle cx="42" cy="42" r="${radius}" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${drawn.toFixed(1)} ${length.toFixed(1)}" transform="rotate(-90 42 42)"/></svg>`
}

const barSvg = (fraction: number, color: string, width = BAR_WIDTH, height = 6): string => {
  const drawn = Math.max(fraction > 0 ? height : 0, Math.min(1, Math.max(0, fraction)) * width)

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" rx="${height / 2}" fill="${SVG_COLORS.track}"/><rect width="${drawn.toFixed(1)}" height="${height}" rx="${height / 2}" fill="${color}"/></svg>`
}

const splitBarSvg = (added: number, removed: number, fraction: number): string => {
  const width = 80
  const total = Math.max(1, added + removed)
  const size = Math.max(4, fraction * width)
  const green = (added / total) * size

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="6" viewBox="0 0 ${width} 6"><rect width="${width}" height="6" rx="3" fill="${SVG_COLORS.track}"/><rect width="${green.toFixed(1)}" height="6" fill="${SVG_COLORS.ok}"/><rect x="${green.toFixed(1)}" width="${(size - green).toFixed(1)}" height="6" fill="${SVG_COLORS.error}"/></svg>`
}

const stripSvg = (row: McpRowView, accent: string): string => {
  const values = row.durations.slice(-36)
  const failures = row.failures.slice(-36)
  const ceiling = Math.max(1000, ...values)
  const bars = values
    .map((value, index) => {
      const height = Math.max(3, Math.round(Math.min(1, value / ceiling) * 22))
      const color = failures[index] ? SVG_COLORS.error : value > 5000 ? SVG_COLORS.warn : accent

      return `<rect x="${index * 6}" y="${22 - height}" width="4" height="${height}" rx="1" fill="${color}"/>`
    })
    .join('')
  const width = Math.max(6, values.length * 6)

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="22" viewBox="0 0 ${width} 22">${bars}</svg>`
}

const GATE_FILL = { rule: SVG_COLORS.ok, approved: SVG_COLORS.approved, pending: SVG_COLORS.warn, denied: SVG_COLORS.error } as const

const gateSvg = (cells: GateView['cells']): string => {
  const perRow = 30
  const rows = Math.max(1, Math.ceil(cells.length / perRow))
  const squares = cells
    .map((cell, index) => {
      const x = (index % perRow) * 12
      const y = Math.floor(index / perRow) * 12
      const fill = cell.isSubagent && cell.verdict === 'rule' ? SVG_COLORS.quiet : GATE_FILL[cell.verdict]

      return `<rect x="${x}" y="${y}" width="9" height="9" rx="2" fill="${fill}"/>`
    })
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${perRow * 12}" height="${rows * 12}" viewBox="0 0 ${perRow * 12} ${rows * 12}">${squares}</svg>`
}

const card = (paint: Paint, key: string, title: string, note: string | null, children: RenderChildren[]) => {
  const { Box, Text } = paint.E

  return (
    <Box key={`card:${key}`} flexDirection="column" borderStyle="round" borderColor={COLORS.track} padding="md" gap="sm">
      <Box flexDirection="row" justifyContent="space-between">
        <Text weight="semibold">{title}</Text>
        {note === null ? null : (
          <Text size="caption" color={COLORS.label}>
            {note}
          </Text>
        )}
      </Box>
      {children}
    </Box>
  )
}

const stat = (paint: Paint, label: string, value: string, color?: string) => {
  const { Box, Text } = paint.E

  return (
    <Box key={`stat:${label}`} flexDirection="column" minWidth={14}>
      <Text size="caption" color={COLORS.label}>
        {label}
      </Text>
      <Text mono tabular weight="semibold" color={color}>
        {value}
      </Text>
    </Box>
  )
}

const mainCard = (paint: Paint, board: Dashboard) => {
  const { Box, Text, Svg } = paint.E
  const main = board.main
  const percent = main.context?.percent ?? 0
  const limits = main.limits.map(limit => (
    <Box key={`limit:${limit.label}`} flexDirection="column" gap="xs">
      <Box flexDirection="row" justifyContent="space-between">
        <Text size="caption" color={COLORS.label}>
          {`${limit.label} limit`}
        </Text>
        <Text size="caption" mono>
          {`${limit.percent}%${limit.reset === null ? '' : ` · resets ${limit.reset}`}`}
        </Text>
      </Box>
      <Svg source={barSvg(limit.fraction, limit.percent >= 80 ? SVG_COLORS.error : limit.percent >= 50 ? SVG_COLORS.warn : SVG_COLORS.ok)} alt={`${limit.label} limit ${limit.percent} percent used`} />
    </Box>
  ))

  return card(paint, 'main', [main.model, main.effort].filter(Boolean).join(' · ') || 'Session', main.sessionTime === null ? null : `session ${main.sessionTime}`, [
    <Box key="main:row" flexDirection="row" gap="md" alignItems="center">
      <Box flexDirection="column" alignItems="center">
        <Svg source={ringSvg(percent / 100, percent >= 85 ? SVG_COLORS.warn : paint.accent)} alt={`Context ${percent} percent used`} width={84} height={84} />
        <Text mono weight="semibold">{main.context === null ? '·' : `${percent}%`}</Text>
        <Text size="caption" color={COLORS.label}>
          {main.context === null ? 'context' : `${main.context.used}/${main.context.window}`}
        </Text>
      </Box>
      <Box flexDirection="column" gap="sm" flexGrow={1}>
        <Box flexDirection="row" gap="md">
          {stat(paint, 'Session cost', main.cost ?? '·')}
          {stat(paint, 'Cache hit', main.cacheHit === null ? '·' : `${main.cacheHit}%`, main.cacheHit !== null && main.cacheHit >= 60 ? COLORS.ok : undefined)}
        </Box>
        <Box flexDirection="row" gap="md">
          {stat(paint, 'First token', main.ttft === null ? '·' : `${main.ttft}${main.tokensPerSecond === null ? '' : ` · ${main.tokensPerSecond} tok/s`}`)}
          {stat(paint, 'Compaction', `⟲ ${main.compactions}${main.turnsLeft === null ? '' : ` · ~${main.turnsLeft} turns`}`)}
        </Box>
      </Box>
    </Box>,
    ...limits,
  ])
}

const repoCard = (paint: Paint, board: Dashboard) => {
  const repo = board.repo

  if (repo === null) {
    return null
  }

  const { Box, Text, Svg } = paint.E

  return card(paint, 'repo', 'Repository', repo.worktree === null ? repo.repository : `${repo.repository} · worktree ${repo.worktree}`, [
    <Box key="repo:branch" flexDirection="row" gap="sm">
      <Text mono>{`⎇ ${repo.branch}`}</Text>
      {repo.ahead ? <Text color={COLORS.ok}>{`↑${repo.ahead}`}</Text> : null}
      {repo.behind ? <Text color={COLORS.label}>{`↓${repo.behind}`}</Text> : null}
      <Text size="caption" color={COLORS.label}>
        {repo.upstream === null ? 'no upstream' : `vs ${repo.upstream}`}
      </Text>
    </Box>,
    ...repo.files.map(file => (
      <Box key={`file:${file.path}`} flexDirection="row" gap="sm" alignItems="center">
        <Box flexGrow={1} flexShrink={1}>
          <Text mono size="footnote" wrap="truncate-start">
            {file.path}
          </Text>
        </Box>
        <Svg source={splitBarSvg(file.added, file.removed, file.fraction)} alt={`${file.added} added, ${file.removed} removed`} width={80} height={6} />
        <Text mono size="footnote">
          <Text color={COLORS.ok}>{`+${file.added}`}</Text> <Text color={COLORS.error}>{`−${file.removed}`}</Text>
        </Text>
      </Box>
    )),
    repo.moreFiles > 0 ? (
      <Text key="repo:more" size="caption" color={COLORS.label}>
        {`and ${repo.moreFiles} more`}
      </Text>
    ) : null,
    <Box key="repo:hooks" flexDirection="row" gap="sm" flexWrap="wrap">
      {repo.hooks.map(hook => (
        <Text size="caption" color={hook.isOk ? COLORS.ok : COLORS.error}>
          {`${hook.isOk ? '✓' : '✗'} ${hook.name} ${hook.detail === null ? '' : `· ${hook.detail} `}${hook.time}`}
        </Text>
      ))}
      {repo.untracked > 0 ? <Text size="caption" color={COLORS.label}>{`${repo.untracked} untracked`}</Text> : null}
    </Box>,
  ])
}

const mcpCard = (paint: Paint, board: Dashboard) => {
  const mcp = board.mcp

  if (mcp === null) {
    return null
  }

  const { Box, Text, Button, Svg } = paint.E

  return card(paint, 'mcp', 'MCP servers', `${mcp.calls} calls${mcp.timeouts > 0 ? ` · ${mcp.timeouts} timeout${mcp.timeouts === 1 ? '' : 's'}` : ''}`, [
    ...mcp.servers.map(row => (
      <Box key={`server:${row.name}`} flexDirection="row" gap="sm" alignItems="center">
        <Button key={`mcp:${row.name}`} plain onPress={() => paint.openServer(row.name)}>
          <Text color={row.health === 'ok' ? COLORS.ok : row.health === 'degraded' ? COLORS.warn : COLORS.error}>●</Text> {row.label}
        </Button>
        <Box flexGrow={1}>
          <Svg source={stripSvg(row, paint.accent)} alt={`${row.label}: ${row.total} calls`} height={22} />
        </Box>
        <Text mono size="footnote" color={COLORS.label}>
          {`${row.p50Text} / ${row.p95Text}`}
        </Text>
      </Box>
    )),
    mcp.lastTimeout === null ? null : (
      <Text key="mcp:timeout" size="footnote" color={COLORS.error}>
        {`✗ ${mcp.lastTimeout.server} · ${mcp.lastTimeout.tool} timed out after ${mcp.lastTimeout.time}`}
      </Text>
    ),
  ])
}

const slowCard = (paint: Paint, board: Dashboard) => {
  const slow = board.slow

  if (slow === null) {
    return null
  }

  const { Box, Text, Svg } = paint.E

  return card(
    paint,
    'slow',
    'Slowest tools',
    slow.turnTime === null ? slow.toolTime : `${slow.toolTime} of a ${slow.turnTime} turn`,
    slow.rows.map((row, index) => (
      <Box key={`slow:${index}`} flexDirection="row" gap="sm" alignItems="center">
        <Box width={6}>
          <Text size="footnote" color={COLORS.label}>
            {row.kind}
          </Text>
        </Box>
        <Box flexGrow={1} flexShrink={1}>
          <Text mono size="footnote" wrap="truncate">
            {row.label}
          </Text>
        </Box>
        <Svg source={barSvg(row.fraction, row.isFailed ? SVG_COLORS.error : row.kind === 'Agent' ? SVG_COLORS.agent : paint.accent, 110)} alt={`${row.time}`} width={110} height={6} />
        <Text mono size="footnote" color={row.isFailed ? COLORS.error : undefined}>
          {row.time}
        </Text>
      </Box>
    )),
  )
}

const agentsCard = (paint: Paint, board: Dashboard) => {
  const agents = board.agents

  if (agents === null) {
    return null
  }

  const { Box, Text } = paint.E

  return card(paint, 'agents', 'Agents', `${agents.running} running · ${agents.done} done`, [
    <Box key="agents:grid" flexDirection="row" gap="sm" flexWrap="wrap">
      {agents.cards.map(agent => (
        <Box key={`agent:${agent.id}`} flexDirection="column" borderStyle="round" borderColor={agent.state === 'running' ? COLORS.agent : COLORS.track} padding="sm" minWidth={22}>
          <Text weight="semibold" color={agent.state === 'running' ? COLORS.agent : agent.state === 'failed' ? COLORS.error : COLORS.ok}>
            {`${agent.state === 'running' ? '●' : agent.state === 'failed' ? '✗' : '✓'} ${agent.label}`}
          </Text>
          <Text size="caption" color={COLORS.label}>
            {`${agent.type} · ${agent.elapsed}`}
          </Text>
          <Text mono size="footnote">{`${agent.context} ctx · ${plural(agent.steps, 'step')}`}</Text>
        </Box>
      ))}
    </Box>,
  ])
}

const gateCard = (paint: Paint, board: Dashboard) => {
  const gate = board.gate

  if (gate === null) {
    return null
  }

  const { Box, Text, Svg } = paint.E
  const totals = gate.totals

  return card(paint, 'gate', 'Permissions', `${totals.rule + totals.approved + totals.pending + totals.denied} checks`, [
    <Svg key="gate:grid" source={gateSvg(gate.cells)} alt={`${totals.rule} allowed, ${totals.approved} approved, ${totals.pending} pending, ${totals.denied} denied`} />,
    <Box key="gate:legend" flexDirection="row" gap="md" flexWrap="wrap">
      <Text size="caption" color={COLORS.ok}>{`${totals.rule} allowed`}</Text>
      <Text size="caption" color={COLORS.approved}>{`${totals.approved} approved`}</Text>
      <Text size="caption" color={COLORS.warn}>{`${totals.pending} pending`}</Text>
      <Text size="caption" color={COLORS.error}>{`${totals.denied} denied`}</Text>
    </Box>,
  ])
}

const turnCard = (paint: Paint, board: Dashboard) => {
  const turn = board.turn

  if (turn === null) {
    return null
  }

  const { Box, Text } = paint.E

  return (
    <Box key="card:turn" flexDirection="row" justifyContent="space-between" borderStyle="round" borderColor={COLORS.track} padding="md">
      <Text>
        <Text weight="semibold" color={turn.isRunning ? paint.accent : undefined}>
          {turn.isRunning ? `▶ Turn ${turn.time}` : `Last turn ${turn.time}`}
        </Text>
        <Text color={COLORS.label}>{` · ${plural(turn.agents, 'agent')} · ${plural(turn.edits, 'edit')}`}</Text>
      </Text>
      <Text>
        <Text color={turn.errors > 0 ? COLORS.error : COLORS.label}>{`${turn.errors} error${turn.errors === 1 ? '' : 's'}`}</Text>
        <Text mono>{turn.cost === null ? '' : ` · ${turn.cost}`}</Text>
      </Text>
    </Box>
  )
}

const logCard = (paint: Paint, board: Dashboard) => {
  if (board.log.length === 0) {
    return null
  }

  const { Text } = paint.E

  return card(
    paint,
    'log',
    'Log',
    null,
    board.log.map(entry => (
      <Text size="footnote" wrap="truncate">
        <Text mono color={COLORS.label}>{`${formatClock(entry.at)}  `}</Text>
        <Text color={entry.kind === 'error' || entry.kind === 'denied' ? COLORS.error : undefined}>{entry.text}</Text>
      </Text>
    )),
  )
}

const DRAW: Record<Panel, (paint: Paint, board: Dashboard) => RenderChildren> = {
  main: mainCard,
  repo: repoCard,
  mcp: mcpCard,
  slowest: slowCard,
  agents: agentsCard,
  gate: gateCard,
  turn: turnCard,
  log: logCard,
}

export const drawRich = (E: Elements, board: Dashboard, accent: string, openServer: (name: string | null) => void) => {
  const { Box } = E
  const paint: Paint = { E, accent, openServer }

  if (board.detail !== null) {
    return drawDetail(paint, board.detail)
  }

  return (
    <Box flexDirection="column" gap="sm">
      {board.panels.map(name => DRAW[name](paint, board)).filter(drawn => drawn !== null)}
    </Box>
  )
}

const drawDetail = (paint: Paint, detail: ServerDetailView) => {
  const { Box, Text, Button, Svg } = paint.E
  const summary = detail.summary
  const longest = Math.max(1000, ...detail.calls.map(call => call.ms))

  return (
    <Box flexDirection="column" gap="sm">
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        <Text weight="semibold">{`MCP › ${summary.label}`}</Text>
        <Button key="back" label="Back" role="dismiss" onPress={() => paint.openServer(null)} />
      </Box>
      {card(paint, 'detail:summary', 'Summary', summary.health, [
        <Text key="detail:line">{`${summary.total} calls · ${summary.errors} errors · p50 ${summary.p50Text} · p95 ${summary.p95Text} · ${detail.timeInServer} in total`}</Text>,
      ])}
      {card(
        paint,
        'detail:tools',
        'By tool',
        null,
        detail.tools.map(tool => (
          <Box key={`tool:${tool.tool}`} flexDirection="row" justifyContent="space-between">
            <Text mono size="footnote">
              {tool.tool}
            </Text>
            <Text mono size="footnote" color={tool.errors > 0 ? COLORS.error : COLORS.label}>
              {`${tool.calls} calls · p50 ${tool.p50Text} · max ${tool.maxText}${tool.errors > 0 ? ` · ${tool.errors} errors` : ''}`}
            </Text>
          </Box>
        )),
      )}
      {card(
        paint,
        'detail:calls',
        'Calls',
        'latest last',
        detail.calls.map((call, index) => (
          <Box key={`call:${index}`} flexDirection="row" gap="sm" alignItems="center">
            <Text mono size="footnote" color={COLORS.label}>
              {formatClock(call.at)}
            </Text>
            <Box flexGrow={1} flexShrink={1}>
              <Text mono size="footnote" wrap="truncate">
                {call.tool}
              </Text>
            </Box>
            <Svg source={barSvg(call.ms / longest, call.isOk ? paint.accent : SVG_COLORS.error, 110)} alt={call.time} width={110} height={6} />
            <Text mono size="footnote" color={call.isOk ? undefined : COLORS.error}>
              {call.isTimeout ? `${call.time} timeout` : call.time}
            </Text>
          </Box>
        )),
      )}
      {summary.lastError === null
        ? null
        : card(paint, 'detail:error', 'Last error', formatClock(summary.lastError.at), [
            <Text key="detail:error:text" size="footnote" color={COLORS.error}>
              {`${summary.lastError.tool}: ${summary.lastError.detail ?? 'no message'}`}
            </Text>,
          ])}
    </Box>
  )
}
