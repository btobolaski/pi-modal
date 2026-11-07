import assert from "node:assert/strict";
import fs, { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import {
  createAgentSession,
  createEventBus,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type CustomEntry,
  type EventBus,
  type ExtensionAPI,
  type ExtensionUIContext,
  type SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import { fauxProvider } from "@earendil-works/pi-ai";
import type { ModeSnapshot } from "./index.ts";
export async function nativeFixture(
  t: TestContext,
  extensionFactories: ((pi: ExtensionAPI) => void)[] = [],
  persistent = false,
) {
  const dir = await mkdtemp(join(tmpdir(), "pi-modal-native-"));
  const agentDir = join(dir, "agent");
  const cwd = join(dir, "project");
  const env = {
    HOME: process.env.HOME,
    PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
  };
  process.env.HOME = dir;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(async () => {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  });
  await mkdir(join(agentDir, "modes"), { recursive: true });
  await mkdir(cwd);
  await writeFile(join(dir, "AGENTS.md"), "ANCESTOR");
  await writeFile(join(cwd, "CLAUDE.md"), "PROJECT");
  await writeFile(join(dir, "global-target.md"), "GLOBAL");
  await symlink(join(dir, "global-target.md"), join(agentDir, "CLAUDE.md"));
  for (const [id, operation] of [
    ["A", "ReplaceProject"],
    ["B", "Append"],
    ["none", "None"],
    ["status", "ReplaceBoth"],
  ]) {
    await writeFile(
      join(agentDir, "modes", `${id}.md`),
      definition(operation, id),
    );
  }
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: false },
  });
  const faux = fauxProvider({ provider: "pi-modal-test" });
  const runtime = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: null,
    modelsStorePath: join(agentDir, "models-cache.json"),
    refreshOnCreate: false,
  });
  runtime.registerNativeProvider(faux.provider);
  const open = async (
    sm: SessionManager,
    reason: SessionStartEvent["reason"] = "startup",
    sessionCwd = cwd,
  ) => {
    const bus = createEventBus();
    const loader = new DefaultResourceLoader({
      cwd: sessionCwd,
      agentDir,
      settingsManager,
      eventBus: bus,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      additionalExtensionPaths: [join(process.cwd(), "index.ts")],
      extensionFactories,
    });
    await loader.reload();
    assert.deepEqual(loader.getExtensions().errors, []);
    const { session } = await createAgentSession({
      cwd: sessionCwd,
      agentDir,
      modelRuntime: runtime,
      model: faux.getModel(),
      resourceLoader: loader,
      sessionManager: sm,
      settingsManager,
      sessionStartEvent: { type: "session_start", reason },
    });
    const extensionErrors: unknown[] = [];
    await session.bindExtensions({
      onError: (error) => extensionErrors.push(error),
    });
    t.after(() => {
      session.dispose();
      assert.deepEqual(extensionErrors, []);
      for (const message of session.messages)
        if (message.role === "assistant")
          assert.notEqual(
            message.stopReason,
            "error",
            "provider assertions must propagate",
          );
    });
    return { sm, session, bus, loader };
  };
  const sm = persistent
    ? SessionManager.create(cwd, join(dir, "sessions"))
    : SessionManager.inMemory(cwd);
  return { dir, agentDir, cwd, faux, open, ...(await open(sm)) };
}
export const deferred = <T = void>() => Promise.withResolvers<T>();
export function query(
  f: { bus: EventBus; sm: SessionManager },
  sessionId = f.sm.getSessionId(),
): ModeSnapshot | undefined {
  let result: ModeSnapshot | undefined;
  f.bus.emit("pi-modal:query", {
    sessionId,
    respond: (snapshot: ModeSnapshot) => {
      result = snapshot;
    },
  });
  return result;
}
export const savedChoices = (sm: SessionManager) =>
  sm
    .getBranch()
    .filter(
      (entry): entry is CustomEntry =>
        entry.type === "custom" && entry.customType === "pi-modal:mode",
    );
export const definition = (operation: string, body = "MODE") =>
  `---\nreplace_mode: ${operation}\n---\n${body}\n`;

export function holdModeRead(t: TestContext, id: string) {
  const entered = deferred(),
    release = deferred();
  const read = fs.readFile;
  let held = false;
  t.mock.method(fs, "readFile", async (...args: Parameters<typeof read>) => {
    if (!held && String(args[0]).endsWith(`/${id}.md`)) {
      held = true;
      entered.resolve();
      await release.promise;
    }
    return read(...args);
  });
  return { entered, release };
}
export function captureConsole(t: TestContext, method: "error" | "info") {
  const messages: string[] = [];
  t.mock.method(console, method, (...args: unknown[]) =>
    messages.push(args.join(" ")),
  );
  return messages;
}
export function mockPicker(
  f: { session: AgentSession },
  select: ExtensionUIContext["select"],
  notify: ExtensionUIContext["notify"] = () => {},
  setStatus: ExtensionUIContext["setStatus"] = () => {},
) {
  // SAFETY: pi-modal's UI paths call only select/notify/setStatus; other UI methods are outside these fixtures.
  f.session.extensionRunner.setUIContext({
    notify,
    select,
    setStatus,
  } as unknown as ExtensionUIContext);
}
