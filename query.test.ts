import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
  createEventBus,
  SessionManager,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import modal from "./index.ts";
import { captureConsole, nativeFixture, query } from "./test-helpers.ts";
test("query is silent before initialization and rejects malformed/wrong-session requests", async (t) => {
  const bus = createEventBus();
  // SAFETY: initialization only registers hooks/command/query; session-bound API methods are never called.
  modal({
    events: bus,
    on: () => () => {},
    registerCommand: () => {},
    registerFlag: () => {},
  } as unknown as ExtensionAPI);
  let responses = 0;
  bus.emit("pi-modal:query", {
    sessionId: "not-initialized",
    respond: () => responses++,
  });
  assert.equal(responses, 0);
  const f = await nativeFixture(t);
  const id = f.sm.getSessionId();
  assert.equal(query(f, "wrong-session"), undefined);
  for (const request of [
    null,
    { sessionId: id },
    Object.assign([], { sessionId: id, respond: () => responses++ }),
  ])
    f.bus.emit("pi-modal:query", request);
  assert.equal(responses, 0);
});
test("query copies are frozen and detached across consumers and concurrent sessions", async (t) => {
  const f = await nativeFixture(t);
  const auto = query(f)!;
  assert.deepEqual(Object.keys(auto).sort(), ["id", "ready", "sessionId"]);
  assert.equal(Object.isFrozen(auto), true);
  assert.equal(Reflect.set(auto, "id", "corrupt"), false);
  assert.notEqual(query(f), auto);
  assert.deepEqual(query(f), auto);
  await f.session.prompt("/mode A");
  const other = await f.open(SessionManager.inMemory(f.cwd));
  await other.session.prompt("/mode B");
  assert.equal(query(f)?.id, "A");
  assert.equal(query(other)?.id, "B");
  assert.equal(query(other, f.sm.getSessionId()), undefined);
  assert.equal(auto.id, "auto");
});
test("reload replaces query listeners and shutdown disposes them without mutating old snapshots", async (t) => {
  captureConsole(t, "error");
  const f = await nativeFixture(t);
  const id = f.sm.getSessionId();
  await f.session.prompt("/mode A");
  const a = query(f)!;
  await f.session.reload();
  let responses = 0;
  f.bus.emit("pi-modal:query", { sessionId: id, respond: () => responses++ });
  assert.equal(responses, 1);
  assert.deepEqual(query(f), a);
  await rm(join(f.agentDir, "modes/A.md"));
  await f.session.reload();
  const unavailable = query(f)!;
  assert.deepEqual(Object.keys(unavailable).sort(), [
    "id",
    "ready",
    "reason",
    "sessionId",
  ]);
  assert.equal(unavailable.ready, false);
  assert.ok(unavailable.reason?.length);
  assert.equal(a.ready, true);
  await f.session.extensionRunner.emit({
    type: "session_shutdown",
    reason: "quit",
  });
  assert.equal(query(f), undefined);
  assert.equal(a.id, "A");
});
test("README query consumer runs unchanged and exposes only the documented snapshot", async (t) => {
  const readme = await readFile(
    new URL("./README.md", import.meta.url),
    "utf8",
  );
  const code = readme.match(/```typescript\n([\s\S]*?)\n```/)![1];
  const directory = await mkdtemp(join(tmpdir(), "pi-modal-consumer-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "selected-mode.ts");
  await writeFile(path, code);
  const consumer = (await import(pathToFileURL(path).href)).default;
  const output = captureConsole(t, "info");
  captureConsole(t, "error");
  const f = await nativeFixture(t, [consumer]);
  await f.session.prompt("/selected-mode");
  assert.deepEqual(JSON.parse(output.at(-1)!), {
    sessionId: f.sm.getSessionId(),
    id: "auto",
    ready: true,
  });
  f.sm.appendCustomEntry("pi-modal:mode", { id: "review" });
  await f.session.extensionRunner.emit({
    type: "session_tree",
    oldLeafId: null,
    newLeafId: f.sm.getLeafId(),
    fromExtension: false,
  });
  await f.session.prompt("/selected-mode");
  const unavailable = JSON.parse(output.at(-1)!);
  assert.deepEqual(Object.keys(unavailable).sort(), [
    "id",
    "ready",
    "reason",
    "sessionId",
  ]);
  assert.equal(unavailable.ready, false);
  assert.equal(unavailable.id, "review");
  assert.match(unavailable.reason, /\/mode auto/);
  await f.session.extensionRunner.emit({
    type: "session_shutdown",
    reason: "quit",
  });
  await f.session.prompt("/selected-mode");
  assert.equal(output.at(-1), "Mode unavailable: no response");
});
