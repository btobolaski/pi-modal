# Design

## Context

See `proposal.md` for motivation and the `session-modes` delta for behavior. The investigation reproduced the failure on Pi 1.5.2 with the installed pi-loaded-tools extension: `context_with_system` received a custom message at index zero and its first system message at index one. Disabling Ponytail removed the opaque-prompt conflict but exposed this independent position assumption.

`projectMessages` in `index.ts` assumes index zero twice: in its missing-system guard and in the branch that writes the projected `project_context`. Removing only the guard would skip the write and remove later instruction patches. The existing `getCurrentSystemMessage` call already replays system sections and tools regardless of preceding non-system messages. Pure projection fixtures currently start with a system message; the native fixture disables unrelated extensions and has no startup message.

## Goals / Non-Goals

**Goals:**

- Remove both index-zero assumptions together without changing the projection algorithm's other responsibilities.
- Keep request messages in their original order and retain native system-patch replay semantics.

**Non-Goals:**

- Parsing or overriding opaque full prompts, modifying Ponytail or pi-loaded-tools, changing SDK versions, or adding a compatibility layer.
- Rewriting session history, creating a new prompt cache, or adding cancellation or persistence guarantees.

## Decisions

### Identify the first actual system message once

Find the first message with role `system` and use that position both to validate presence and to write the projected section. Reject a non-None operation only when no system message exists, subject to the existing structured-input and compatibility guards. Keep `None`, including `auto`, as the unchanged early return.

This is an in-place positional correction, not transcript normalization. Moving the system message ahead of startup messages or collapsing all system messages would unnecessarily change message placement and tool-delta representation.

### Retain native replay and existing patch neutralization

Continue deriving the current section with `getCurrentSystemMessage(messages)` rather than reading only the first system message's possibly stale section. Write the transformed section at the identified system position and remove only subsequent `project_context` patches as today, so replay cannot overwrite it. Preserve every other section, content field, timestamp, and tool delta; do not mutate input objects.

Using the first matching index alone without updating the projection-write branch is incomplete. Reimplementing system replay or adding a generic message-normalization abstraction is unnecessary.

### Extend existing tests, not the dependency surface

In `projection.test.ts`, prepend non-system messages to the existing multi-system baseline and verify the replayed result differs only in the intended instruction section. Extend native coverage using `nativeFixture`'s existing extension-factory argument: send a non-triggering custom message during `session_start`, matching the observed startup behavior without installing another plugin.

Assert that the fixture actually presents a custom-before-system transcript, that the provider receives the selected transformation, and that readiness remains true. Exercise mode A, mode B, and `auto` on that retained prefix. Retain negative coverage for genuinely absent system messages and opaque prompts, plus the unchanged `None` bypass.

## Risks / Trade-offs

- Later instruction patches could undo a misplaced write → check the replayed prompt and tool state using the existing multi-system fixture.
- A native test could accidentally normalize away the prefix and miss the bug → assert the custom-before-system ordering in the exercised request, not just the selected mode name.
- Tests use pinned Pi 1.5.0 while the report was reproduced on 1.5.2 → run the existing suite and a focused local 1.5.2 check using the available installed runtime; do not change dependencies or introduce build wiring.
- Opaque-prompt conflicts still make non-None modes unavailable → preserve that policy and do not present this correction as Ponytail compatibility.

## Migration Plan

No stored data or configuration changes are required. Existing sessions with startup messages can reselect their mode after loading the corrected extension, provided the request baseline is otherwise compatible. Rollback is the normal extension-code rollback; history needs no migration or cleanup.
