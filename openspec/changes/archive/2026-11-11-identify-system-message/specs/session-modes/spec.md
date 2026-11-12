# Spec Delta

## MODIFIED Requirements

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
