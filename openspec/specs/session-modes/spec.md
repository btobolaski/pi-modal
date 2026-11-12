# session-modes Specification

## Purpose

Allow users to select session-local instruction modes without changing instruction files, while exposing the selected mode and its availability to other Pi extensions and through Pi's native footer status.

## Requirements

### Requirement: Installable Pi package

The extension SHALL be distributed as an installable Pi package declaring its extension entry point. Loading it SHALL NOT require a separate compilation step or changes to the user's prompt files or permission integrations.

#### Scenario: Package loading

- **WHEN** the package is installed or loaded into a supported Pi runtime
- **THEN** its mode command, prompt behavior, and read-only discovery are registered without a separate build or changes to external integrations

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

### Requirement: Custom mode files

The extension SHALL discover direct `<name>.md` files in Pi's resolved agent-directory `modes` folder (default `~/.pi/agent/modes`). Names SHALL be exact, case-sensitive stems without surrounding whitespace; internal spaces remain valid. Stems SHALL NOT be trimmed or aliased. YAML-object frontmatter SHALL specify a `replace_mode` string from Supported prompt operations; its parsed body SHALL supply instructions. Invalid files SHALL be excluded without disabling valid modes or `auto`.

#### Scenario: Valid file

- **WHEN** `review.md` has frontmatter `replace_mode: ReplaceGlobal`
- **THEN** mode `review` is selectable and uses the parsed body without frontmatter as its instructions

#### Scenario: Invalid configuration

- **WHEN** a file has missing frontmatter, malformed YAML, a non-object header, or a missing, non-string, or unknown `replace_mode`
- **THEN** the extension reports the invalid file and does not activate it

#### Scenario: Non-regular symlink target

- **WHEN** metadata for a candidate `example.md` symlink reports a non-regular target, such as a FIFO, directory, or device
- **THEN** it is reported as an individual invalid definition without reading its contents
- **AND** `auto` and unrelated valid modes remain usable

#### Scenario: Filename whitespace

- **WHEN** valid definitions exist in `review .md`, ` review.md`, `review.md`, and `review notes.md`
- **THEN** the two whitespace-padded stems are reported invalid and omitted from picker choices and completion
- **AND** `review` and `review notes` retain their exact identities and are selectable directly and through the picker
- **AND** rejected stems are not trimmed into aliases of `review`

#### Scenario: Name is not a path

- **WHEN** a user requests a name not present in discovered modes, including a path traversal string
- **THEN** selection fails without reading an arbitrary user-supplied path

#### Scenario: Empty instructions

- **WHEN** a valid mode file has an empty body
- **THEN** it remains valid and its operation uses empty instructions

### Requirement: Instruction groups and missing entries

The global group SHALL contain Pi's loaded user-level context files from its resolved agent directory (default `~/.pi/agent`). Project SHALL contain all remaining context files, including ancestors. `AGENTS.md` and `CLAUDE.md` SHALL be equivalent; overrides SHALL belong to their source group. Match logical paths, not symlink destinations. An empty group receiving content SHALL get an in-memory entry; no instruction file SHALL be changed on disk.

#### Scenario: Symlinked global file and ancestor instructions

- **WHEN** the loaded global AGENTS.md is a symlink and Pi also loads ancestor AGENTS.md entries
- **THEN** the global logical-path entry belongs to the global group and ancestor entries belong to the project group

#### Scenario: Alternate and ancestor instruction files

- **WHEN** Pi loads a user-level CLAUDE.md, ancestor AGENTS.md and CLAUDE.md files, and a cwd AGENTS.override.md
- **THEN** the user-level file is global and every other file is project context
- **AND** neither CLAUDE.md nor override files are exempt from the selected group's operation

#### Scenario: Configured agent directory

- **WHEN** Pi is configured to use a custom agent directory with mode definitions and user-level CLAUDE.md
- **THEN** discovery uses that directory's modes folder and classifies its user-level file as global
- **AND** all remaining context files are project context, without separately consulting the default home directory

