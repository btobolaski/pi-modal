# Proposal

## Why

The selected mode is currently visible through `/mode`, selection notifications, or the discovery API, but not persistently in Pi's native footer. A native status indicator lets users see their current selection without opening the picker or querying another extension.

## What Changes

- Show `mode: <name>` in Pi's native footer status, including the default `mode: auto`.
- Show `mode: <name> (unavailable)` whenever the selected mode is not ready, including restoration in progress and prompt-projection failure; keep detailed recovery reasons in existing reports.
- Refresh the indicator when selection or readiness changes, following the active branch and existing stale-restore guards. Clear this extension's status on session shutdown.
- Preserve native footer rendering, other extensions' statuses, existing mode semantics, and headless `/mode` reporting.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `session-modes`: Add native selected-mode status and explicitly permit that display for built-in `auto` without changing its prompt behavior.

## Impact

- `index.ts`: Publish existing selection state through Pi's `ctx.ui.setStatus` under the extension-owned `pi-modal` key; no custom footer or new state store.
- `test-helpers.ts` and `selection.test.ts`: Extend the existing native-session UI mock and regression coverage for status transitions.
- `README.md`: Document indicator text, availability, and selected-versus-in-flight semantics.
- The `session-modes` delta updates `openspec/specs/session-modes/spec.md` when this change is eventually archived; this proposal does not modify the base spec.
- No dependencies, package configuration, persistence format, commands, or discovery API changes.
