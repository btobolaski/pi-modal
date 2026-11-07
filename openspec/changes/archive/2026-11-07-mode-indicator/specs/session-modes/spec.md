# Spec Delta

## MODIFIED Requirements

### Requirement: Built-in auto mode

The extension SHALL provide reserved mode `auto` without requiring a mode file. New sessions and branches without a saved mode SHALL use `auto`. In `auto`, the extension SHALL NOT modify prompt inputs, messages, models, thinking levels, or tool availability; it SHALL only maintain selection, persistence, discovery, and mode-status display behavior.

#### Scenario: Default with no modes directory

- **WHEN** a new session starts and its resolved agent directory has no modes directory
- **THEN** `auto` is ready and discoverable and the prompt is unchanged
- **AND** the native footer status shows `mode: auto` when that UI is available

#### Scenario: Reserved file cannot redefine auto

- **WHEN** `auto.md` exists in the resolved agent directory's modes folder
- **THEN** it is ignored during custom discovery without diagnostics, whether well-formed or malformed
- **AND** the picker/completion lists built-in auto once, and `/mode auto` selects that built-in mode

## ADDED Requirements

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
