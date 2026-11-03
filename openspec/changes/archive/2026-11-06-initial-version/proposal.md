# Proposal

## Why

Pi needs a small, session-local way to select named instruction modes and let other extensions discover the current mode. The initial version should change only the requested instruction content, without becoming a permission, model, or workflow manager.

## What Changes

- Add an installable Pi extension package with built-in `auto`: the default for new sessions, requiring no mode file and making no prompt changes.
- Discover custom modes from Pi's resolved agent directory at `modes/<name>.md` (default `~/.pi/agent/modes/<name>.md`). Require YAML frontmatter with `replace_mode` equal to `None`, `ReplaceGlobal`, `ReplaceProject`, `ReplaceBoth`, `Prepend`, or `Append`; use the Markdown body as instructions.
- Treat Pi's loaded user-level context from that same resolved agent directory as global and all remaining context files, including ancestors, as project. Match `CLAUDE.md` equivalently to `AGENTS.md`, and include overrides in their source group. ReplaceProject collapses the project group to one body; ReplaceBoth inserts the body once overall. Supply empty receiving groups in memory, never by editing instruction files.
- Offer `/mode <name>` and a native `/mode` picker. Accept valid selections during active work and apply the latest choice before the next agent inference, including calls after tool results; do not discard busy selections or rewrite in-flight requests. Save accepted choices on the active branch and restore them on resume, fork, tree navigation, and reload. New branches without a saved choice use `auto`.
- If a saved custom mode is missing or invalid, require an explicit valid selection instead of silently using `auto`. Block normal input and tool execution through Pi's native gates while unavailable; do not promise cancellation of model requests initiated by other extensions.
- Expose session-scoped, read-only mode state to other in-process extensions, including `auto` and unavailable state.

## Capabilities

### New Capabilities

- `session-modes`: File-defined instruction modes, prompt transformation, human selection, branch-aware state, and read-only discovery by other extensions.

### Modified Capabilities

None. This repository has no existing specifications or extension implementation.

## Impact

- Future implementation adds package metadata, minimal development dependencies and project-tools test configuration, the extension entry point, focused runnable checks, and usage/API documentation in this repository. Use Node's built-in test runner and pnpm development installation. No publishing/build/CI workflow is included.
- Target Pi 1.5.0's command/picker, session-entry, and event-bus APIs. Observe structured prompt inputs at `before_agent_start` and project mode instructions through the native per-inference `context_with_system` hook. Reuse the public frontmatter parser and transcript replay helper, without a whole-prompt builder or new YAML dependency.
- Preserve Pi's base instructions, tools, skills, other extension additions, and all untargeted context entries. Existing conversation history is not erased.
- Out of scope: permission/Moriarty/Stop-hook integration, child-mode propagation, Nix deployment, mode manifests, configurable defaults, shortcuts, launch flags, file watchers, custom UI, and model/thinking/tool-set changes. Internal compaction/summary calls are outside the agent-inference projection scope.
