import type { ElementTable, RenderChildren } from 'claude-code'

import type { LogLine } from '../types'

import { COLORS, SVG_COLORS, formatClock, plural, shorten } from './core'
import type { Panel } from './core'
import type { Dashboard, GateView, McpRowView, ServerDetailView } from './view'

type Elements = Pick<ElementTable<'desktop'>, 'Box' | 'Text' | 'Button' | 'Svg'>
type Paint = { E: Elements; accent: string; openServer: (name: string | null) => void; type: Typography }
type Typography = {
  caption: Record<string, unknown>
  footnote: Record<string, unknown>
  mono: Record<string, unknown>
  number: Record<string, unknown>
}

const MODERN: Typography = {
  caption: { size: 'caption' },
  footnote: { size: 'footnote' },
  mono: { mono: true },
  number: { mono: true, tabular: true },
}

const LEGACY: Typography = { caption: {}, footnote: {}, mono: {}, number: {} }

const BAR_WIDTH = 300

const PILL = { accent: '#2F6FDB', ok: '#23845A', error: '#C9423C', agent: '#7C4DDB', neutral: '#5A6270', warn: '#A86B0C' } as const

const escapeSvg = (text: string): string => text.replace(/[<>&"]/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[char] ?? char)

const pillSvg = (text: string, fill: string): { source: string; width: number } => {
  const width = Math.round(text.length * 6.6 + 18)

  return {
    width,
    source: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" viewBox="0 0 ${width} 20"><rect width="${width}" height="20" rx="10" fill="${fill}"/><text x="${width / 2}" y="14" text-anchor="middle" font-family="Inter,system-ui,-apple-system,Segoe UI,sans-serif" font-size="11.5" font-weight="600" fill="#FFFFFF">${escapeSvg(text)}</text></svg>`,
  }
}

const KIND_COLOR: Record<string, string> = { Agent: SVG_COLORS.agent, MCP: '#2BB5A8', Web: SVG_COLORS.warn }

const shortenStart = (text: string, room: number): string => (text.length <= room ? text : `…${text.slice(text.length - room + 1)}`)

const ringSvg = (fraction: number, color: string, label: string): string => {
  const radius = 34
  const length = 2 * Math.PI * radius
  const drawn = Math.min(1, Math.max(0, fraction)) * length

  return `<svg xmlns="http://www.w3.org/2000/svg" width="84" height="84" viewBox="0 0 84 84"><circle cx="42" cy="42" r="${radius}" fill="none" stroke="${SVG_COLORS.track}" stroke-width="9"/><circle cx="42" cy="42" r="${radius}" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${drawn.toFixed(1)} ${length.toFixed(1)}" transform="rotate(-90 42 42)"/><text x="42" y="48" text-anchor="middle" font-family="Inter,system-ui,-apple-system,Segoe UI,sans-serif" font-size="18" font-weight="700" fill="${color}">${escapeSvg(label)}</text></svg>`
}

const barSvg = (fraction: number, color: string, width = BAR_WIDTH, height = 8): string => {
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
  const perRow = 24
  const rows = Math.max(1, Math.ceil(cells.length / perRow))
  const squares = cells
    .map((cell, index) => {
      const x = (index % perRow) * 13
      const y = Math.floor(index / perRow) * 13
      const fill = cell.isSubagent && cell.verdict === 'rule' ? SVG_COLORS.quiet : GATE_FILL[cell.verdict]

      return `<rect x="${x}" y="${y}" width="11" height="11" rx="3" fill="${fill}"/>`
    })
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${perRow * 13}" height="${rows * 13}" viewBox="0 0 ${perRow * 13} ${rows * 13}">${squares}</svg>`
}

const card = (paint: Paint, key: string, title: string, note: string | null, children: RenderChildren[]) => {
  const { Box, Text } = paint.E

  return (
    <Box key={`card:${key}`} flexDirection="column" borderStyle="round" borderColor={COLORS.track} padding={1} gap={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>{title}</Text>
        {note === null ? null : (
          <Text {...paint.type.caption} color={COLORS.label}>
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
      <Text {...paint.type.caption} color={COLORS.label}>
        {label}
      </Text>
      <Text {...paint.type.number} bold color={color}>
        {value}
      </Text>
    </Box>
  )
}

const pill = (paint: Paint, key: string, text: string, fill: string) => {
  const { Svg } = paint.E
  const drawn = pillSvg(text, fill)

  return <Svg key={key} source={drawn.source} alt={text} width={drawn.width} height={20} />
}

const mainCard = (paint: Paint, board: Dashboard) => {
  const { Box, Text, Svg } = paint.E
  const main = board.main
  const percent = main.context?.percent ?? 0
  const limits = main.limits.map(limit => (
    <Box key={`limit:${limit.label}`} flexDirection="column" gap={0}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text {...paint.type.caption} color={COLORS.label}>
          {`${limit.label} limit`}
        </Text>
        <Text {...paint.type.caption} {...paint.type.mono}>
          {`${limit.percent}%${limit.reset === null ? '' : ` · resets ${limit.reset}`}`}
        </Text>
      </Box>
      <Svg source={barSvg(limit.fraction, limit.percent >= 80 ? SVG_COLORS.error : limit.percent >= 50 ? SVG_COLORS.warn : SVG_COLORS.ok)} alt={`${limit.label} limit ${limit.percent} percent used`} />
    </Box>
  ))

  const chips = [main.model, main.effort].filter((chip): chip is string => chip !== null)

  return card(paint, 'main', 'Session', main.sessionTime === null ? null : main.sessionTime, [
    <Box key="main:chips" flexDirection="row" gap={1}>
      {chips.map((chip, index) => pill(paint, `chip:${index}`, chip, index === 0 ? PILL.accent : PILL.neutral))}
    </Box>,
    <Box key="main:row" flexDirection="row" gap={1} alignItems="center">
      <Box flexDirection="column" alignItems="center">
        <Svg source={ringSvg(percent / 100, percent >= 85 ? SVG_COLORS.warn : paint.accent, main.context === null ? '·' : `${percent}%`)} alt={`Context ${percent} percent used`} width={84} height={84} />
        <Text {...paint.type.caption} color={COLORS.label}>
          {main.context === null ? 'context' : `${main.context.used}/${main.context.window}`}
        </Text>
      </Box>
      <Box flexDirection="column" gap={1} flexGrow={1}>
        <Box flexDirection="row" gap={1}>
          {stat(paint, 'Session cost', main.cost ?? '·')}
          {stat(paint, 'Cache hit', main.cacheHit === null ? '·' : `${main.cacheHit}%`, main.cacheHit !== null && main.cacheHit >= 60 ? COLORS.ok : undefined)}
        </Box>
        <Box flexDirection="row" gap={1}>
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
    <Box key="repo:branch" flexDirection="row" gap={1} alignItems="center">
      {pill(paint, 'repo:branch:name', `⎇ ${repo.branch}`, PILL.accent)}
      {repo.ahead ? pill(paint, 'repo:ahead', `↑${repo.ahead}`, PILL.ok) : null}
      {repo.behind ? pill(paint, 'repo:behind', `↓${repo.behind}`, PILL.warn) : null}
      <Text {...paint.type.caption} color={COLORS.label}>
        {repo.upstream === null ? 'no upstream' : `vs ${repo.upstream}`}
      </Text>
    </Box>,
    ...repo.files.map(file => (
      <Box key={`file:${file.path}`} flexDirection="row" gap={1} alignItems="center">
        <Box flexGrow={1} flexShrink={1}>
          <Text {...paint.type.mono} {...paint.type.footnote} wrap="truncate-start">
            {shortenStart(file.path, 34)}
          </Text>
        </Box>
        <Svg source={splitBarSvg(file.added, file.removed, file.fraction)} alt={`${file.added} added, ${file.removed} removed`} width={80} height={6} />
        <Text {...paint.type.mono} {...paint.type.footnote}>
          <Text color={COLORS.ok}>{`+${file.added}`}</Text> <Text color={COLORS.error}>{`−${file.removed}`}</Text>
        </Text>
      </Box>
    )),
    repo.moreFiles > 0 ? (
      <Text key="repo:more" {...paint.type.caption} color={COLORS.label}>
        {`and ${repo.moreFiles} more`}
      </Text>
    ) : null,
    <Box key="repo:hooks" flexDirection="row" gap={1} flexWrap="wrap">
      {repo.hooks.map((hook, index) => pill(paint, `hook:${index}`, `${hook.isOk ? '✓' : '✗'} ${hook.name} ${hook.time}`, hook.isOk ? PILL.ok : PILL.error))}
      {repo.untracked > 0 ? <Text {...paint.type.caption} color={COLORS.label}>{`${repo.untracked} untracked`}</Text> : null}
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
      <Box key={`server:${row.name}`} flexDirection="row" gap={1} alignItems="center">
        <Button key={`mcp:${row.name}`} plain onPress={() => paint.openServer(row.name)}>
          <Text color={row.health === 'ok' ? COLORS.ok : row.health === 'degraded' ? COLORS.warn : COLORS.error}>●</Text> {row.label}
        </Button>
        <Box flexGrow={1}>
          <Svg source={stripSvg(row, paint.accent)} alt={`${row.label}: ${row.total} calls`} height={22} />
        </Box>
        <Text {...paint.type.mono} {...paint.type.footnote} color={COLORS.label}>
          {`${row.p50Text} / ${row.p95Text}`}
        </Text>
      </Box>
    )),
    mcp.lastTimeout === null ? null : (
      <Text key="mcp:timeout" {...paint.type.footnote} color={COLORS.error}>
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
      <Box key={`slow:${index}`} flexDirection="row" gap={1} alignItems="center">
        <Box width={6}>
          <Text {...paint.type.footnote} color={COLORS.label}>
            {row.kind}
          </Text>
        </Box>
        <Box flexGrow={1} flexShrink={1}>
          <Text {...paint.type.mono} {...paint.type.footnote} wrap="truncate">
            {shorten(row.label, 24)}
          </Text>
        </Box>
        <Svg source={barSvg(row.fraction, row.isFailed ? SVG_COLORS.error : KIND_COLOR[row.kind] ?? paint.accent, 64)} alt={`${row.time}`} width={64} height={8} />
        <Text {...paint.type.mono} {...paint.type.footnote} color={row.isFailed ? COLORS.error : undefined}>
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
    <Box key="agents:grid" flexDirection="row" gap={1} flexWrap="wrap">
      {agents.cards.map(agent => (
        <Box key={`agent:${agent.id}`} flexDirection="column" borderStyle="round" borderColor={agent.state === 'running' ? COLORS.agent : COLORS.track} padding={1} minWidth={22}>
          <Text bold color={agent.state === 'running' ? COLORS.agent : agent.state === 'failed' ? COLORS.error : COLORS.ok}>
            {`${agent.state === 'running' ? '●' : agent.state === 'failed' ? '✗' : '✓'} ${agent.label}`}
          </Text>
          <Text {...paint.type.caption} color={COLORS.label}>
            {agent.type}
          </Text>
          <Text {...paint.type.mono} {...paint.type.footnote}>{`${agent.context} ctx · ${plural(agent.steps, 'step')}`}</Text>
          {pill(paint, `agent:${agent.id}:state`, agent.state === 'running' ? `running ${agent.elapsed}` : agent.state === 'failed' ? `failed ${agent.elapsed}` : `done in ${agent.elapsed}`, agent.state === 'running' ? PILL.agent : agent.state === 'failed' ? PILL.error : PILL.ok)}
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
    <Box key="gate:legend" flexDirection="row" gap={1} flexWrap="wrap">
      <Text {...paint.type.caption} color={COLORS.ok}>{`${totals.rule} allowed`}</Text>
      <Text {...paint.type.caption} color={COLORS.approved}>{`${totals.approved} approved`}</Text>
      <Text {...paint.type.caption} color={COLORS.warn}>{`${totals.pending} pending`}</Text>
      <Text {...paint.type.caption} color={COLORS.error}>{`${totals.denied} denied`}</Text>
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
    <Box key="card:turn" flexDirection="row" justifyContent="space-between" borderStyle="round" borderColor={COLORS.track} padding={1}>
      <Text>
        <Text bold color={turn.isRunning ? paint.accent : undefined}>
          {turn.isRunning ? `▶ Turn ${turn.time}` : `Last turn ${turn.time}`}
        </Text>
        <Text color={COLORS.label}>{` · ${plural(turn.agents, 'agent')} · ${plural(turn.edits, 'edit')}`}</Text>
      </Text>
      <Text>
        <Text color={turn.errors > 0 ? COLORS.error : COLORS.label}>{`${turn.errors} error${turn.errors === 1 ? '' : 's'}`}</Text>
        <Text {...paint.type.mono}>{turn.cost === null ? '' : ` · ${turn.cost}`}</Text>
      </Text>
    </Box>
  )
}

const LOG_MARK: Record<LogLine['kind'], [string, string | undefined]> = {
  prompt: ['›', undefined],
  spawn: ['⇢', COLORS.agent],
  done: ['✓', COLORS.ok],
  edit: ['✎', COLORS.approved],
  error: ['✗', COLORS.error],
  denied: ['■', COLORS.error],
  compact: ['⟲', COLORS.warn],
  hook: ['⚑', COLORS.warn],
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
      <Text {...paint.type.footnote} wrap="truncate">
        <Text {...paint.type.mono} color={COLORS.label}>{`${formatClock(entry.at)}  `}</Text>
        <Text bold color={LOG_MARK[entry.kind][1] ?? paint.accent}>{`${LOG_MARK[entry.kind][0]} `}</Text>
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

export const drawRich = (
  E: Elements,
  board: Dashboard,
  accent: string,
  openServer: (name: string | null) => void,
  hasTypography: boolean,
) => {
  const { Box } = E
  const paint: Paint = { E, accent, openServer, type: hasTypography ? MODERN : LEGACY }

  if (board.detail !== null) {
    return drawDetail(paint, board.detail)
  }

  return (
    <Box flexDirection="column" gap={1}>
      {board.panels.map(name => DRAW[name](paint, board)).filter(drawn => drawn !== null)}
    </Box>
  )
}

const drawDetail = (paint: Paint, detail: ServerDetailView) => {
  const { Box, Text, Button, Svg } = paint.E
  const summary = detail.summary
  const longest = Math.max(1000, ...detail.calls.map(call => call.ms))

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        <Text bold>{`MCP › ${summary.label}`}</Text>
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
            <Text {...paint.type.mono} {...paint.type.footnote}>
              {shorten(tool.tool, 30)}
            </Text>
            <Text {...paint.type.mono} {...paint.type.footnote} color={tool.errors > 0 ? COLORS.error : COLORS.label}>
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
          <Box key={`call:${index}`} flexDirection="row" gap={1} alignItems="center">
            <Text {...paint.type.mono} {...paint.type.footnote} color={COLORS.label}>
              {formatClock(call.at)}
            </Text>
            <Box flexGrow={1} flexShrink={1}>
              <Text {...paint.type.mono} {...paint.type.footnote} wrap="truncate">
                {shorten(call.tool, 30)}
              </Text>
            </Box>
            <Svg source={barSvg(call.ms / longest, call.isOk ? paint.accent : SVG_COLORS.error, 64)} alt={call.time} width={64} height={8} />
            <Text {...paint.type.mono} {...paint.type.footnote} color={call.isOk ? undefined : COLORS.error}>
              {call.isTimeout ? `${call.time} timeout` : call.time}
            </Text>
          </Box>
        )),
      )}
      {summary.lastError === null
        ? null
        : card(paint, 'detail:error', 'Last error', formatClock(summary.lastError.at), [
            <Text key="detail:error:text" {...paint.type.footnote} color={COLORS.error}>
              {`${summary.lastError.tool}: ${summary.lastError.detail ?? 'no message'}`}
            </Text>,
          ])}
    </Box>
  )
}