#### Scenario: Missing instruction group

- **WHEN** an operation writes content to an empty global or project group
- **THEN** its body is supplied in memory at the global-first or project-last position as applicable, without changing the other group
- **AND** no instruction file or directory is created or modified on disk

### Requirement: Supported prompt operations

The extension SHALL implement `None`, `ReplaceGlobal`, `ReplaceProject`, `ReplaceBoth`, `Prepend`, and `Append` with the selected body. Prepend and Append SHALL concatenate the body before or after the global content, separated by a blank line when both are nonempty. Replacements SHALL collapse each targeted group to one body. ReplaceBoth SHALL remove both groups and insert the body once at the global location.

#### Scenario: None

- **WHEN** a mode with `replace_mode: None` is active
- **THEN** prompt inputs are unchanged and the custom mode name remains discoverable

#### Scenario: ReplaceGlobal

- **WHEN** a mode with `replace_mode: ReplaceGlobal` is applied
- **THEN** its body replaces the global group once and project entries are unchanged

#### Scenario: ReplaceProject

- **WHEN** a mode with `replace_mode: ReplaceProject` is applied
- **THEN** one body replaces all project entries at the first project position and global entries are unchanged

#### Scenario: ReplaceBoth

- **WHEN** a mode with `replace_mode: ReplaceBoth` is applied
- **THEN** both instruction groups are removed and one body is inserted at the global position
- **AND** unrelated prompt sections and non-file text are preserved

#### Scenario: Cwd is the global directory

- **WHEN** the cwd is the global agent directory and ReplaceBoth is applied
- **THEN** each file belongs to only one group and the body is inserted once

#### Scenario: Prepend

- **WHEN** the global content is `GLOBAL` and the body is `MODE` with `replace_mode: Prepend`
- **THEN** the global content becomes `MODE\n\nGLOBAL`, not a new section elsewhere in the prompt

#### Scenario: Append

- **WHEN** the global content is `GLOBAL` and the body is `MODE` with `replace_mode: Append`
- **THEN** the global content becomes `GLOBAL\n\nMODE`, before the next context entry

### Requirement: Preserve unrelated prompt state

Each agent inference SHALL derive its mode transformation from the current chained request baseline, not a previous mode's effective prompt. The extension SHALL preserve untargeted context and other prompt inputs, SHALL NOT rewrite stored conversation history, and SHALL NOT change model, thinking level, or tool selection. An opaque forced prompt that prevents a required transformation SHALL produce an unavailable mode, not silent success. A compatible transcript SHALL remain projectable when non-system messages precede its first system message.

#### Scenario: Switch between modes and auto

- **WHEN** the user runs in mode A, switches to B, and then switches to `auto`
- **THEN** B does not inherit A's transformation and auto restores unmodified base prompt inputs
- **AND** tools, skills, unrelated extension sections, and untargeted instructions remain unchanged

#### Scenario: Conflicting opaque prompt

- **WHEN** an already-forced opaque prompt prevents a non-None operation from transforming the targeted entries
- **THEN** the extension reports the conflict and exposes an unavailable mode rather than claiming the transformation succeeded

#### Scenario: Startup message before the system message

- **WHEN** another extension adds a custom startup message before Pi's first system message and a valid non-None mode is selected before the first inference
- **AND** structured prompt inputs and compatible instruction blocks are available without an opaque forced prompt
- **THEN** the outgoing request contains the selected instruction transformation and the mode remains ready
- **AND** the startup message retains its content and position relative to the other messages

#### Scenario: Prefix with later system updates

- **WHEN** a compatible request has non-system messages before its first system message and later system messages update instruction sections and tool declarations
- **THEN** projection uses the current instruction baseline after those updates and the selected transformation is not overwritten by an older instruction patch
- **AND** unrelated system sections, system content, tool additions and removals, and the contents and order of non-system messages are preserved
- **AND** the original input messages and stored history are unchanged

#### Scenario: Mode switching with a startup prefix

