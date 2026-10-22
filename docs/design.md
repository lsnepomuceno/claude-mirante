# Design

This document describes the layout and where each value comes from.

## Layouts

| Layout | Surface | When |
| --- | --- | --- |
| Docked pane | Terminal | fullscreen mode, beside the transcript; opened by `/mirante` or on session start from 144 columns |
| Summary | Terminal | inline above the prompt when the fullscreen layout is off, at most 8 rows: one row per panel that has something to show |
| Band | Terminal and desktop | with `layout` set to `band`: the summary above the prompt in every layout, fullscreen included, framed and titled; `/mirante hide` and `/mirante show` toggle it |
| Server drill-down | Terminal and desktop | from a row of the MCP panel or `/mirante mcp <server>`: one server's tools, its latest calls as bars, and the last error |
| Side panel | Desktop | the same panels as the docked pane, drawn with native controls and SVG |

### Terminal

- One font size. Hierarchy comes from color, bold and dim text only.
- Panels are rounded boxes with the title set into the top border, and a dim note on the right of the border when the panel has a summary (`4 servers · 48 calls`).
- Gauges and bars are block characters (`█` and `░`); latency strips are sparkline characters (`▁` to `█`); the permission grid is one cell per check.
- Labels sit in a fixed column so values line up down the panel.

### Desktop

- Panels are cards. The context gauge is a ring with the percent inside; limits, diff size and tool time are bars; MCP latency is one small bar per call; model, effort, branch, ahead and behind, hooks and agent state are colored pills.
- Text takes the app theme's colors. Rings, bars and pills are SVG with fixed colors chosen to read on both themes.
- Text sizes, weights and a monospace font for numbers and paths are used from Claude Code 2.1.307; older engines (the desktop app bundles its own) refuse them, so there the panel keeps plain text and leans on the SVG for color.

### Shared

- One accent color, configurable. Status colors are fixed: green for success, amber for slow or degraded, red for errors and denials, violet for subagents.
- Colors that must be told apart also differ in lightness, not hue alone.
- Panels with nothing to show take no room.

## Panels and sources

The names below are Claude Code mod events and engine calls.

### main

| Value | Source |
| --- | --- |
| model, effort, request count | the main loop's `turn.step` |
| session length | `$.session.usage()` at session start |
| context used and window size | `session.measure`, and the input of the latest main loop request |
| compactions | `session.compact` |
| turns before the context is full | estimate: average context growth over the last turns, labelled as an estimate |
| session cost | `session.measure` |
| last turn cost | the session cost at `turn.complete` less the cost at `turn.start` |
| cache hit rate | cache read tokens over all input tokens, from `turn.step` usage |
| rate limit windows and resets | `session.measure`, when the plan reports them |
| time to first token, output tokens per second | timed around the main loop's `turn.step` |

### repo

| Value | Source |
| --- | --- |
| repository, worktree, branch | the working directory of the session and of each shell call (`tool.call` for `Bash`), resolved with read-only git commands |
| ahead and behind | `git rev-list --left-right --count` against the upstream |
| files changed, lines added and removed | `git diff --numstat` against the merge base, refreshed after edits and shell calls |
| untracked files, stashes | `git ls-files --others --exclude-standard`, `git stash list` |
| hook results | shell calls running `git commit` or `git push`: exit status, duration, and the hook named in the output |

Git commands run only while the repo panel is enabled: once at session start, then after shell calls and edits settle, one refresh at a time and never on a timer.

### mcp

| Value | Source |
| --- | --- |
| server and tool | the tool name of each call (`mcp__<server>__<tool>`) |
| duration | timed around `next(e)` in the `tool.call` hook |
| errors and timeouts | the call result's error flag and text |
| p50, p95, max | computed over the session's calls |
| server state | healthy; degraded when one of the last five calls failed; down when the last three failed |

The drill-down lists each tool with its calls, p50, max and errors, the latest calls as bars, and the last error's message with credentials masked.

### slowest

The slowest tool calls of the session from `tool.call` durations, subagents included. The header compares the time tools kept the main loop busy (overlapping calls counted once) with the turn's wall time.

### agents

Cards from `agent.spawn`, updated by each subagent's `turn.step` and closed by its `turn.complete`: task, type, context, output tokens, steps and a clock. The running ones come first, then the latest finished, as many as fit.

### gate

One cell per `tool.check`, settled by the `tool.call` around it: allowed by a rule, approved (by the person or the auto-mode classifier), pending, denied. Checks made inside a subagent are dimmed. Totals by tool family.

### turn and log

The turn row comes from `turn.start` and `turn.complete`. A subagent handing its result back starts a turn of its own in the engine; mirante counts it as part of the turn that spawned the subagent. The log keeps the latest entries of prompts (first characters only), spawns, completions, edits, errors, denials, compactions and failed hooks.

## Privacy

- No network requests, no files written, nothing kept past the session.
- Prompts are cut to their first characters before they reach the log.
- Every summary of a tool call goes through a redaction step (authorization headers, bearer tokens, `*_TOKEN=` and `*_KEY=` assignments, passwords in URLs, common key prefixes) before it is kept.

## Configuration

| Option | Default | Meaning |
| --- | --- | --- |
| `panels` | `main,repo,mcp,slowest,agents,gate,turn,log` | which panels show, in order |
| `layout` | `pane` | `pane` or `band` |
| `accent` | `blue` | `blue`, `amber`, `green` or `violet` |
| `git` | `true` | enable the repo panel and its git commands |
| `slowest` | `5` | how many slow calls to list (1 to 10) |
| `openOnStart` | `true` | open the pane when a session starts |
| `statusLine` | `false` | context, cost and MCP trouble in the status line |
