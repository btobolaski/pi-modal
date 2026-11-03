# Tasks

## 1. Package setup

- [x] 1.1 Add installable ESM package metadata declaring `pi.extensions: ["./index.ts"]`, host SDK/transcript-helper peers and matching development dependencies, a native Node test command, pnpm lockfile, and dependency ignore rules; confirm dev-shell `node --version` meets the 22.19+ floor, verify clean installation and Pi package recognition without a build step or bundled host packages.

## 2. Mode discovery and validation

- [x] 2.1 Implement built-in auto and `join(getAgentDir(), "modes")` discovery in `index.ts`, reusing Pi's exported frontmatter parser and exact operation values; wire `.config/tools.toml` to `pnpm test`, which invokes `node --test index.test.ts discovery.test.ts projection.test.ts selection.test.ts query.test.ts` and verify consolidated `node:test`/`node:assert/strict` checks for all values, ignored auto.md, empty bodies, missing directory, malformed/non-object YAML, missing/invalid fields, unreadable files, symlinks, configured agent directories, and name/path rejection. Use one representative invalid-definition input table rather than separate tests per field.
- [x] 2.2 Document package installation, the native Node test command, filenames, Pi-resolved directory/default paths, dev-shell entry via `nix develop`/direnv and the Node/pnpm toolchain, YAML/body syntax, parser whitespace normalization, reserved auto, and invalid-file diagnostics in `README.md`; verify documented examples parse as described.

## 3. Instruction groups and request projection

- [x] 3.1 Implement global/project grouping and all six operations; verify table-driven checks cover default/configured agent directories and user-level versus every non-global source, AGENTS.md/CLAUDE.md equivalence, ancestor and override files, symlink paths, empty groups/bodies, first-position single-copy ReplaceProject, single-copy ReplaceBoth, and Prepend/Append placement without altering the untargeted group.
- [x] 3.2 Observe run prompt inputs without mutating them, then project the selected mode in `context_with_system` using public transcript replay and exact source-block matching; verify inference-level checks for A-to-B-to-auto, auto/None no-ops, no accumulation or stored-history edits, retained tool deltas/other sections/earlier unrelated edits, and explicit unavailable errors for opaque prompts or ambiguous/incompatible blocks without partial mutation. Check actual Pi request formatting rather than importing a private prompt builder.
- [x] 3.3 Document group replacement, alias/ancestor/override handling, synthetic missing-group context, and request-local projection; verify README examples match the checks and explain that instruction files, model/tool settings, and stored history are not rewritten, and baseline prompt inspection may differ from the projected request.

## 4. Selection and branch lifecycle

- [x] 4.1 Register direct `/mode <name>`, native picker, completion, and non-dialog status behavior; verify checks accept choices while streaming, running tools, or awaiting continuation, retain choices when the leaf advances or work overlaps picker/file reading, apply the latest valid choice before the next agent inference including tool-loop calls, preserve an in-flight request, and handle cancellation/invalid input/session replacement without corrupting the selected state.
- [x] 4.2 Call synchronous native append before publishing an accepted selection, preserving the prior selection/snapshot with diagnostics on an append exception, and restore from `getBranch()` on session start/tree events; verify fresh/explicit auto, choices accepted while busy, latest-valid-wins behavior, sibling branches, resume/fork/clone, reload with changed body, compaction, malformed saved entries, append-error diagnostics, and ephemeral behavior without storing body text or introducing a durable queue.
- [x] 4.3 Document acceptance versus application, immediate saved/query selection, next-agent-inference timing, branch restoration, reload/reselect, and ephemeral limits; verify the lifecycle walkthrough with session/request fixtures and explicitly exclude internal compaction/summary requests from projection.

## 5. Availability and discovery

- [x] 5.1 Implement unavailable saved-mode state and native input/tool gates while preserving `/mode` recovery; verify invalid restored modes do not fall back or reuse stale text, normal input is consumed, tool calls block/terminate, invalid choices preserve prior state, and valid selection recovers. Document that hook exceptions do not guarantee model-request cancellation.
- [x] 5.2 Implement `pi-modal:query` snapshots using the ready/unavailable discriminated union, session filtering, and listener disposal; verify ready snapshots omit reason, unavailable snapshots include a nonempty reason, accepted busy selections are visible before their next inference, wrong-session/uninitialized/shut-down instances do not respond, and snapshots remain detached across consumers/sessions and reloads.
- [x] 5.3 Document the query request/type and a runnable consumer example, selected-versus-in-flight semantics, recovery, load-once requirement, and readiness boundaries; verify example outputs expose neither instructions nor a setter and make no universal cancellation/permission claim.