- **WHEN** a session retains a startup message before its first system message and the user runs in mode A, switches to B, and then selects `auto`
- **THEN** each custom mode uses the current unprojected baseline rather than inheriting a previous mode's transformation
- **AND** `auto` leaves the request transcript unchanged by this extension, including the startup message

#### Scenario: No system message exists

- **WHEN** a non-None mode is applied to a request with structured prompt inputs but no system message anywhere in its transcript
- **THEN** projection fails without modifying the input and exposes the selected mode as unavailable with an actionable reason
- **AND** the extension does not manufacture a successful projection or silently select `auto`

### Requirement: Human mode selection

`/mode <name>` SHALL select a known valid mode. Bare `/mode` SHALL open Pi's native picker where dialog UI is available, otherwise report current mode and availability without opening a dialog. Valid selections SHALL be accepted during active work and queued continuations, with the latest valid accepted choice applied before the next agent inference. Cancellation, invalid input, or failed validation SHALL leave the previous state and saved choice unchanged.

#### Scenario: Direct selection and picker cancellation

- **WHEN** an idle user selects a valid custom mode and then cancels the picker
- **THEN** the custom mode remains selected and cancellation does not append a new choice

#### Scenario: Busy selection

- **WHEN** a valid selection is accepted during a run or queued continuation, including after a picker/file read overlaps active work
- **THEN** it is retained rather than rejected because the agent is busy or the leaf advanced
- **AND** the next agent inference, including one after tool results in the same run, uses the new choice without altering an already-started request

#### Scenario: Several choices before an inference

- **WHEN** several valid choices are accepted before the next agent inference
- **THEN** the latest valid choice is applied at that boundary
- **AND** a later invalid selection does not erase an accepted choice

#### Scenario: Internal model calls

- **WHEN** Pi makes an internal compaction or summary request
- **THEN** this extension does not promise to project mode instructions into that request

#### Scenario: Headless command

- **WHEN** bare `/mode` is invoked without dialog UI
- **THEN** it reports the selected name and availability instead of attempting a picker

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

### Requirement: Unavailable saved mode requires an explicit choice

If a saved mode cannot be loaded or validated, the extension SHALL retain its requested identity as unavailable, report the reason, and require explicit selection of `auto` or a valid custom mode. It SHALL consume normal input and block tool calls until recovery. This readiness gate SHALL NOT be advertised as cancellation of every extension-initiated model request or as a permission policy.

#### Scenario: Removed or invalid saved file

- **WHEN** a saved mode is missing, unreadable, or invalid during restoration
- **THEN** the extension does not silently fall back to auto or stale body text
- **AND** normal prompts and tool execution are blocked with an actionable reason

#### Scenario: Saved whitespace-padded filename

- **WHEN** a previously saved mode id `"review "` has its `review .md` file rejected by filename validation during restoration
- **THEN** it is unavailable under the unchanged requested id, not renamed to `review` or replaced by a malformed-entry placeholder
- **AND** recovery requires an explicit valid choice without implicit auto or stale instruction text

#### Scenario: Explicit recovery

- **WHEN** the user explicitly selects `auto` or another valid mode while unavailable
- **THEN** the new choice is saved, availability becomes ready, and normal input and tool execution can resume

#### Scenario: Extension-generated work while unavailable

- **WHEN** another extension starts a model request without passing through the normal input gate
- **THEN** the mode extension does not claim that request was prevented
- **AND** tool calls that pass through Pi's tool gate remain blocked

### Requirement: Read-only session-scoped mode discovery

Other in-process extensions SHALL be able to query a read-only snapshot with `sessionId`, `id`, and `ready`. Ready snapshots SHALL omit `reason`; unavailable snapshots SHALL include a nonempty actionable `reason`. Queries SHALL NOT change state or expose instructions. Wrong-session requests SHALL receive no response; uninitialized or shut-down instances SHALL NOT expose stale ready state.

#### Scenario: Ready auto and custom snapshots

- **WHEN** a consumer queries the active session while auto or a valid custom mode is selected
- **THEN** it receives that session's mode identity with `ready: true` and no reason, instruction text, or mode-changing API

