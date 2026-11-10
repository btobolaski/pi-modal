# Proposal

## Why

Users need to select instruction modes when launching Pi, including scripted invocations, rather than issuing an interactive `/mode` command first. Pi already reserves `--mode` for output format, so pi-modal needs a distinct native extension flag.

## What Changes

- Add `pi --modal <name>` for built-in `auto` or an exact, valid custom mode name; preserve Pi's `--mode text|json|rpc` output-format flag.
- Apply the flag once to the initially opened session, overriding its saved mode and recording the accepted choice through Pi's existing branch-local selection entry. Later `/mode` choices, tree navigation, reload, and session replacement follow normal restoration without reapplying the flag.
- Validate the requested mode before saving it or processing startup prompts. An empty, unknown, unreadable, or malformed requested mode reports an actionable error to stderr and terminates Pi with exit status 1 in interactive, print/text, JSON, and RPC operation. Do not silently fall back or append a choice on validation failure.
- Keep existing defaults and unavailable-saved-mode recovery when the flag is absent. Continue using native session storage, including its ephemeral-session limitations.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `session-modes`: Add startup CLI selection and fatal rejection of invalid explicit CLI choices; qualify default and branch-restoration behavior for the one-time startup override.

## Impact

- `index.ts`: Register the native string flag, handle it at initial `session_start`, and reuse mode discovery and the existing validate/save/publish selection flow. Fatal startup rejection requires direct process termination because Pi's graceful-shutdown API does not stop print-mode startup.
- `test-helpers.ts` and `selection.test.ts`: Extend existing native fixtures for flag injection and test startup selection, persistence, lifecycle behavior, and fatal rejection in isolated child processes. No new test file or test/build wiring.
- `README.md`: Document `--modal`, quoting names with spaces, precedence, one-time application, error exits, and the distinction from Pi's built-in `--mode`.
- No dependency, package, prompt-operation, permission-policy, persistence-format, or discovery-API changes. Only planning artifacts are created by this proposal; implementation requires a separate apply request.
