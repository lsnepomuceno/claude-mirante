# Design

This document describes the layout under validation and where each value comes from. It is the contract for the first implementation; anything not listed here is out of scope for now.

## Layouts

| Layout | Surface | When |
| --- | --- | --- |
| Docked pane | Terminal | fullscreen mode, beside the transcript; opened by `/mirante` or on session start from 144 columns |
| Summary band | Terminal | above the prompt, at most 8 rows: one row per panel that has something to show |
| Server drill-down | Terminal | from the MCP panel: one server's tools, every call as a bar, and the last error |
| Side panel | Desktop | the same panels as the docked pane, drawn with native controls and SVG |

### Terminal

- One font size. Hierarchy comes from color, bold and dim text only.
- Panels are rounded boxes with the title set into the top border, and a dim note on the right of the border when the panel has a summary (`4 servers · 48 calls`).
- Gauges and bars are block characters (`█` and `░`); latency strips are sparkline characters (`▁` to `█`); the permission grid is one cell per check.
- Labels sit in a fixed column so values line up down the panel.

### Desktop

- Proportional font for labels, monospace for numbers, paths and commands.
- Panels are cards. The context gauge is a ring; limits, diff size and tool time are bars; MCP latency is one small bar per call.
- Follows the app theme, light or dark.

### Shared

- One accent color, configurable. Status colors are fixed: green for success, amber for slow or degraded, red for errors and denials, violet for subagents.
- Colors that must be told apart also differ in lightness, not hue alone.
- Panels with nothing to show take no room.

## Panels and sources

The names below are Claude Code mod events and engine calls.

### main

| Value | Source |
| --- | --- |
| model, effort, permission mode, request count | `turn.step`, session settings |
| context used and window size | `session.measure` |
| compactions | `session.compact` |
| turns before the next compaction | estimate: average context growth per turn over the last turns, labelled as an estimate |
| session cost, last turn cost | `$.session.usage()`, `turn.complete` |
| cache hit rate | cache read tokens over all input tokens, from `turn.step` usage |
| rate limit windows and resets | `$.session.usage()`, when the plan reports them |
| time to first token, output tokens per second | timed around the main loop's `turn.step` |
| retries | `turn.step` attempts |

### repo

| Value | Source |
| --- | --- |
| repository, worktree, branch | the working directory of the session and of each shell call (`tool.call` for `Bash`), resolved with read-only git commands |
| ahead and behind | `git rev-list --left-right --count` against the upstream |
| files changed, lines added and removed | `git diff --numstat` against the merge base, refreshed after edits and shell calls |
| untracked files, stashes | `git status --porcelain`, `git stash list` |
| hook results | shell calls running `git commit` or `git push`: exit status, duration, and the hook named in the output |

Git commands run only while the repo panel is enabled, never more than once per settled tool call, and never in the background on a timer.

### mcp

| Value | Source |
| --- | --- |
| server and tool | the tool name of each call (`mcp__<server>__<tool>`) |
| duration | timed around `next(e)` in the `tool.call` hook |
| errors and timeouts | the call result's error flag and text |
| p50, p95, max | computed over the session's calls |
| server state | healthy, degraded (a timeout or error in the last calls) or down (every recent call failed) |

The drill-down lists each tool's calls and the last error, with the call's input summarized and credentials masked.

### slowest

The five longest tool calls of the session from `tool.call` durations, plus subagents from `agent.spawn` to `turn.complete`. The header compares the summed tool time with the turn's wall time.

### agents

Cards from `agent.spawn`, updated by each subagent's `turn.step` and closed by its `turn.complete`: task, type, context, output tokens, steps and a clock. Beyond the cards that fit, swimlanes on one time axis.

### gate

One cell per `tool.check`, settled by the `tool.call` around it: allowed by a rule, approved (by the person or the auto-mode classifier), pending, denied. Checks made inside a subagent are dimmed. Totals by tool family.

### turn and log

The turn row comes from `turn.start` and `turn.complete`. The log keeps the last entries of prompts (first characters only), spawns, completions, edits, errors and denials; it filters to one agent while that agent's transcript is open.

## Privacy

- No network requests, no files written, nothing kept past the session.
- Prompts are cut to their first characters before they reach the log.
- Every summary of a tool call goes through a redaction step (authorization headers, bearer tokens, `*_TOKEN=` and `*_KEY=` assignments, passwords in URLs, common key prefixes) before it is kept.

## Configuration (planned)

| Option | Default | Meaning |
| --- | --- | --- |
| `panels` | `main,repo,mcp,slowest,agents,gate,turn,log` | which panels show, in order |
| `layout` | `auto` | `band`, `pane` or `auto` |
| `accent` | `blue` | accent color |
| `git` | `true` | enable the repo panel and its git commands |
| `slowest` | `5` | how many slow calls to list |
| `openOnStart` | `true` | offer to open the pane when a session starts |
