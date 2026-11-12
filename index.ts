import { writeSync } from "node:fs";
// Keep fs methods interceptable by native checks with t.mock.method.
import fs from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  getAgentDir,
  parseFrontmatter,
  type ExtensionAPI,
  type ExtensionContext,
  type ContextWithSystemEvent,
  type NormalizedBuildSystemPromptOptions,
} from "@earendil-works/pi-coding-agent";
import { getCurrentSystemMessage } from "@earendil-works/pi-ai";

/** @internal Exact frontmatter values; exported only for native checks. */
export const operations = [
  "None",
  "ReplaceGlobal",
  "ReplaceProject",
  "ReplaceBoth",
  "Prepend",
  "Append",
] as const;
/** @internal A validated replace_mode value. */
export type Operation = (typeof operations)[number];
type Mode = { id: string; operation: Operation; body: string };
/** Selected mode, not the in-flight request's mode; detached snapshots never expose instructions. */
export type ModeSnapshot = Readonly<
  { sessionId: string; id: string } & (
    { ready: true; reason?: never } | { ready: false; reason: string }
  )
>;
/** Synchronous, read-only pi-modal:query request; only the matching active session responds. */
export type ModeQuery = {
  sessionId: string;
  respond: (snapshot: ModeSnapshot) => void;
};
const auto: Mode = { id: "auto", operation: "None", body: "" };
const validName = (id: unknown): id is string =>
  typeof id === "string" && id.length > 0 && !/[\/\\\0]/.test(id);

/**
 * @internal Discover validated definitions without accepting raw selection paths.
 * errors uses mode-id keys for file failures and join(agentDir, "modes") for a
 * directory-read failure. Enumerate all values for diagnostics; errors.get(id)
 * supplies only a selected file's failure. A missing directory is not an error.
 */
export async function discoverModes(agentDir = getAgentDir()) {
  const modes = new Map<string, Mode>([["auto", auto]]);
  const errors = new Map<string, string>();
  const directory = join(agentDir, "modes");
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      errors.set(directory, `Cannot read ${directory}: ${String(error)}`);
    }
    return { modes, errors };
  }
  for (const entry of entries.sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )) {
    if (
      !entry.name.endsWith(".md") ||
      entry.name === "auto.md" ||
      !(entry.isFile() || entry.isSymbolicLink())
    )
      continue;
    const id = entry.name.slice(0, -3);
    const path = join(directory, entry.name);
    try {
      if (!validName(id))
        throw new Error(
          "Mode name must be a nonempty filename stem, not a path",
        );
      if (id !== id.trim())
        throw new Error(
          "Mode filename must not contain surrounding whitespace",
        );
      if (entry.isSymbolicLink() && !(await fs.stat(path)).isFile())
        throw new Error("Mode symlink target must be a regular file");
      const { frontmatter, body } = parseFrontmatter(
        await fs.readFile(path, "utf8"),
      );
      if (
        !frontmatter ||
        typeof frontmatter !== "object" ||
        Array.isArray(frontmatter) ||
        !operations.includes(frontmatter.replace_mode as Operation)
      ) {
        throw new Error(
          `Expected YAML object with replace_mode: ${operations.join(" | ")}`,
        );
      }
      modes.set(id, {
        id,
        operation: frontmatter.replace_mode as Operation,
        body,
      });
    } catch (error) {
      errors.set(id, `Invalid mode ${path}: ${String(error)}`);
    }
  }
  return { modes, errors };
}

type ContextFile = { path: string; content: string };

