# pi-modal

Session-local instruction modes for Pi **1.5.0**. No build step or prompt-file edits. Only Pi 1.5.0 is supported/tested; other versions may fail to load or report incompatible projection inputs. Wildcard host peers follow Pi's packaging convention, not a promise of compatibility with every version.

## Install

From a local checkout:

```sh
pi install /path/to/pi-modal
```

Or try it for one invocation with `pi -e /path/to/pi-modal`. Load only one copy per session. Pi supplies the SDK and transcript helpers; this package does not bundle them.

## Develop

Enter the existing Nix shell with `nix develop` (or use direnv with the checked-in `.envrc`). It provides Node 22 and pnpm, plus Prettier, Taplo, treefmt, and Alejandra. **Node 22.19+** is required for native TypeScript stripping. Formatter configuration is environment-provided; this repository ships none (`.config/tools.toml` only wires tests).

```sh
pnpm install --ignore-scripts --frozen-lockfile
node --test index.test.ts discovery.test.ts projection.test.ts selection.test.ts query.test.ts
```

If pnpm reports previously recorded ignored builds, repeat the install with `--force --ignore-scripts --frozen-lockfile`. Dependency lifecycle scripts are not needed. `pnpm test` runs the same native Node command; `.config/tools.toml` delegates to `pnpm test` for project-tools, keeping the executable command in `package.json`. No compilation or CI setup is required.

## Mode files

Custom modes are direct `<name>.md` files in `join(getAgentDir(), "modes")`: normally `~/.pi/agent/modes/`, honoring Pi's `PI_CODING_AGENT_DIR` configuration. Names are exact, case-sensitive filename stems, not paths. Surrounding whitespace is rejected, never trimmed into an alias; internal spaces (for example `review notes.md`) are valid. Symlinks to regular mode files work; non-regular symlink targets are rejected before reading contents. Subdirectories and non-`.md` files are ignored.

Create `review.md` there:

```markdown
---
replace_mode: ReplaceProject
---
Review changes for correctness. Do not modify files.
```

The YAML frontmatter must be an object with an exact `replace_mode` value: `None`, `ReplaceGlobal`, `ReplaceProject`, `ReplaceBoth`, `Prepend`, or `Append`. Other metadata is ignored. The Markdown body supplies instructions; an empty body is valid. Pi's parser normalizes BOM/newlines and trims a frontmatter-bearing body, including surrounding whitespace.

Built-in `auto` is the default and needs no file. `auto.md` is ignored, even if invalid. A missing modes directory leaves auto usable. Invalid YAML/fields and unreadable files produce individual diagnostics without excluding unrelated valid choices. Definitions are cached on selection, reloaded on reselection/restoration or Pi `/reload`, not watched or read before every tool call.

## Instruction projection

Global means context loaded from Pi's resolved agent directory; project means **every other loaded file**, including ancestor directories and the cwd. `AGENTS.md`, `CLAUDE.md`, and override files are treated by source directory, not exempted by filename. Logical paths determine the group, even for symlinks; a file belongs to one group when cwd is the agent directory.

| `replace_mode` | Effect |
| --- | --- |
| `None` | No prompt change (the custom identity remains selected) |
| `ReplaceGlobal` | Replace global entries once, at the first global path |
| `ReplaceProject` | Replace all project entries once, at the first project path |
| `ReplaceBoth` | Remove both groups; insert the body once at the global position |
| `Prepend` | Add body before the first global entry's content |
| `Append` | Add body after the last global entry's content |

Prepend/Append use a blank line only when both parts are nonempty. For example, global `GLOBAL` plus body `MODE` with Append becomes `GLOBAL\n\nMODE`, before the next context file. Missing receiving groups get in-memory blocks labeled `pi-modal:global` (first) or `pi-modal:project` (last), never files on disk.

Every agent inference projects from the fresh chained request baseline. Changing A → B → auto cannot accumulate mode instructions. Untargeted files, other prompt sections, earlier unrelated extension edits, message content, and tool deltas are preserved. Instruction files, stored history, models, thinking levels, and tool settings are **not rewritten**; previous conversation content remains.

The adapter matches Pi 1.5.0's exact source blocks, not arbitrary Markdown. Forced opaque prompts or ambiguous/incompatible source blocks make the selected mode unavailable, with no partial projection; auto or None can recover without projecting. Native baseline prompt inspection (for example `ctx.getSystemPrompt()`) can differ from the final request-local projection. Later request handlers or provider-payload rewrites can still override it.

## Selecting modes

