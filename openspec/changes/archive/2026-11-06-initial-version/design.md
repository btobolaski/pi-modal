# Design

## Context

See `proposal.md` for scope and `specs/session-modes/spec.md` for the behavior contract. This package targets Pi 1.5.0 and Node 22.19 or newer.

Pi's `before_agent_start` exposes structured prompt inputs once per run. Its `context_with_system` hook receives a request-local transcript before each agent inference, including calls after tool results. The public `getCurrentSystemMessage` helper from `@earendil-works/pi-ai` replays the effective system sections. These are the relevant boundaries for accepting a mode change while a run is active and applying it to the next inference.

## Goals / Non-Goals

**Goals:** One small installable package using native commands, picker, session entries, request hooks, and event bus. Keep mode definitions and selected state local to the owning extension instance.

**Non-Goals:** No permission engine, custom picker, prompt-builder fork, process-global registry, file watcher, durable work queue, build/CI pipeline, or new test framework. Internal compaction/summary requests are outside the prompt-projection scope. Other exclusions are listed in the proposal.

## Decisions

### 1. Package and mode files

Use `package.json` with `"type": "module"` and `pi.extensions: ["./index.ts"]`, one `index.ts` entry point, focused native test files (`index.test.ts`, `discovery.test.ts`, `projection.test.ts`, `selection.test.ts`, `query.test.ts`) sharing `test-helpers.ts`, and `README.md`. Pi loads TypeScript natively. Use Node's built-in `node:test` and `node:assert/strict`, with `node --test index.test.ts discovery.test.ts projection.test.ts selection.test.ts query.test.ts` as the check command; Node 22.19+ provides the required type stripping. Use pnpm for development installation and its lockfile. Declare the host SDK and `@earendil-works/pi-ai` as peers (`"*"`) and matching 1.5.0 development dependencies, not bundled/runtime copies.

Ship minimal local `.config/tools.toml` test wiring that delegates to `pnpm test`, which invokes the same Node command, without adding CI or a compilation step.

Use Pi's public `getAgentDir()` as the single agent-directory source for discovery and global classification. Discover direct `.md` files in `join(getAgentDir(), "modes")`, defaulting to `~/.pi/agent/modes` and honoring `PI_CODING_AGENT_DIR`. Mode identity is the exact filename stem. Reject stems that differ from their `trim()` result rather than trimming or aliasing them; internal spaces remain valid. Pi's TUI trims submitted trailing whitespace, so removing only command-argument trimming is not a complete fix. Ignore `auto.md` before parsing without diagnostics or a duplicate picker/completion entry. `/mode auto` always selects the built-in mode. Match only discovered names, never a path assembled from raw command input. Symlinks to regular files remain valid: follow candidate links with native `fs.stat` and reject a non-regular result before reading contents. Dangling links and invalid targets are individual candidate errors, not reasons to discard other modes. Do not independently reconstruct the agent-directory path.

Use Pi's public `parseFrontmatter`. Require a non-array YAML object with an exact supported string `replace_mode`; missing fields are not implicit `None`. Ignore unused metadata. Empty bodies are valid. Pi's parser normalizes newlines and trims the frontmatter-bearing body; untouched source content is preserved as loaded.

A missing modes directory means no custom modes, not a broken auto. Report invalid/unreadable custom files individually without disabling unrelated valid choices. Validate before accepting a selection, cache its body, and reload it on reselection, restoration, or `/reload`. No watchers or per-tool file reads.

Keep fresh post-picker validation, but report an unchanged underlying discovery failure once per command or restoration. Prefer one actionable selected-mode reason over also echoing its catalog error. Changed failures and later invocations must still be reported; do not add a long-lived suppression cache.

Use existing `node:test` filesystem mocks for directory/file permission errors rather than assuming `chmod(0)` produces `EACCES` under every UID/capability set. Route directory reads through `fs.readdir`, mirroring the existing `fs.readFile` property access: a captured named `readdir` import is not intercepted by `t.mock.method(fs, "readdir")`. Preserve directory-key, per-file diagnostic, and unrelated-mode assertions without adding a filesystem wrapper or new mocking dependency.

### 2. Global and project instruction groups