#### Scenario: Selection while a request is in flight

- **WHEN** a valid mode choice is accepted while an agent request is already running
- **THEN** the snapshot reports the new selected id immediately, not an assertion about the in-flight request
- **AND** the next agent inference applies that selection

#### Scenario: Unavailable and wrong-session snapshots

- **WHEN** the current saved mode is unavailable
- **THEN** the active session's query returns its requested id, `ready: false`, and a nonempty actionable reason
- **AND** a request naming another session receives no snapshot

#### Scenario: Consumer mutation and concurrent sessions

- **WHEN** a consumer modifies its returned snapshot or two sessions select different modes
- **THEN** neither action changes the other session's state or the owning extension's selected mode

### Requirement: Native selected-mode status

When Pi's status UI is available, the extension SHALL publish `mode: <name>` for a ready selection and `mode: <name> (unavailable)` otherwise. The status SHALL follow selected identity and readiness, not an in-flight request, and refresh on each change to either. The extension SHALL use Pi's native footer status facility without replacing the footer or changing other statuses, and SHALL clear only its own status on session shutdown. Native layout and truncation SHALL remain Pi's responsibility.

#### Scenario: Default and custom mode display

- **WHEN** a session finishes restoring `auto` or a valid custom mode
- **THEN** its native status is `mode: auto` or `mode: <name>` respectively
- **AND** custom mode names retain their case and internal spaces, subject to Pi's native rendering

#### Scenario: Accepted direct or picker selection

- **WHEN** a valid mode is accepted through `/mode <name>` or the native picker
- **THEN** the status immediately reflects that selected name without waiting for another agent inference
- **AND** this includes explicit selection of `auto` and file-backed modes with operation `None`

#### Scenario: Selection during active work

- **WHEN** a valid mode is accepted while a model request is in flight
- **THEN** the status shows the newly selected mode
- **AND** it does not imply that the in-flight request used that mode

#### Scenario: Rejected or cancelled choice

- **WHEN** the picker is cancelled, a requested mode is unknown or invalid, or saving the choice fails
- **THEN** the prior status remains unchanged along with the prior selection

#### Scenario: Branch and session restoration

- **WHEN** a session starts, resumes, forks or clones, reloads, or navigates its tree
- **THEN** the status follows restoration of the target branch's saved selection, or `auto` when no selection was saved
- **AND** it does not retain a sibling branch's or previous session's status

#### Scenario: Restoration in progress

- **WHEN** restoration has identified the target mode but is still loading the catalog
- **THEN** the status shows `mode: <name> (unavailable)` rather than presenting stale readiness
- **AND** completion updates it to match the final restored selection and availability

#### Scenario: Superseded restoration

- **WHEN** a pending restoration is superseded by a newer accepted choice or session lifecycle change
- **THEN** its later completion cannot overwrite the current status

#### Scenario: Unavailable saved mode and explicit recovery

- **WHEN** restoration cannot load or validate a saved mode
- **THEN** the status retains its selected identity as `mode: <name> (unavailable)`, including the existing `(invalid saved mode)` identity for malformed saved data
- **AND** existing reports retain the actionable reason without placing that full reason in the footer
- **AND** explicitly selecting `auto` or another valid mode replaces the status with its ready text

#### Scenario: Prompt projection fails

- **WHEN** applying the selected mode fails and the selection becomes unavailable
- **THEN** its status changes to `mode: <name> (unavailable)` while existing error reporting remains intact

#### Scenario: Status ownership and shutdown

- **WHEN** another extension has a native footer status and pi-modal updates its mode or shuts down
- **THEN** the other status is left unchanged
- **AND** shutdown removes pi-modal's status rather than leaving its last selected mode visible

#### Scenario: No footer UI

- **WHEN** the extension runs without a status UI
- **THEN** it does not require a footer, emit additional console status updates, or fail because a footer is absent
- **AND** bare `/mode` retains its existing selected-name and availability report without opening a dialog

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
