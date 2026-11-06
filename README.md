# pi-modal

Switch the instructions Pi uses for a session without editing your `AGENTS.md` files. Define modes as Markdown files, then choose one with `/mode`—for example, a review mode that replaces project instructions with review-specific guidance.

pi-modal is tested with **Pi 1.5.0**. Its prompt integration depends on that version's format; other versions may not work.

## Getting started

Install the extension from a local checkout:

```sh
pi install /path/to/pi-modal
```

Or try it for one invocation with `pi -e /path/to/pi-modal`. Load only one copy per session.

Create a mode file at `~/.pi/agent/modes/review.md`:

```markdown
---
replace_mode: ReplaceProject
---
Review changes for correctness. Do not modify files.
```

In Pi, select it with `/mode review`. Run `/mode` to choose from a picker, or `/mode auto` to return to Pi's unchanged instructions. Only one mode is selected at a time; `auto` is the default and needs no file.

The example replaces the loaded **project** instructions for subsequent agent requests. It does not change the files on disk, erase conversation history, or prevent tools from modifying files. Instructions are not a permission boundary.

## Writing modes

Put each mode in a direct `<name>.md` file under the Pi agent directory's `modes/` folder. The default is `~/.pi/agent/modes/`; Pi's `PI_CODING_AGENT_DIR` setting changes the agent directory. The filename stem is the name used with `/mode` and is case-sensitive. Internal spaces are allowed; surrounding whitespace is rejected, not trimmed. Subdirectories and non-Markdown files are ignored. Symlinks to regular files are supported; non-regular targets are reported as invalid without reading them.

Each file needs YAML frontmatter with a `replace_mode` value, followed by the instructions in the Markdown body. Other frontmatter is ignored; the body may be empty. Pi normalizes BOMs and newlines and trims the body of a file with frontmatter. Available values are:

| `replace_mode` | Effect |
| --- | --- |
| `None` | Leave instructions unchanged while selecting this mode. |
| `ReplaceGlobal` | Replace global instructions with the mode body. |
| `ReplaceProject` | Replace project instructions with the mode body. |
| `ReplaceBoth` | Replace both groups with the mode body, inserted once. |
| `Prepend` | Add the body before global instructions. |
| `Append` | Add the body after global instructions. |

**Global** means instruction files loaded from Pi's resolved agent directory. **Project** means every other loaded instruction file, including files in ancestor directories and the current directory. Grouping is by source directory, not filename; `AGENTS.md`, `CLAUDE.md`, and override files are treated alike.

`auto.md` is ignored: `auto` always means no change and works even if the `modes/` directory does not exist. Invalid or unreadable mode files are reported individually and do not prevent other valid modes from being selected.

## Selecting and updating modes

- `/mode <name>` selects a mode. Completion lists valid names.
- `/mode` opens the picker when dialogs are available; without a dialog UI, it reports the current selection and availability.
- `/mode auto` returns to the unchanged baseline. `status` is an ordinary mode name, not a subcommand.

A selection is saved on the active session branch and takes effect at the **next agent inference**, including the next inference after tool results. It does not change a request already in progress or tool calls already generated. If you select another mode before the next inference, the latest selection wins. Internal compaction and summary calls are not projected.

The active branch's last selection is restored on resume, fork, tree navigation, and reload; sibling branch selections do not carry over. A branch with no saved selection starts in `auto`. Pi handles storage; ephemeral sessions do not promise restoration after exit.

Mode contents are loaded when selected or restored, not watched. After editing a mode file, reselect it or use `/reload` to pick up the changes. Switching modes starts from the current baseline, so instructions from previous modes do not accumulate.

### Unavailable modes

If a saved mode is missing, invalid, or unreadable, pi-modal retains its name as unavailable rather than silently switching to `auto`. Normal input is blocked and native tool calls are blocked with termination requested. Select `/mode auto` or another valid mode to recover. A saved name with surrounding whitespace also remains unavailable under that exact name; it is not trimmed. A malformed saved selection is reported as `(invalid saved mode)`. A failed selection does not replace the previous one; if saving fails, retry the command.

Some incompatible or opaque prompts can also make a mode unavailable. This readiness check is **not a security or cancellation guarantee**: Pi may log prompt-hook exceptions without cancelling a request, and other extensions, direct I/O, later prompt overrides, and internal compaction or summary calls are outside the gate.

## How instructions are applied

pi-modal changes the instruction blocks in each request; it does not rewrite instruction files, stored history, model settings, thinking levels, or tool settings. Earlier conversation content remains in the context. Changes made by later request handlers or provider-payload rewrites can still override the projection, and Pi's baseline prompt inspection may not show the final request-local result.

Replacement happens once at the first targeted block. `ReplaceBoth` inserts the body at the global position. `Prepend` and `Append` add it to the first or last global block, separated by a blank line when both parts are nonempty. If a receiving group is absent, an in-memory block is added; no file is created. Logical source paths determine grouping, including for symlinks.

## Querying the selected mode

Other extensions in the same session can emit `pi-modal:query` with a session ID and a callback. The callback receives a synchronous, frozen snapshot of the **selection**, not necessarily the mode used by an in-flight request. It contains no instruction text and cannot change the mode. No response means the mode should be treated as unavailable.

For example, save this as `selected-mode.ts`, load it alongside pi-modal (`pi -e /path/to/pi-modal -e ./selected-mode.ts`), then run `/selected-mode`:

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type ModeSnapshot = Readonly<
  { sessionId: string; id: string } &
  ({ ready: true; reason?: never } | { ready: false; reason: string })
>;
type ModeQuery = {
  sessionId: string;
  respond: (snapshot: ModeSnapshot) => void;
};

export default function (pi: ExtensionAPI) {
  pi.registerCommand("selected-mode", {
    description: "Query the selected instruction mode",
    handler: async (_args, ctx) => {
      let snapshot: ModeSnapshot | undefined;
      const request: ModeQuery = {
        sessionId: ctx.sessionManager.getSessionId(),
        respond: value => { snapshot = value; },
      };
      pi.events.emit("pi-modal:query", request);
      const text = snapshot ? JSON.stringify(snapshot) : "Mode unavailable: no response";
      if (ctx.hasUI) ctx.ui.notify(text, "info");
      else console.info(text);
    },
  });
}
```

A ready response looks like `{"sessionId":"...","id":"auto","ready":true}`. An unavailable response has `ready: false` and an actionable `reason`. Query again after a selection, branch change, or reload; snapshots do not update. There is no broadcast or cross-process transport. The package has no supported root type import, so consumers define the small wire types themselves.

## Development

Use `nix develop` (or direnv with the checked-in `.envrc`) for Node 22 and pnpm. Node **22.19+** is required for native TypeScript stripping.

```sh
pnpm install --ignore-scripts --frozen-lockfile
pnpm test
```

If pnpm reports previously recorded ignored builds, repeat the install with `--force --ignore-scripts --frozen-lockfile`. Dependency lifecycle scripts are not needed. The Nix shell also provides Prettier, Taplo, treefmt, and Alejandra; formatter configuration is supplied by the environment.