Normalize agent-directory and entry paths lexically for comparison without resolving symlinks, then classify by source directory rather than basename:

- **Global:** context-file entries loaded from Pi's agent directory returned by `getAgentDir()` (default `~/.pi/agent`).
- **Project:** every other context-file entry, including ancestor files and the session cwd.

`AGENTS.md` and `CLAUDE.md` are equivalent for matching. `AGENTS.override.md` is not exempt: it belongs to its source directory's group. Thus an ancestor CLAUDE.md is project context and a user-level CLAUDE.md is global context. A file belongs to one group even when the cwd is the global directory.

All six operations and empty-group insertion are required for this version.

| Operation | Group transformation |
| --- | --- |
| `None` | No prompt mutation |
| `ReplaceGlobal` | Replace the global group with one body at its first position |
| `ReplaceProject` | Replace all project entries with one body at the first project position |
| `ReplaceBoth` | Remove both groups and insert the body once at the global position |
| `Prepend` | Insert the body before the global group's content |
| `Append` | Insert the body after the global group's content |

For a replacement, reuse the first replaced entry's logical path for its in-memory block and remove the other entries in that group. Prepend/Append preserve the group and add the body to its first/last entry, separated by a blank line only when both parts are nonempty. If a receiving group is empty, insert a synthetic instruction block first or after existing context for global/project respectively. Label it `pi-modal:global` or `pi-modal:project` rather than claiming it is an on-disk file; these labels also avoid aliasing a global file when the cwd is the global directory. ReplaceBoth needs no second project entry. Never write instruction files to disk.

### 3. Request-local prompt projection

A once-per-run mutation cannot satisfy changes before the next inference inside an active tool loop. Use `before_agent_start` only to retain the public `systemPromptOptions` reference without modifying it. The same object is shared through that run's handler chain, so the later request hook observes final context-file descriptors and forced-prompt flags.

Use `context_with_system` for the transformation. Read the latest accepted selection at that boundary; auto and None return without changing messages. Replay the current system sections with the public `getCurrentSystemMessage` helper. Compute the replacement before mutating the request-local transcript.

The SDK does not expose a public per-inference context-file renderer. Keep the compatibility adapter limited to the `project_context` section: locate the exact rendered `<project_instructions path="...">` blocks using the captured logical paths and complete source contents, then replace/remove only the selected group blocks. Require unique, non-overlapping matches, rather than parsing arbitrary Markdown or using a broad regex. Preserve text outside those blocks. The only formatting to synthesize is one native-shaped file block, or the small project-context wrapper when no section exists. Verify this adapter against Pi 1.5.0's actual request context; do not import private prompt-building modules or introduce marker files.

Set the computed section on the leading request-local system message and remove only subsequent `project_context` patch keys that would override it. Preserve every other section, message content, timestamp, and tool declaration/delta. Do not write this projection back to session history, append a mode instruction message, or change models, thinking, or tool selection. Every inference starts from the freshly chained request baseline, so A-to-B-to-auto cannot accumulate prior transformations.

If a forced opaque prompt or incompatible/ambiguous context layout prevents transformation, report it and mark the selected mode unavailable without a partial edit. Auto and None remain usable because they require no projection. Later request handlers or provider-payload rewrites can still override our result; this extension does not take ownership of their hooks. Native prompt-inspection APIs can show the baseline rather than this final request-local projection.

### 4. Selection, queued application, and branch state

Register `/mode <name>` with completion and use `ctx.ui.select` for bare `/mode` when dialog UI exists. Otherwise report selected identity and availability. List auto first and custom names in stable lexical order. Do not reserve subcommand names such as `status`. Use native notifications, not a custom widget.

Accept valid choices while idle, streaming, running tools, or awaiting queued continuation. Do not reject because `isIdle()` is false, messages are pending, or a live run has advanced the branch leaf. Validate the definition before attempting acceptance; use the append-first ordering below rather than publishing a provisional choice. If a picker/file read awaits, check session identity before committing, not leaf equality. Cancellation, invalid input, or a replaced session must not overwrite a valid selection.

