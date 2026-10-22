<h1 align="center">mirante</h1>

<p align="center">
  A live session dashboard for Claude Code, in the terminal and in the desktop app.
  <br>Context, cost and limits, your repository and worktree, MCP server health,
  <br>the slowest tools, subagents, permission checks and a session log, side by side with the chat.
</p>

<p align="center"><i>Mirante</i> is Portuguese for a lookout: the high point you climb to see everything around you.</p>

> **Status: design phase.** The layout is being validated before the first line of code. Nothing here is installable yet.

## Why

A Claude Code session hides most of what it does behind a spinner. When a turn takes four minutes you want to know where the time went: a test run, a subagent, an MCP server that stopped answering, a git hook that failed. mirante answers that at a glance, without leaving the session.

## What it shows

| Panel | Shows |
| --- | --- |
| **main** | model, effort and permission mode; a context gauge with compactions and an estimate of turns left before the next one; session and last turn cost; cache hit rate; rate limit windows with their resets; time to first token and output speed |
| **repo** | the repository and worktree the shell is working in, the branch with ahead and behind counts, the files changed with lines added and removed, and the result of the last git hooks (pre-commit, pre-push) |
| **mcp** | one row per MCP server: calls, p50 and p95 latency, errors, and a strip with every call of the session; timeouts called out on their own line, with a drill-down per server and per tool |
| **slowest** | the tools that took the longest this session (shell commands, MCP calls, subagents, web fetches) against the turn's wall time |
| **agents** | subagents as cards: task, type, context, steps and a running clock |
| **gate** | one cell per permission check: allowed by a rule, approved, pending or denied, with totals by tool |
| **turn** | the running or last turn: duration, agents, edits, errors and cost added |
| **log** | prompts, spawns, completions, edits, errors and denials, in order |

Panels with nothing to show take no room.

## Where it runs

mirante is a [Claude Code mod](https://claude.com/blog/claude-code-mods). Every panel is drawn for each surface a mod can draw on:

| Surface | Layouts | Drawing |
| --- | --- | --- |
| **Terminal (CLI)** | a pane docked beside the transcript in fullscreen, or a summary band of up to 8 rows above the prompt | box drawing and block characters, one font size, color for hierarchy |
| **Desktop app** | a side panel | native controls, SVG gauges and bars, light and dark themes |

The data and the rules are shared; only the drawing changes between surfaces.

## Principles

- **Observe only.** Every hook passes its event on unchanged: mirante never blocks, rewrites or delays a tool call, a prompt or a subagent.
- **Local only.** No network requests, no telemetry, nothing stored past the session.
- **Measured, not guessed.** Every number comes from a session event. Anything inferred (such as the turns left before compaction) is labelled as an estimate.
- **Credentials masked.** Summaries of tool calls are redacted before they are kept in session state.
- **Git is optional.** Reading git state runs read-only git commands; turning the repo panel off stops them.

## Roadmap

- [ ] Validate the layout for the terminal and the desktop app
- [ ] Event model and state contract
- [ ] Terminal pane and summary band
- [ ] Desktop panel
- [ ] Repo panel with git state and hook results
- [ ] MCP panel with per server and per tool drill-down
- [ ] Configuration: panels, order, layout, accent color
- [ ] Tests on every surface
- [ ] Marketplace entry and first release

See [docs/design.md](docs/design.md) for the layout and where each number comes from.

## License

[MIT](LICENSE)
