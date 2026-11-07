# Tasks

## 1. Native mode indicator

Use focused checks in the existing test file and reuse shared fixtures. Do not grow unrelated multi-phase test chains. Use one representative per behavior branch: a single custom name such as `Review Notes` covers case and internal spaces together; avoid naming permutations.

- [x] 1.1 Extend `mockPicker` in `test-helpers.ts` with default no-op `setStatus` support and an optional recording callback; update its safety comment and verify existing picker tests still run without missing-method errors.
- [x] 1.2 Add the selection-derived native status publisher in `index.ts`, using only the `pi-modal` key and guarding UI calls with `ctx.hasUI`. Wire provisional/final restoration, accepted selection, projection failure, and shutdown as described in the design; verify recorded text is `mode: <id>`, `mode: <id> (unavailable)`, or removal as appropriate.
- [x] 1.3 Extend `selection.test.ts` to assert default `auto`, exact custom names (including case/internal spaces), `None`, direct/picker choices, busy acceptance, and explicit return to `auto`; verify status follows the selected mode immediately while the in-flight prompt remains unchanged. Reuse shared fixtures without adding a test file.
- [x] 1.4 Cover cancellation, invalid-choice, and append-failure status in focused checks in `selection.test.ts`; verify both selected identity and prior status remain unchanged on failure.
- [x] 1.5 Extend restoration coverage in `selection.test.ts` for target-branch selections and no-choice `auto`, unavailable saved modes (including malformed saved data), and explicit recovery. Use `holdModeRead` to assert provisional unavailable text and prove a superseded read cannot overwrite a newer choice or restore status after shutdown; verify all assertions pass through native runner events.
- [x] 1.6 Cover projection-failure status and key-specific shutdown removal in `selection.test.ts`, with an unrelated status present to prove it is preserved. Verify existing headless `/mode` reporting remains intact and mode changes add no console status chatter without UI.
- [x] 1.7 Update `README.md` under selecting/updating modes and unavailable modes with the indicator text, `auto` visibility, native-layout limitations, and selected-versus-in-flight meaning; verify examples match the tested output, distinguish footer status from the ordinary mode named `status` and bare `/mode` reporting, and do not imply permission or cancellation guarantees.

## 2. Integration verification

Prerequisite: a separately installed global OpenSpec CLI on `PATH`. Neither this repository's pnpm dependencies nor its Nix devShell provides it; do not add build or dependency wiring for this change.

- [x] 2.1 Run `pnpm test` through the configured project test runner and `openspec validate mode-indicator --strict`; verify all existing and added checks pass, with no dependency, package-script, persistence-format, or discovery-API changes in the final diff.
- [x] 2.2 Smoke-test in Pi 1.5.0 using the native footer: confirm startup `auto`, a custom selection, unavailable restoration, recovery, and reload; verify existing footer information and other extensions' statuses remain present, subject to native width/truncation.