/** @internal Transform logical source groups without changing the input files. */
export function transformGroups(
  files: ContextFile[],
  mode: Mode,
  agentDir = getAgentDir(),
): ContextFile[] {
  if (mode.operation === "None") return files;
  const global = files.map(
    (file) => dirname(resolve(file.path)) === resolve(agentDir),
  );
  const targetGlobal = mode.operation !== "ReplaceProject";
  const indexes = files.flatMap((_, i) =>
    mode.operation === "ReplaceBoth" || global[i] === targetGlobal ? [i] : [],
  );
  const first = targetGlobal ? global.indexOf(true) : (indexes[0] ?? -1);
  const synthetic = {
    path: `pi-modal:${targetGlobal ? "global" : "project"}`,
    content: mode.body,
  };
  if (mode.operation === "Prepend" || mode.operation === "Append") {
    if (!indexes.length) return [synthetic, ...files];
    const index = mode.operation === "Prepend" ? indexes[0] : indexes.at(-1)!;
    return files.map((file, i) =>
      i !== index
        ? file
        : {
            ...file,
            content: (mode.operation === "Prepend"
              ? [mode.body, file.content]
              : [file.content, mode.body]
            )
              .filter(Boolean)
              .join("\n\n"),
          },
    );
  }
  // ponytail: quadratic scans over small context lists; index paths if large lists matter.
  const result = files.flatMap((file, i) => {
    if (i === first) return [{ ...file, content: mode.body }];
    return indexes.includes(i) ? [] : [file];
  });
  if (first === -1) {
    if (targetGlobal) result.unshift(synthetic);
    else result.push(synthetic);
  }
  return result;
}

// Pi 1.5.0 section values are wrapped; match complete source blocks, not Markdown.
const renderBlock = (file: ContextFile) =>
  `<project_instructions path="${file.path}">\n${file.content}\n</project_instructions>`;
const sectionPrefix =
  "<project_context>\nProject-specific instructions and guidelines:";
const sectionSuffix = "\n</project_context>";

/** @internal Project one request's transcript, preserving untargeted sections and stored history. */
export function projectMessages(
  messages: ContextWithSystemEvent["messages"],
  options: NormalizedBuildSystemPromptOptions | undefined,
  mode: Mode,
  agentDir = getAgentDir(),
): ContextWithSystemEvent["messages"] {
  if (mode.operation === "None") return messages;
  if (!options || options.forceSystemPrompt !== undefined)
    throw new Error(
      "Structured prompt inputs unavailable or an opaque forced prompt is active",
    );
  const systemIndex = messages.findIndex((message) => message.role === "system");
  if (systemIndex === -1) throw new Error("Missing system message");
  const files = options.contextFiles;
  const transformed = transformGroups(files, mode, agentDir);
  if (new Set(transformed.map((file) => file.path)).size !== transformed.length)
    throw new Error("Ambiguous projected context paths");
  const current = getCurrentSystemMessage(messages)?.sections?.project_context;
  let section: string;
  if (current === undefined || current === null) {
    if (files.length) throw new Error("Missing project_context source blocks");
    section = `${sectionPrefix}\n\n${transformed.map(renderBlock).join("\n\n")}${sectionSuffix}`;
  } else {
    if (
      !current.startsWith("<project_context>\n") ||
      !current.endsWith(sectionSuffix)
    )
      throw new Error("Incompatible project_context wrapper");
    const paths = new Set(files.map((file) => file.path));
    if (paths.size !== files.length)
      throw new Error("Ambiguous duplicate context paths");
    const spans = files
      .map((file) => {
        const block = renderBlock(file);
        const start = current.indexOf(block);
        if (start < 0 || current.indexOf(block, start + 1) !== -1)
          throw new Error(`Missing or ambiguous source block: ${file.path}`);
        return { file, start, end: start + block.length };
      })
      .sort((a, b) => a.start - b.start);
    for (let i = 1; i < spans.length; i++) {
      if (spans[i].start < spans[i - 1].end)
        throw new Error("Overlapping source blocks");
    }
    const edits = spans.map(({ file, start, end }) => {
      const replacement = transformed.find((next) => next.path === file.path);
      return { start, end, text: replacement ? renderBlock(replacement) : "" };
    });
    for (const synthetic of transformed.filter(
      (file) => !paths.has(file.path),
    )) {
      const global = synthetic.path === "pi-modal:global";
      const position = global
        ? (spans[0]?.start ??
          (current.startsWith(sectionPrefix)
            ? sectionPrefix.length
            : "<project_context>\n".length))
        : (spans.at(-1)?.end ?? current.length - sectionSuffix.length);
      edits.push({
        start: position,
        end: position,
        text: global
          ? `${spans.length ? "" : "\n\n"}${renderBlock(synthetic)}\n\n`
          : `\n\n${renderBlock(synthetic)}`,
      });
    }
    section = current;
    for (const edit of edits.sort(
      (a, b) => b.start - a.start || b.end - a.end,
    )) {
      section =
        section.slice(0, edit.start) + edit.text + section.slice(edit.end);
    }
  }
  return messages.map((message, i) => {
    if (message.role !== "system") return message;
    if (i === systemIndex)
      return {
        ...message,
        sections: { ...message.sections, project_context: section },
      };
    if (!message.sections || !("project_context" in message.sections))
      return message;
    const sections = { ...message.sections };
    // A null patch would delete the projected section during replay, not neutralize it.
    delete sections.project_context;
    return { ...message, sections };
  });
}

