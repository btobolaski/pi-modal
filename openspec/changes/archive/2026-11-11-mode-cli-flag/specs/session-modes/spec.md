# Spec Delta

## ADDED Requirements

### Requirement: Startup CLI mode selection

The extension SHALL support `pi --modal <name>` for `auto` or a valid custom mode, independently of Pi's output-format `--mode`. It SHALL select and save the requested mode on the initially opened branch before processing startup prompts, overriding any saved choice. Names SHALL retain exact case and internal spaces; empty or surrounding-whitespace values SHALL NOT be normalized into valid names.

#### Scenario: New session with a custom mode

- **WHEN** Pi starts with `--modal review` and `review` is valid
- **THEN** `review` is selected and recorded on the active branch before the first startup prompt
- **AND** prompt projection, the read-only snapshot, and native status use that selection through their existing behavior

#### Scenario: Resume with an explicit override

- **WHEN** Pi initially opens a saved session in mode A with `--modal B` and B is valid
- **THEN** B supersedes A and a normal branch-local choice for B is appended before startup prompts
- **AND** a later invocation without the flag restores B from that branch using current mode-file content

#### Scenario: Explicit auto recovers an unavailable saved mode

- **WHEN** the initially opened branch has an unavailable saved mode and Pi starts with `--modal auto`
- **THEN** built-in `auto` is accepted and saved without requiring an `auto.md` file
- **AND** the unavailable saved choice does not prevent startup in `auto`

#### Scenario: Exact custom names and independent output format

- **WHEN** valid mode `Review Notes` is requested with `pi --mode json --modal "Review Notes"`
- **THEN** the exact mode `Review Notes` is selected while Pi retains JSON output operation
- **AND** `review notes` and ` Review Notes ` are not aliases of that name

#### Scenario: Unrelated invalid definitions

- **WHEN** the requested CLI mode is valid but another discovered mode definition is invalid
- **THEN** the valid requested mode is accepted
- **AND** the unrelated invalid definition retains its existing diagnostic behavior without making startup fatal

### Requirement: One-time CLI selection

The CLI choice SHALL apply only to the initial session startup of that invocation. Later `/mode` choices, tree navigation, reload, and new, resumed, forked, or cloned sessions within the process SHALL use normal branch restoration without reapplying the original CLI choice. Omitting `--modal` SHALL preserve existing default and restoration behavior.

#### Scenario: Later interactive choice and reload

- **WHEN** Pi starts with `--modal A`, the user accepts `/mode B`, and Pi reloads
- **THEN** B is restored from the active branch using its current definition
- **AND** the original CLI value neither replaces B nor appends another choice

#### Scenario: Tree navigation and session replacement

- **WHEN** Pi has accepted its startup CLI choice and the user navigates to another branch or creates, resumes, forks, or clones a session
- **THEN** the destination's last saved mode is restored, or `auto` when none exists
- **AND** no new choice is appended merely because the original invocation included `--modal`

#### Scenario: No CLI choice

- **WHEN** Pi starts without `--modal`
- **THEN** the active branch restores its saved mode or defaults to `auto`
- **AND** an unavailable saved mode retains existing explicit-recovery behavior rather than causing a CLI-validation exit

### Requirement: Fatal startup mode rejection

An empty, unknown, unreadable, or malformed explicit CLI mode SHALL produce an actionable stderr diagnostic and exit status 1 before startup prompts run, in interactive, print/text, JSON, and RPC operation. It SHALL NOT append a mode choice or fall back to another mode. A startup choice that cannot be saved SHALL likewise fail startup without claiming acceptance; storage retains Pi's native guarantees.

#### Scenario: Unknown or invalid name

- **WHEN** Pi starts with an unknown CLI mode, an empty value such as `--modal=`, or a surrounding-whitespace or path-like value that does not name a discovered valid mode
- **THEN** it reports the rejected value and how to choose a valid mode to stderr and exits with status 1
- **AND** no startup prompt or tool work begins and no mode choice is appended

#### Scenario: Requested file cannot be used

- **WHEN** the requested custom mode is missing, unreadable, malformed, or excluded by existing definition validation
- **THEN** Pi exits with status 1 and an actionable reason on stderr without processing startup prompts or appending a choice
- **AND** a previously saved valid mode does not become an implicit fallback

#### Scenario: Missing CLI argument

- **WHEN** Pi starts with `--modal` without a value
- **THEN** Pi's required-string-flag validation rejects the invocation with a diagnostic and exit status 1
- **AND** no mode choice is appended or startup prompt processed

#### Scenario: Native append failure

- **WHEN** validation succeeds but Pi's native append operation throws while saving the startup choice
- **THEN** startup fails with a save diagnostic and exit status 1 without processing startup prompts or publishing the requested mode as accepted
- **AND** pi-modal adds no rollback, retry, or stronger storage guarantee

## MODIFIED Requirements

### Requirement: Built-in auto mode

The extension SHALL provide reserved mode `auto` without requiring a mode file. New sessions and branches without a saved mode SHALL use `auto` unless an explicit startup CLI choice is accepted. In `auto`, the extension SHALL NOT modify prompt inputs, messages, models, thinking levels, or tool availability; it SHALL only maintain selection, persistence, discovery, and mode-status display behavior.

#### Scenario: Default with no modes directory

- **WHEN** a new session starts without `--modal` and its resolved agent directory has no modes directory
- **THEN** `auto` is ready and discoverable and the prompt is unchanged
- **AND** the native footer status shows `mode: auto` when that UI is available

#### Scenario: Reserved file cannot redefine auto

- **WHEN** `auto.md` exists in the resolved agent directory's modes folder
- **THEN** it is ignored during custom discovery without diagnostics, whether well-formed or malformed
- **AND** the picker/completion lists built-in auto once, and `/mode auto` selects that built-in mode

### Requirement: Branch-aware mode restoration

Accepted selections, including explicit `auto`, startup CLI and busy choices, SHALL be recorded immediately on the active branch. A startup CLI choice SHALL override initial restoration. Otherwise resume, fork/clone, tree navigation and reload SHALL restore the target branch's last choice, not a sibling's. New sessions without a CLI choice SHALL default to `auto`. Restoration SHALL load current mode-file content; entries SHALL NOT store mode bodies.

#### Scenario: Session append failure

- **WHEN** the native append operation throws while attempting a valid selection
- **THEN** the new choice is not accepted, the prior selection and query snapshot remain unchanged, and an actionable save error is reported
- **AND** a startup CLI attempt additionally exits as required by Fatal startup mode rejection
- **AND** session storage remains governed by Pi's native behavior, without extension-owned rollback, retry, or stronger durability guarantees

#### Scenario: Sibling branches

- **WHEN** two branches have different latest mode selections and the user navigates between them
- **THEN** each branch restores its own selection, including an explicitly saved `auto`

#### Scenario: Reload and compaction

- **WHEN** an active custom mode file changes and the user reloads Pi
- **THEN** the saved mode is restored using the current file body
- **AND** compaction does not lose the active-branch selection

#### Scenario: Ephemeral sessions

- **WHEN** Pi runs without persistent session storage
- **THEN** mode selection works in memory without promising restoration after process exit
