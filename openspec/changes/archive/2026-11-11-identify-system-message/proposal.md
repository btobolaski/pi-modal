# Proposal

## Why

A startup message from another extension can precede Pi's structured system message. pi-modal currently rejects this valid transcript as “Missing leading system message,” making a selected mode unavailable even though the required prompt inputs exist.

## What Changes

- Identify the actual system message rather than requiring it at transcript index zero, and use that same identification when writing the projected instruction section.
- Preserve preceding messages, unrelated prompt state, tool deltas, and stored history while applying the mode from the current request baseline.
- Add regression coverage in the existing projection tests for startup messages before the system message, later system patches, and switching back to `auto`.
- Retain existing rejection of missing system messages, unavailable structured inputs, and opaque forced prompts.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `session-modes`: Explicitly require position-independent system-message identification when otherwise compatible request transcripts begin with non-system messages.

## Impact

- Implementation: the validation and projection-write positions in `projectMessages` in `index.ts`.
- Tests: existing pure and native fixtures in `projection.test.ts`, using the current `nativeFixture` helper.
- `README.md` needs no change: its existing behavior description contains no system-message position requirement; commands, flags, and recovery policy are unchanged.
- No new dependencies, changes to other extensions, session migrations, or changes to mode selection, persistence, or opaque-prompt policy.