## 6. Integration acceptance

- [x] 6.1 Run the configured native Node checks and applicable formatting/static checks; verify required behavior passes and package contents contain only intended resources, without bundled host packages or a new build/CI workflow.
- [x] 6.2 Smoke-test the core native boundary with isolated HOME/session fixtures: use picker/direct selection, one project-group replacement over mixed ancestor/cwd aliases, one global append, a busy change before the next tool-loop inference, branch restoration, and one query. Inspect outgoing/in-flight contexts without modifying real user files or permissions; leave the exhaustive operation/failure matrix to the Node checks.
- [x] 6.3 Inspect the complete implementation diff and affected paths, record evidence, and run the required OpenSpec implementation reviewer workflow; verify README installation, native test command, mode-file, selection-timing, and query examples against the checks and resolve findings within scope before reporting ready. Do not publish or archive as part of implementation.

### Original implementation verification

These results predate the unchecked review follow-up in section 7; they do not verify that delta.

- `pnpm test`: 26 native checks pass, including the cwd-equals-agentDir loader/projection scenario and both runnable README examples.
- The earlier scoped `treefmt --fail-on-change` invocation passed for matched files, but matched no Markdown files: README and Markdown artifacts were not formatter-checked. `openspec validate initial-version --strict` passes.
- Strict project-source checking passes with the operator-approved ephemeral TypeScript 5.9.3 command below. `--skipLibCheck` excludes dependency declarations; no compiler dependency, build step, or CI wiring was added. LSP alone remains inconclusive.
- `pnpm pack --out /tmp/pi-modal-inspection.tgz && tar -tzf /tmp/pi-modal-inspection.tgz` contains exactly `package/index.ts`, `package/package.json`, and `package/README.md`.

```sh
pnpm --config.ignore-scripts=true dlx --package=typescript@5.9.3 tsc --noEmit --strict --target ES2024 --module NodeNext --allowImportingTsExtensions --skipLibCheck --typeRoots node_modules/.pnpm/node_modules/@types index.ts index.test.ts discovery.test.ts projection.test.ts selection.test.ts query.test.ts test-helpers.ts
```

## 7. Review follow-up

- [x] 7.1 Guard symlink targets in shared discovery with native regular-file metadata checks before reading contents. In `discovery.test.ts`, verify that a non-regular stat result prevents `readFile`, ordinary file symlinks still work, broken links retain individual diagnostics, and auto/unrelated valid modes remain usable. Do not add timeout, queue, or cache machinery.
- [x] 7.2 Implement the filename-whitespace rule in `index.ts` and document it in `README.md`. Extend existing discovery/selection checks for leading/trailing and whitespace-only stems, collisions with a clean stem, internal-space names through command/picker, and restoration of a previously saved padded id as unavailable under its exact identity until explicit recovery. Reject filenames rather than renaming them; do not rely on removing command trimming alone.
- [x] 7.3 Route directory reads in `index.ts` through `fs.readdir`, mirroring the existing `fs.readFile` mock seam, and replace privilege-dependent permission assertions in `discovery.test.ts` with deterministic filesystem-error checks using the existing native Node mock facilities. Preserve `EACCES` coverage, directory versus per-file diagnostic keys, and auto/unrelated-mode behavior without requiring a particular UID or DAC capability set.
- [x] 7.4 Deduplicate unchanged underlying discovery failures per command/restoration across picker population/revalidation, direct invalid selection, and saved-mode restoration, while retaining an actionable selected-mode reason. Extend existing selection checks to verify changed failures and later invocations still report, and keep post-picker revalidation rather than suppressing the second read.
- [x] 7.5 Re-run the configured test suite, applicable formatting/strict static checks, and strict OpenSpec validation after the follow-up. Inspect the complete delta, run the required OpenSpec implementation reviewer workflow, and refresh verification evidence with observed results before marking the follow-up complete. Do not publish or archive as part of this work.

### Follow-up verification and review dispositions