export default function modal(pi: ExtensionAPI) {
  pi.registerFlag("modal", {
    description:
      "Select instruction mode at startup (auto or an exact custom name)",
    type: "string",
  });
  let options: NormalizedBuildSystemPromptOptions | undefined;
  let selection: Mode | { id: string; reason: string } = auto;
  let session: { id: string } | undefined;
  let revision = 0;
  const recoverySuffix = ". Select /mode auto or a valid mode.";
  const publishStatus = (ctx: ExtensionContext) => {
    if (ctx.hasUI)
      ctx.ui.setStatus(
        "pi-modal",
        `mode: ${selection.id}${"operation" in selection ? "" : " (unavailable)"}`,
      );
  };
  const notify = (ctx: ExtensionContext, message: string, error = false) => {
    if (ctx.hasUI) ctx.ui.notify(message, error ? "error" : "info");
    else if (error) console.error(message);
    else console.info(message);
  };
  const catalog = async (
    ctx: ExtensionContext,
    reported = new Set<string>(),
  ) => {
    const identity = session;
    const result = await discoverModes();
    if (identity === session)
      for (const reason of result.errors.values()) {
        if (reported.has(reason)) continue;
        reported.add(reason);
        notify(ctx, `${reason}${recoverySuffix}`, true);
      }
    return result;
  };
  const restore = async (ctx: ExtensionContext) => {
    const identity = session;
    const version = ++revision;
    const saved = ctx.sessionManager
      .getBranch()
      .filter(
        (entry) =>
          entry.type === "custom" && entry.customType === "pi-modal:mode",
      )
      .at(-1);
    const data =
      saved?.type === "custom"
        ? (saved.data as { id?: unknown } | null)
        : undefined;
    const valid =
      !saved ||
      (!!data &&
        typeof data === "object" &&
        !Array.isArray(data) &&
        validName(data.id));
    const id = !saved
      ? "auto"
      : valid
        ? (data!.id as string)
        : "(invalid saved mode)";
    selection = {
      id,
      reason: "Restoring mode; select /mode auto to recover if necessary.",
    };
    publishStatus(ctx);
    const { modes, errors } = await catalog(ctx);
    if (session !== identity || revision !== version) return;
    selection = (valid ? modes.get(id) : undefined) ?? {
      id,
      reason: `${errors.get(id) ?? `Saved mode ${id} is missing or malformed`}${recoverySuffix}`,
    };
    publishStatus(ctx);
    if (!("operation" in selection) && !errors.has(id))
      notify(ctx, selection.reason, true);
  };
  const accept = (mode: Mode) => {
    try {
      pi.appendEntry("pi-modal:mode", { id: mode.id });
    } catch (error) {
      throw new Error(
        `Cannot save mode ${mode.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    revision++;
    selection = mode;
  };
  pi.on("session_start", async (event, ctx) => {
    const identity = (session = { id: ctx.sessionManager.getSessionId() });
    options = undefined;
    const requested = pi.getFlag("modal");
    if (event.reason !== "startup" || typeof requested !== "string") {
      await restore(ctx);
      return;
    }
    try {
      const { modes, errors } = await catalog(ctx);
      if (session !== identity) return;
      const mode = modes.get(requested);
      if (!mode)
        throw new Error(errors.get(requested) ?? `Unknown mode: ${requested}`);
      accept(mode);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      writeSync(
        2,
        `pi-modal: --modal ${JSON.stringify(requested)} rejected: ${reason}\nChoose --modal auto or a valid exact mode name, or omit --modal.\n`,
      );
      // Graceful shutdown does not stop print-mode startup prompts.
      process.exit(1);
    }
    publishStatus(ctx);
  });
  pi.on("session_tree", async (_event, ctx) => {
    await restore(ctx);
  });
  const disposeQuery = pi.events.on("pi-modal:query", (request) => {
    if (
      !session ||
      !request ||
      typeof request !== "object" ||
      Array.isArray(request)
    )
      return;
    const { sessionId, respond } = request as Partial<ModeQuery>;
    if (sessionId !== session.id || typeof respond !== "function") return;
    const snapshot: ModeSnapshot =
      "operation" in selection
        ? { sessionId, id: selection.id, ready: true }
        : {
            sessionId,
            id: selection.id,
            ready: false,
            reason: selection.reason,
          };
    respond(Object.freeze(snapshot));
  });
  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.hasUI) ctx.ui.setStatus("pi-modal", undefined);
    disposeQuery();
    session = undefined;
    options = undefined;
    selection = auto;
    revision++;
  });
  pi.on("input", (_event, ctx) => {
    if (session && !("operation" in selection)) {
      notify(ctx, selection.reason, true);
      return { action: "handled" };
    }
  });
  pi.on("tool_call", () => {
    if (session && !("operation" in selection))
      return { block: true, reason: selection.reason, terminate: true };
  });
  pi.registerCommand("mode", {
    description: "Select instruction mode (or show the native picker)",
    getArgumentCompletions: async (prefix) => {
      const { modes } = await discoverModes();
      const items = [...modes.keys()]
        .filter((id) => id.startsWith(prefix))
        .map((id) => ({ value: id, label: id }));
      return items.length ? items : null;
    },
    handler: async (args, ctx) => {
      const identity = session;
      if (!identity) return;
      let id = args.trim();
      if (!id && !ctx.hasUI) {
        notify(
          ctx,
          `Mode: ${selection.id} (${"operation" in selection ? "ready" : selection.reason})`,
        );
        return;
      }
      const reported = new Set<string>();
      if (!id) {
        const { modes } = await catalog(ctx, reported);
        if (session !== identity) return;
        id = (await ctx.ui.select("Select mode", [...modes.keys()])) ?? "";
        if (!id) return;
      }
      const { modes, errors } = await catalog(ctx, reported);
      if (
        session !== identity ||
        ctx.sessionManager.getSessionId() !== identity.id
      )
        return;
      const mode = modes.get(id);
      if (!mode) {
        if (!errors.has(id))
          notify(
            ctx,
            `Unknown mode: ${id}. Use /mode to list valid modes.`,
            true,
          );
        return;
      }
      try {
        accept(mode);
      } catch (error) {
        notify(
          ctx,
          `${error instanceof Error ? error.message : String(error)}. Previous selection retained; retry /mode ${id}.`,
          true,
        );
        return;
      }
      publishStatus(ctx);
      notify(
        ctx,
        `Mode ${id} accepted; applies before the next agent inference, not to an in-flight request.`,
      );
    },
  });

  pi.on("before_agent_start", (event) => {
    options = event.systemPromptOptions;
  });
  pi.on("context_with_system", (event, ctx) => {
    if (!("operation" in selection)) return;
    try {
      return { messages: projectMessages(event.messages, options, selection) };
    } catch (error) {
      selection = {
        id: selection.id,
        reason: `Cannot apply mode: ${String(error)}. Select /mode auto or a compatible mode.`,
      };
      publishStatus(ctx);
      notify(ctx, selection.reason, true);
    }
  });
}
