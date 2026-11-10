# Design

## Context

See `proposal.md` for motivation and `specs/session-modes/spec.md` for the behavioral contract. Design is included because CLI naming, startup lifecycle, and fatal rejection require explicit decisions before implementation.

`index.ts` already owns mode discovery, one `selection` value, branch restoration, and `/mode`'s validate/append/publish sequence. Query snapshots, status, readiness gates, and prompt projection derive from that selection. The existing tests load the real extension with `DefaultResourceLoader` and native sessions through `nativeFixture` in `test-helpers.ts`.

Pi 1.5.0 reserves `--mode` for `text`, `json`, or `rpc` in its CLI parser. Extensions can register string flags, but cannot override built-in flags or provide a string-value validator. CLI flag values become available after factory loading. Native `session_start.reason` distinguishes initial `startup` from `reload`, `new`, `resume`, and `fork`; a CLI-opened existing session still begins with `startup`. Pi retains extension flag values across runtime replacement, so an instance-local boolean is not a sufficient once-per-invocation guard.

## Goals / Non-Goals

**Goals:** Feed one explicit startup selection through existing mode state and native branch storage, without maintaining a second override or persistence system. Distinguish fatal CLI rejection from recoverable interactive command rejection.

**Non-Goals:** Shadowing Pi's `--mode`, parsing argv ourselves, changing output formats, applying a process-wide forced mode, changing other extensions' lifecycle, adding flag aliases or dependencies, or strengthening Pi's storage guarantees. Do not change prompt projection or discovery transport.

## Decisions

### Register a native string flag without a default

Register `modal` in the extension factory with `type: "string"` and a help description. Do not set a default: `undefined` means absent, whereas an empty string is an invalid explicit request. Read `pi.getFlag("modal")` in `session_start`, not in the factory. Native parsing owns both `--modal name` and `--modal=name`, required-value diagnostics, repeated-flag behavior, and help listing.

Use the raw string as an exact catalog key. Do not trim, case-fold, parse it as a path, or route an empty value into the picker. Shell quoting handles internal spaces. Built-in `auto` comes from the same catalog and requires no file. Registering `mode`, relying on the parser's accidental `--mode=value` behavior, or introducing a wrapper CLI would either conflict with Pi or expand scope.

### Apply only at initial startup

Initialize the current session identity and prompt options as today. Only when `event.reason === "startup"` and the flag is present, validate and save the CLI choice instead of restoring the saved choice first. This lets a valid explicit choice override even unavailable saved data without first activating or reporting that saved mode. Otherwise call the existing `restore` path unchanged.

After successful CLI selection, there is no retained override to consult. `session_tree` continues to restore normally. Reload and session replacement create new extension instances but carry non-startup reasons, so the retained flag is ignored. Do not use module globals, environment mutations, marker entries, timers, or a cross-runtime consumed-flag registry.

### Reuse selection acceptance, not the command UI

Share only the small catalog lookup and append-before-commit selection flow needed by CLI and `/mode`; keep the picker, command argument trimming, reporting, and call-site failure policy separate. Preserve current session-identity checks, revision invalidation, and existing protection against stale asynchronous restoration. Do not call the slash-command handler as a CLI parser.

Save the existing `pi-modal:mode` entry containing only `{ id }`, then commit `selection` and publish native status. No mode body is stored. Do not publish a ready CLI selection before native append succeeds. Query and projection automatically see the same accepted selection; no new event API is needed. CLI success needs no extra stdout banner; retain existing `/mode` notifications.

A native append exception leaves the pre-attempt selection unchanged. For startup, treat inability to save an explicit choice as a fatal save error rather than silently continuing with a different mode. This does not add rollback, retry, synchronous disk flushing, or durability beyond Pi's native append behavior. In ephemeral sessions, acceptance is in-memory only, as today.

### Fail invalid startup choices directly

The user explicitly selected exit status 1 in every CLI output mode. Native `ctx.shutdown()` has no status argument, is deferred in interactive/RPC operation, and is a no-op in print mode (Pi's bundled `docs/extensions.md`, `ctx.shutdown()`). Setting `process.exitCode` alone would not stop startup, and throwing from an event handler is logged by Pi without reliably stopping execution.

For a rejected CLI selection or append failure, write one actionable fatal diagnostic synchronously to stderr (Node's `writeSync` on descriptor 2), then call `process.exit(1)` from the startup path. Identify the value safely, include the selected-file reason when available, and explain how to choose a valid mode or omit the flag. Do not use UI-only notification for fatal errors or emit the fatal message on JSON/RPC stdout. Unrelated catalog errors retain normal reporting and do not make a valid requested mode fatal.

This intentionally bypasses graceful shutdown hooks; it is restricted to an explicit startup failure before Pi processes ordinary CLI prompts. It is not a promise to undo work already performed by another extension's factory or earlier startup hook. A missing argument is handled by Pi's own string-flag diagnostics, not extension-owned argv logic. Help-only invocations do not start a session and therefore do not select or save a mode.

### Extend the existing checks

In `test-helpers.ts`, allow fixture callers to set native runtime flag values after `loader.reload()` but before session binding, including the initial fixture session. Keep the default unchanged for existing callers. Reuse the current faux provider and `query`/`savedChoices` from `test-helpers.ts`, plus local `recordStatus` and branch fixtures in `selection.test.ts`.

Cover successful CLI selection and first-inference projection, saved-choice override and later restoration, `auto`, one case-and-space representative such as `Review Notes`, unrelated invalid files, absent flags, and lifecycle reasons that must ignore retained flags. Include actual runtime reload/replacement coverage, not only repeated synthetic events: factories are recreated while flags survive.

Run fatal checks in isolated Node child processes launched from the existing test file, never by terminating or globally patching the parent test runner. Assert status 1, stderr diagnostics, no appended choice for validation failures, and that a prompt/provider sentinel was never reached. Use one small native-CLI registration-contract check for help listing and required-value rejection alongside output `--mode`; runtime flag injection alone cannot prove this integration, but Pi's documented parsing variants do not need separate tests. Use one parameterized fatal-exit check with two representative cells, interactive startup and JSON/noninteractive, with bounded timeouts and isolated agent directories. The fatal handler is mode-independent; inspect that print/text and RPC bind the same startup handler, adding cells only for mode-specific logic or failures. The behavior contract remains all output modes. Touch no credentials, network, user sessions, or real mode files. Keep checks in existing files; add no build/test wiring.

## Risks / Trade-offs

- Hard exit skips cleanup by other extensions → Limit it to explicit startup rejection, write the fatal message synchronously, and document the limitation. Do not install process-wide exception handlers.
- The flag survives reload but local extension state does not → Gate by Pi's native startup reason and test real runtime replacement.
- Sharing the acceptance path could change busy `/mode` or append-failure behavior → Preserve call-site policies and run all existing tests, including stale-restoration and unavailable-mode checks.
- Subprocess fixture injection can hide native parser mistakes → Include native CLI checks for flag registration, missing values, and built-in output-format coexistence.
- Native appends are not an extension-owned durability transaction → Keep the existing storage format and guarantees; reopening assertions must respect Pi's native session-writing behavior.

## Migration Plan

No data migration is needed. Load the updated package and use `pi --modal review` or `pi --modal auto`. Existing invocations without the flag remain unchanged. Reverting removes the flag while leaving accepted branch choices compatible with the existing extension. Implementation remains a separate apply step.