- Configured project-tool test run (`pnpm test`): **29 passed, 0 failed, 0 skipped**. The non-regular-target regression and diagnostic-count regressions failed against the pre-fix logic before passing with the fixes.
- Discovery checks prove rejection before `readFile` using a directory-target symlink, while regular-file links, broken-link diagnostics, auto, and unrelated modes remain intact. Deterministic `fs.readdir`/`fs.readFile` EACCES mocks replace all chmod assumptions; no UID or DAC prerequisite remains.
- Filename checks cover leading/trailing and whitespace-only stems, clean-name collisions, exact internal-space names through commands/pickers, and unavailable restoration of `"review "` until explicit recovery. Saved-entry decoding and its type guard remain separate from filename eligibility.
- Diagnostic checks cover unchanged, changed, and newly appearing failures across picker revalidation, invalidated picker choices without saving, later commands, direct invalid selection, and repeated restoration. Selected-file failures are reported once with the same actionable recovery reason exposed by unavailable snapshots; suppression is local to an invocation.
- The strict TypeScript 5.9.3 command above passes for all seven TypeScript files with dependency declarations excluded. No dependency/build/CI changes were made. Active LSP probes of the four changed TypeScript files report no errors but remain inconclusive; the compiler supplies the definitive static check.
- `openspec validate initial-version --strict` passes.
- `treefmt --no-cache --fail-on-change --on-unmatched warn index.ts discovery.test.ts selection.test.ts test-helpers.ts README.md openspec/changes/initial-version/tasks.md` passes: **four TypeScript files matched, zero changes**. README and tasks.md are explicitly unmatched by the environment's formatter configuration and are manually reviewed, not claimed formatter-clean.
- Functional verification and the initial dispositions were recorded while both review reports were retained. Their approved removal preceded final self-review and the required OpenSpec reviewer workflow.
- Follow-up review pass 1 (`c34cea19-c2df-4d7e-ab83-0497c045809b`) completed all five reviewers with no workflow errors: 1 high finding (unfinished task 7.5), 2 medium findings, and 5 low findings. The verifier mapped all 10 requirements and 39 scenarios and independently passed 29 tests and strict OpenSpec validation; its supplemental compiler/formatter reruns were denied before execution, so the primary-session results above were explicitly attributed rather than claimed independently repeated.
- Addressed the medium findings with one shared recovery suffix and assertions for the unknown-mode diagnostic, its fresh catalog diagnostic, and unchanged selection/storage. Removed four redundant generic input-gate assertions from the padded-id test; the existing unavailable-mode test retains gate coverage. All 29 checks, the strict compiler, treefmt (four TypeScript matches, zero changes), and strict OpenSpec validation pass after these fixes.
- Self-check improvement: inspect every changed notification's observable effect, including branches hidden by no-op UI stubs, and share recovery copy between its two consumers. The complete six-file diff and affected paths were re-inspected after the fixes; task 7.5's verification, required first workflow, feedback dispositions, and final self-review are complete. The approved independent second review confirmed this readiness.
- Follow-up review pass 2 (`f8cfe440-840a-4254-99de-a61ee82d9072`): **PASS from all five reviewers**, no workflow errors, no medium-or-higher findings, and six low advisories. OpenSpec confirms 20/20 tasks, all 10 requirements and 39 scenarios; the verifier independently reran 29 passing tests and strict OpenSpec validation. Its supplemental compiler attempt was denied before execution; primary-session compiler evidence remains explicitly attributed.
- With operator approval, addressed the low fixture advisory by replacing the stat/isFile mock chain with a real symlink to the existing directory fixture. The no-`readFile` assertion and deterministic EACCES mocks remain. After this low-only cleanup, 29 tests, the strict seven-file compiler check, strict OpenSpec validation, and treefmt (four TS matches, zero changes; Markdown unmatched) pass again. No third reviewer run is required for low-only fixes.

### Deferred or not doing

- Keep serial discovery reads: concurrency is an optional optimization without a measured latency requirement; revisit if completion/restoration lag is demonstrated.
- Defer the optional default-export doc comment; it is not needed for these behavior fixes.
- Retain the saved-entry type guard: the current filter does not narrow the TypeScript `SessionEntry` union before `.data` access.
- Defer license metadata until the owner chooses licensing terms for distribution; publishing is outside this change.
- Keep the documented README wire-type duplication and its executable drift check; no package-library exports are needed.
- Per the operator's pass-1 disposition, retain explicit clean `review` command/picker collision coverage; defer optional README dedup-frequency and argument-trimming wording, and the optional design.md filename-sort clarification. No documentation scope expansion is included.
- Per the operator's pass-2 decision, defer the two optional code-style advisories (unused readdir-mock parameters and suppression comments); retain the three prior documentation deferrals. These do not change behavior or acceptance.
- Per the operator's cleanup decision (superseding the prior retention note), removed only `reviews/initial-version-code-review.md` and `reviews/xhigh-xolvzmvx-to-working-copy.md` after functional verification and recorded dispositions, before final self-review and the reviewer workflow. No other repository files were removed.