Call synchronous, void-returning `pi.appendEntry("pi-modal:mode", { id })` first; do not await it. Only after it returns, update the selected id/body/availability and query snapshot together, then acknowledge acceptance. If it throws, the choice is not accepted: retain the previous selection and snapshot and report an actionable save error. Delegate session storage and its failure behavior to Pi; add no extension rollback, retry, or stronger durability layer. Record explicit auto and same-name reselection the same way, and store no body text in entries.

The accepted choice is the desired mode for the next agent inference. This selected state is the minimal queue: the request hook samples it before each inference; no FIFO, background worker, or separate durable queue is needed. The latest valid accepted choice wins if several arrive before a boundary. An invalid attempt does not erase a prior accepted choice. An already-started request and its generated tool calls are not retroactively changed. A request that starts before selection has been validated/accepted still belongs to the prior choice.

The query API reports the selected mode immediately, not a claim that an in-flight request used it. The next agent inference, including one after tool results in the same run, projects the new choice. Internal compaction/summary calls do not use this projection.

Restore on `session_start` and `session_tree` by scanning `getBranch()` for the last matching choice, never `getEntries()` across siblings. Clear stale ready state before restoration I/O. A branch without a choice and a new session use auto. Resume/fork/clone/tree/reload load the current definition for that branch's saved id. Compaction does not erase selection entries. Ephemeral sessions retain native in-memory behavior without promising process-restart persistence.

### 5. Availability and read-only discovery

Keep either a ready selection (id, operation, cached body) or an unavailable requested selection (id, reason). Missing/unreadable/invalid saved definitions require an explicit valid choice rather than auto or stale text. While unavailable, consume normal input with `{ action: "handled" }` and an actionable notification; keep `/mode` usable for recovery. Block `tool_call` with a reason and `terminate: true`.

Neither prompt hook is a cancellation gate: thrown errors are logged rather than reliably preventing model requests. Record projection failures explicitly and rely on the bounded input/tool gates, not throw-as-cancel or prompt text. Direct extension I/O, human shell commands, and universal model-request cancellation are outside this gate.

Expose the required in-process `pi-modal:query` channel:

```ts
type ModeQuery = { sessionId: string; respond: (snapshot: ModeSnapshot) => void };
type ModeSnapshot = Readonly<
  { sessionId: string; id: string } &
    ({ ready: true; reason?: never } | { ready: false; reason: string })
>;
```

Validate request shape and session identity. Respond synchronously without I/O or awaits, with a frozen primitive-only copy. Ready means the selected definition is available; it is not an assertion about a previous/in-flight request. Unavailable state includes a nonempty actionable reason and the requested id. Filename eligibility and safe saved-entry decoding are distinct: a previously saved padded name remains unavailable under its exact id, not a trimmed alias or malformed-entry placeholder. Reserve the placeholder for malformed saved data or unsafe path-like ids, not names whose files fail current eligibility rules. No body text or setter is exposed.

Register at extension initialization but respond only after session state exists and only for its session id. Consumers query at point of use and treat no response as unavailable. Dispose the listener and clear state on shutdown/reload; load one package copy per session. No broadcasts, imported singleton, external state transport, or child inheritance are included.

## Risks / Trade-offs

- [Native context-section format can change] → Scope the small block adapter to the supported runtime and verify actual request output. An incompatible layout becomes an explicit unavailable state, not a silent wrong prompt.
- [Later extensions can rewrite prompts] → Preserve earlier unrelated edits, document hook-order limits, and test representative earlier/later handlers without promising ownership of the provider payload.
- [Request-local projection is not shown by every inspector or used by internal model calls] → Document the boundary and verify the outgoing agent request context, not only `ctx.getSystemPrompt()`.
- [Selection does not rewrite an active request or erase history] → Acknowledge acceptance, apply at the next agent inference, and retain existing conversation/session semantics.
- [Readiness is not universal cancellation or authorization] → Test the native input/tool gates separately; do not infer permissions from mode names.

## Migration Plan

Implement and check the new package locally, then smoke-test it once with isolated HOME/session fixtures against the supported Pi runtime. Leave permission integrations and external repositories unchanged. To remove it, unload/uninstall and reload Pi; instruction files were never modified and inert native selection entries can remain.
