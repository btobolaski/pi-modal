# Design

## Context

See `proposal.md` for motivation and `specs/session-modes/spec.md` for the display contract. Design is included to settle publication timing across asynchronous restoration and the native-session test seam before coding.

The extension already owns one `selection` union in `index.ts`: ready modes have `operation`; unavailable modes have `reason`. `restore` first publishes a provisional unavailable selection, then resolves the catalog under session-identity and revision guards. The `/mode` handler assigns a new selection only after the native session append succeeds. `context_with_system` can also make the selection unavailable. The read-only query reports this same selection, including choices accepted during an in-flight request.

Pi 1.5.0 documents `ctx.ui.setStatus(key, text)` as the native footer-status API and `undefined` as removal. Its `status-line.ts` example uses that API directly. `setFooter` replaces the whole footer and is not needed. At design time, `mockPicker` in `test-helpers.ts` supplied only `select` and `notify`; the implementation adds default no-op `setStatus` support and an optional recorder.

## Goals / Non-Goals

**Goals:** Derive status from existing selection state at its publication points; preserve current stale-restore protection, append-failure semantics, and native UI ownership.

**Non-Goals:** A custom footer/widget, status configuration or colors, a new event API, mode-file watching, an in-flight-mode tracker, new persistence/coordination guarantees, or changes to prompt and readiness-gate behavior.

## Decisions

### Use one native status entry

Use the stable extension-owned key `pi-modal`. Publish plain `mode: <id>` for ready selections and append ` (unavailable)` otherwise. The user explicitly chose to show every selection, including `auto`. Do not include mode instructions or the full recovery reason; existing notifications, headless reports, and discovery retain those responsibilities.

A small local publisher reads `selection` and calls `setStatus` only when `ctx.hasUI`. This also uses Pi's native RPC status transport where supported, while print/JSON operation adds no console chatter. Do not introduce a second status state, query listener, timer, or independent discovery read. Native footer layout, sanitization, ordering, and truncation remain Pi's responsibility; no guaranteed position or always-visible width is added. A custom footer can decide whether to render extension statuses.

### Publish at existing state changes

| Existing path in `index.ts` | Status action |
| --- | --- |
| `restore`, immediately after provisional selection assignment | Publish target identity as unavailable before awaiting catalog I/O. |
| `restore`, after the identity/revision guard and final assignment | Publish ready or unavailable result. |
| `/mode`, after successful append and selection assignment | Publish accepted choice immediately, even during active work. |
| `context_with_system`, after projection failure changes selection | Publish unavailable status before returning from the hook. |
| `session_shutdown` | Clear only `pi-modal` via `setStatus(key, undefined)`; retain existing state reset and revision invalidation. |

Cancelled pickers, invalid names/files, and append failures do not change selection, so they do not publish another status. Keep the final restoration write inside the existing guard: an obsolete read must not overwrite a newer accepted choice or repopulate status after shutdown. Session-start and tree handlers continue using `restore`; no new lifecycle subscriptions are necessary.

This direct publication is simpler than subscribing to discovery snapshots or broadcasting changes, and avoids introducing a separate source of truth. The status describes selection, not what an already-started inference used.

### Extend existing tests, not the test architecture

Give `mockPicker` a default no-op `setStatus` implementation and an optional recorder callback; update its partial-UI safety comment. Status assertions can record the latest values by key and seed an unrelated status to verify ownership. For startup/restoration checks, attach the mock and emit the existing native `session_start`/`session_tree` events; the fixture initially binds without UI. Reuse `holdModeRead`, deferred promises, and the current selection/projection tests to check transient unavailable state and stale completion. Keep all added checks in `selection.test.ts`; package scripts and dependencies stay unchanged.

## Risks / Trade-offs

- Brief unavailable text during restoration → This deliberately matches current query/readiness behavior rather than showing a stale ready mode.
- Native status may be truncated, or omitted by another extension's custom footer → Use the supported native facility without promising stronger display guarantees.
- A partial test UI would throw on `setStatus` → Update the shared mock and run all five existing test files, not just the added assertions.
- A missed assignment would leave stale text → Cover every selection-changing path in the table, including projection failure, unsuccessful choice, and shutdown, with existing harness-based checks.

## Migration Plan

No migration or dependency change is required. Load/reload the updated extension to publish the active branch's mode. Reverting the implementation and reloading removes the feature through Pi's normal extension lifecycle; saved selections remain compatible.