- `/mode review` selects a valid name directly; `/mode auto` selects the built-in no-op.
- Bare `/mode` opens Pi's native picker in TUI/RPC dialog-capable sessions, with auto first and custom names sorted by filename. Cancellation changes nothing.
- Without dialog UI, bare `/mode` prints the selected identity and availability. Argument completion lists valid names. `status` is an ordinary custom name, not a subcommand.

Choices are accepted while idle, streaming, executing tools, or awaiting queued continuation. Acceptance first calls Pi's synchronous `appendEntry("pi-modal:mode", { id })`; only after it returns does selected/query state change. An append exception retains the prior state and reports a retryable save error. Storage and durability are Pi's native responsibility: no extension rollback, retry worker, or durable queue.

The latest valid **accepted** choice is saved immediately and applies before the **next agent inference**, including the inference after tool results in the same run. An invalid attempt does not erase it. An already-started request and its generated tool calls are not retroactively rewritten. Query state describes selection, not which mode an in-flight request used. Internal compaction/summary model calls are outside this projection.

For example: select review during a streaming answer → review is immediately saved/visible → that answer remains unchanged → the next tool-loop inference uses review. Select another valid mode before that boundary → the newer choice wins. Select auto → the next inference uses the unchanged baseline.

The last selection on the **active branch** is restored on resume, fork/clone, tree navigation, and reload; sibling selections are ignored. Fresh sessions/branches without a saved choice use auto. Explicit auto and same-name reselection are saved too. Restoration/reselection loads the current body, so edit a mode then reselect it or `/reload` to refresh; no body text is stored in selection entries. Compaction retains native selection entries. Ephemeral sessions work in memory without promising restoration after process exit.

## Unavailable modes and recovery

A missing, unreadable, or invalid saved mode retains its requested identity as unavailable, never silently falls back to auto or reuses cached text. Normal input is consumed with a diagnostic, and native tool calls are blocked with termination requested. `/mode` remains available: explicitly select auto or a valid mode to recover. Projection incompatibilities also enter this state; a malformed saved identity uses `(invalid saved mode)` in diagnostics. A previously saved padded id such as `"review "` remains unavailable under that exact id—not renamed to `review` or treated as malformed—and requires explicit recovery.

This is a bounded readiness gate, **not a permission policy or universal cancellation mechanism**. Prompt-hook exceptions are logged by Pi and do not guarantee cancellation of model requests. Other extensions can initiate requests without the normal input gate; direct extension I/O, human shell commands, later hook overrides, and internal compaction/summary calls are outside these guarantees.

## Read-only query API

Other extensions in the same session emit `pi-modal:query` with `{ sessionId, respond }`. Responses are synchronous, frozen primitive-only copies. Ready snapshots omit `reason`; unavailable snapshots include a nonempty actionable reason and the requested id. No instruction text or setter is exposed. Query at point of use: `ready` means the **selected definition** is available, not that an in-flight request used it or that all work can be cancelled. No response (wrong session, not initialized, shut down, or not loaded) must be treated as unavailable.

The consumer repeats the small wire types because this extension package declares no `exports`/`main` library entry; there is no supported package-root type import.

Save this consumer as `selected-mode.ts`, load it alongside one copy of pi-modal (for example `pi -e /path/to/pi-modal -e ./selected-mode.ts`), and run `/selected-mode`:

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type ModeSnapshot = Readonly<
  { sessionId: string; id: string } &
  ({ ready: true; reason?: never } | { ready: false; reason: string })
>;
type ModeQuery = {
  sessionId: string;
  respond: (snapshot: ModeSnapshot) => void;
};

export default function (pi: ExtensionAPI) {
  pi.registerCommand("selected-mode", {
    description: "Query the selected instruction mode",
    handler: async (_args, ctx) => {
      let snapshot: ModeSnapshot | undefined;
      const request: ModeQuery = {
        sessionId: ctx.sessionManager.getSessionId(),
        respond: value => { snapshot = value; },
      };
      pi.events.emit("pi-modal:query", request);
      const text = snapshot ? JSON.stringify(snapshot) : "Mode unavailable: no response";
      if (ctx.hasUI) ctx.ui.notify(text, "info");
      else console.info(text);
    },
  });
}
```

Example response: `{"sessionId":"...","id":"auto","ready":true}`. Unavailable example: `{"sessionId":"...","id":"review","ready":false,"reason":"Saved mode review is missing or malformed. Select /mode auto or a valid mode."}`. Snapshots do not update in place; ask again after a selection, branch change, or reload. There are no broadcasts, cross-process transport, imported singleton, or child-mode inheritance. Listeners are disposed on shutdown/reload; load the package once per session.
