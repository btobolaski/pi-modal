import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  fauxAssistantMessage,
  fauxToolCall,
  getCurrentSystemPrompt,
} from "@earendil-works/pi-ai";
import {
  captureConsole,
  deferred,
  definition,
  holdModeRead,
  mockPicker,
  nativeFixture,
  query,
  savedChoices,
} from "./test-helpers.ts";
function recordStatus(
  f: Parameters<typeof mockPicker>[0],
  select: Parameters<typeof mockPicker>[1] = async () => undefined,
  notify?: Parameters<typeof mockPicker>[2],
) {
  const statuses = new Map<string, string | undefined>();
  mockPicker(f, select, notify, (key, text) => statuses.set(key, text));
  return statuses;
}

test("native status publishes restored readiness and removes its entry on shutdown", async (t) => {
  const f = await nativeFixture(t);
  const statuses = recordStatus(f);
  statuses.set("other-extension", "keep me");
  await f.session.extensionRunner.emit({
    type: "session_start",
    reason: "startup",
  });
  assert.equal(statuses.get("pi-modal"), "mode: auto");
  f.sm.appendCustomEntry("pi-modal:mode", { id: "missing" });
  await f.session.extensionRunner.emit({
    type: "session_start",
    reason: "resume",
  });
  assert.equal(statuses.get("pi-modal"), "mode: missing (unavailable)");
  assert.equal(query(f)?.id, "missing");
  assert.equal(query(f)?.ready, false);
  await f.session.prompt("/mode auto");
  assert.equal(statuses.get("pi-modal"), "mode: auto");
  await f.session.extensionRunner.emit({ type: "session_shutdown", reason: "new" });
  assert.deepEqual([...statuses], [
    ["other-extension", "keep me"],
    ["pi-modal", undefined],
  ]);
});

// These phases form one causal chain: each choice changes the next busy boundary.
// Split future independent phases only when doing so removes repeated setup.
test("native busy commands accept latest valid choice through streaming, tool loops and queued continuation", async (t) => {
  const entered = deferred();
  const release = deferred();
  let duringTool = async () => {};
  const f = await nativeFixture(t, [
    (pi) => {
      pi.on("tool_call", async () => {
        await duringTool();
      });
    },
  ]);
  const seen: string[] = [];
  duringTool = async () => {
    assert.equal(f.session.isStreaming, true);
    await f.session.prompt("/mode A");
  };
  f.faux.setResponses([
    async (context) => {
      seen.push(getCurrentSystemPrompt(context.messages));
      entered.resolve();
      await release.promise;
      assert.equal(getCurrentSystemPrompt(context.messages), seen[0]);
      return fauxAssistantMessage(
        fauxToolCall("read", { path: join(f.cwd, "CLAUDE.md") }),
        { stopReason: "toolUse" },
      );
    },
    (context) => {
      seen.push(getCurrentSystemPrompt(context.messages));
      return fauxAssistantMessage("done");
    },
    (context) => {
      seen.push(getCurrentSystemPrompt(context.messages));
      return fauxAssistantMessage("continuation done");
    },
  ]);
  const running = f.session.prompt("start");
  await entered.promise;
  const statuses = recordStatus(f, async () => {
    f.sm.appendCustomEntry("work advanced while busy picker awaited");
    return "A";
  });
  await f.session.prompt("/mode");
  assert.equal(statuses.get("pi-modal"), "mode: A");
  await f.session.prompt("queued", { streamingBehavior: "followUp" });
  await f.session.prompt("/mode B");
  assert.equal(statuses.get("pi-modal"), "mode: B");
  const accepted = savedChoices(f.sm).length;
  await f.session.prompt("/mode ../A");
  assert.equal(savedChoices(f.sm).length, accepted);
  assert.deepEqual(savedChoices(f.sm).at(-1)?.data, { id: "B" });
  assert.deepEqual(query(f), {
    sessionId: f.sm.getSessionId(),
    id: "B",
    ready: true,
  });
  assert.ok(
    seen[0].includes("ANCESTOR"),
    "query selection changes before the in-flight baseline",
  );
  release.resolve();
  await running;
  assert.equal(seen.length, 3);
  for (const prompt of seen.slice(1)) {
    assert.equal(prompt.includes("ANCESTOR"), false);
    assert.ok(prompt.includes("\nA\n</project_instructions>"));
  }
  assert.deepEqual(
    savedChoices(f.sm).map((e) => e.data),
    [{ id: "A" }, { id: "B" }, { id: "A" }],
  );
});

test("completion and headless status do not reserve a status subcommand", async (t) => {
  const output = captureConsole(t, "info");
  const f = await nativeFixture(t);
  const command = f.loader.getExtensions().extensions[0].commands.get("mode")!;
  assert.deepEqual(
    (await command.getArgumentCompletions!(""))?.map((item) => item.value),
    ["auto", "A", "B", "none", "status"],
  );
  assert.equal(await command.getArgumentCompletions!("unknown"), null);
  assert.deepEqual(output, [], "headless startup adds no status chatter");
  await f.session.prompt("/mode");
  assert.deepEqual(output, ["Mode: auto (ready)"]);
  assert.equal(savedChoices(f.sm).length, 0);
  await f.session.prompt("/mode status");
  assert.equal(query(f)?.id, "status");
  assert.deepEqual(output, [
    "Mode: auto (ready)",
    "Mode status accepted; applies before the next agent inference, not to an in-flight request.",
  ]);
  await f.session.prompt("/mode");
  assert.equal(output.at(-1), "Mode: status (ready)");
});
test("status preserves exact case and spaces for direct, picker and None selections", async (t) => {
  const f = await nativeFixture(t);
  await writeFile(join(f.agentDir, "modes/Review Notes.md"), definition("None"));
  const statuses = recordStatus(f, async () => "Review Notes");
  await f.session.prompt("/mode Review Notes");
  assert.equal(statuses.get("pi-modal"), "mode: Review Notes");
  await f.session.prompt("/mode auto");
  assert.equal(statuses.get("pi-modal"), "mode: auto");
  await f.session.prompt("/mode");
  assert.equal(statuses.get("pi-modal"), "mode: Review Notes");
  assert.deepEqual(query(f), {
    sessionId: f.sm.getSessionId(),
    id: "Review Notes",
    ready: true,
  });
  await f.session.prompt("/mode none");
  assert.equal(statuses.get("pi-modal"), "mode: none");
});

test("filename eligibility excludes padded stems but keeps exact internal-space names selectable", async (t) => {
  captureConsole(t, "error");
  const f = await nativeFixture(t);
  for (const id of ["review ", " review", "review", "review notes"])
    await writeFile(
      join(f.agentDir, "modes", `${id}.md`),
      definition("None", id),
    );
  const command = f.loader.getExtensions().extensions[0].commands.get("mode")!;
  assert.deepEqual(
    (await command.getArgumentCompletions!(""))
      ?.map((item) => item.value)
      .filter((id) => id.includes("review")),
    ["review notes", "review"],
  );
  for (const id of ["review", "review notes"]) {
    await f.session.prompt(`/mode ${id}`);
    assert.deepEqual(savedChoices(f.sm).at(-1)?.data, { id });
    const before = savedChoices(f.sm).length;
    mockPicker(f, async (_title, names) => {
      assert.deepEqual(
        names.filter((name) => name.includes("review")),
        ["review notes", "review"],
      );
      return id;
    });
    await f.session.prompt("/mode");
    assert.equal(savedChoices(f.sm).length, before + 1);
    assert.deepEqual(query(f), {
      sessionId: f.sm.getSessionId(),
      id,
      ready: true,
    });
  }
});
test("a saved padded filename stays unavailable under its exact id until explicit recovery", async (t) => {
  captureConsole(t, "error");
  const f = await nativeFixture(t);
  for (const id of ["review ", "review"])
    await writeFile(join(f.agentDir, "modes", `${id}.md`), definition("None"));
  f.sm.appendCustomEntry("pi-modal:mode", { id: "review " });
  await f.session.reload();
  const unavailable = query(f);
  assert.ok(unavailable && !unavailable.ready);
  assert.equal(unavailable.id, "review ");
  assert.match(unavailable.reason, /surrounding whitespace.*\/mode auto/);
  assert.deepEqual(savedChoices(f.sm).at(-1)?.data, { id: "review " });
  await f.session.prompt("/mode review");
  assert.deepEqual(query(f), {
    sessionId: f.sm.getSessionId(),
    id: "review",
    ready: true,
  });
  assert.deepEqual(savedChoices(f.sm).at(-1)?.data, { id: "review" });
});
test("picker revalidation deduplicates failures without hiding changes or later invocations", async (t) => {
  const f = await nativeFixture(t);
  const errors: string[] = [];
  const notify = (message: string, type?: string) => {
    if (type === "error") errors.push(message);
  };
  for (const id of ["bad", "steady"])
    await writeFile(
      join(f.agentDir, "modes", `${id}.md`),
      definition("invalid"),
    );
  mockPicker(
    f,
    async (_title, names) => {
      assert.deepEqual(names, ["auto", "A", "B", "none", "status"]);
      f.sm.appendCustomEntry("advanced while picker awaited");
      await writeFile(
        join(f.agentDir, "modes/A.md"),
        definition("ReplaceProject", "CHANGED DURING PICKER"),
      );
      await writeFile(
        join(f.agentDir, "modes/bad.md"),
        "---\nreplace_mode: [\n---",
      );
      await writeFile(join(f.agentDir, "modes/late.md"), definition("invalid"));
      return "A";
    },
    notify,
  );
  await f.session.prompt("/mode");
  assert.equal(query(f)?.id, "A");
  assert.equal(errors.length, 4);
  assert.equal(
    errors.filter((message) => message.includes("steady.md")).length,
    1,
  );
  const changed = errors.filter((message) => message.includes("bad.md"));
  assert.equal(changed.length, 2);
  assert.notEqual(changed[0], changed[1]);
  assert.equal(
    errors.filter((message) => message.includes("late.md")).length,
    1,
  );
  f.faux.setResponses([
    (context) => {
      assert.ok(
        getCurrentSystemPrompt(context.messages).includes(
          "CHANGED DURING PICKER",
        ),
      );
      return fauxAssistantMessage("ok");
    },
  ]);
  await f.session.prompt("check revalidation");
  const count = savedChoices(f.sm).length;
  const before = query(f);
  errors.length = 0;
  mockPicker(
    f,
    async () => {
      await writeFile(join(f.agentDir, "modes/A.md"), definition("invalid"));
      return "A";
    },
    notify,
  );
  await f.session.prompt("/mode");
  assert.deepEqual(query(f), before);
  assert.equal(savedChoices(f.sm).length, count);
  assert.equal(errors.length, 4);
  assert.equal(errors.filter((message) => message.includes("/A.md")).length, 1);
  assert.match(
    errors.find((message) => message.includes("/A.md"))!,
    /\/mode auto/,
  );
  errors.length = 0;
  mockPicker(f, async () => undefined, notify);
  await f.session.prompt("/mode");
  assert.equal(errors.length, 4);
  assert.equal(savedChoices(f.sm).length, count);
});
test("cancelled, invalid and unsaved choices leave selection and status unchanged", async (t) => {
  const f = await nativeFixture(t);
  const statuses = recordStatus(f);
  await f.session.prompt("/mode A");
  const before = query(f);
  const previousStatus = [...statuses];
  await writeFile(join(f.agentDir, "modes/bad.md"), definition("invalid"));
  for (const command of ["/mode", "/mode missing", "/mode bad"]) {
    await f.session.prompt(command);
    assert.deepEqual(query(f), before);
    assert.deepEqual([...statuses], previousStatus);
  }
  const append = t.mock.method(f.sm, "appendCustomEntry", () => {
    assert.deepEqual([...statuses], previousStatus);
    throw new Error("disk full");
  });
  await f.session.prompt("/mode B");
  assert.deepEqual(query(f), before);
  assert.deepEqual([...statuses], previousStatus);
  assert.deepEqual(
    savedChoices(f.sm).map((entry) => entry.data),
    [{ id: "A" }],
  );
  append.mock.restore();
});

test("a mode-file read may overlap leaf advancement without discarding selection", async (t) => {
  const f = await nativeFixture(t);
  const { entered, release } = holdModeRead(t, "B");
  const reading = f.session.prompt("/mode B");
  await entered.promise;
  f.sm.appendCustomEntry("leaf advanced during read");
  release.resolve();
  await reading;
  assert.equal(query(f)?.id, "B");
});
test("session shutdown invalidates an outstanding picker", async (t) => {
  const f = await nativeFixture(t);
  await f.session.prompt("/mode B");
  const entered = deferred(),
    choice = deferred<string>();
  mockPicker(f, async () => {
    entered.resolve();
    return choice.promise;
  });
  const picking = f.session.prompt("/mode");
  await entered.promise;
  const before = savedChoices(f.sm).length;
  await f.session.extensionRunner.emit({
    type: "session_shutdown",
    reason: "new",
  });
  choice.resolve("A");
  await picking;
  assert.equal(savedChoices(f.sm).length, before);
});
test("native tree and persisted session restoration use only the active branch", async (t) => {
  const f = await nativeFixture(t, [], true);
  const statuses = recordStatus(f);
  const snapshot = () => {
    const value = query(f);
    assert.equal(statuses.get("pi-modal"), `mode: ${value?.id}`);
    return value;
  };
  const root = f.sm.appendCustomEntry("root");
  await f.session.prompt("/mode A");
  const a = f.sm.getLeafId()!;
  await f.session.navigateTree(root, { summarize: false });
  assert.equal(snapshot()?.id, "auto");
  await f.session.prompt("/mode B");
  const b = f.sm.getLeafId()!;
  await f.session.navigateTree(a, { summarize: false });
  assert.equal(snapshot()?.id, "A");
  await f.session.navigateTree(b, { summarize: false });
  assert.equal(snapshot()?.id, "B");
  await f.session.prompt("/mode auto");
  const explicitAuto = f.sm.getLeafId()!;
  await f.session.navigateTree(a, { summarize: false });
  await f.session.navigateTree(explicitAuto, { summarize: false });
  assert.equal(snapshot()?.id, "auto");
  await f.session.prompt("/mode B");
  f.faux.setResponses([fauxAssistantMessage("persist")]);
  await f.session.prompt("persist native session");
  const sessionFile = f.sm.getSessionFile()!;
  const cloneFile = f.sm.createBranchedSession(f.sm.getLeafId()!)!;
  const managers = [
    SessionManager.open(sessionFile),
    SessionManager.forkFrom(sessionFile, f.cwd, join(f.dir, "forks")),
    SessionManager.open(cloneFile),
  ];
  for (const [i, manager] of managers.entries()) {
    const opened = await f.open(manager, i === 0 ? "resume" : "fork");
    assert.equal(query(opened)?.id, "B");
    const restoredStatus = recordStatus(opened);
    await opened.session.extensionRunner.emit({
      type: "session_start",
      reason: i === 0 ? "resume" : "fork",
    });
    assert.equal(restoredStatus.get("pi-modal"), "mode: B");
    opened.session.dispose();
  }
  for (const entry of savedChoices(f.sm))
    assert.deepEqual(Object.keys(entry.data as object), ["id"]);
});
test("reload reads current body and native compaction retains the selected id", async (t) => {
  const f = await nativeFixture(t);
  await f.session.prompt("/mode B");
  await writeFile(
    join(f.agentDir, "modes", "B.md"),
    definition("Append", "RELOADED"),
  );
  await f.session.reload();
  assert.equal(query(f)?.id, "B");
  f.faux.setResponses([
    (context) => {
      assert.ok(
        getCurrentSystemPrompt(context.messages).includes("GLOBAL\n\nRELOADED"),
      );
      assert.equal(
        getCurrentSystemPrompt(context.messages).includes("GLOBAL\n\nB"),
        false,
      );
      return fauxAssistantMessage("ok");
    },
  ]);
  await f.session.prompt("after reload");
  const firstMessage = f.sm
    .getBranch()
    .find((entry) => entry.type === "message")!;
  f.sm.appendCompaction("native summary", firstMessage.id, 100);
  await f.session.reload();
  assert.equal(query(f)?.id, "B");
});

test("native append precedes publication; an exception preserves selection and reports recovery", async (t) => {
  const errors = captureConsole(t, "error");
  const f = await nativeFixture(t);
  await f.session.prompt("/mode A");
  const before = query(f);
  const original = f.sm.appendCustomEntry.bind(f.sm);
  let fail = true;
  const append = t.mock.method(
    f.sm,
    "appendCustomEntry",
    (type: string, data: unknown) => {
      assert.deepEqual(query(f), before);
      if (fail) throw new Error("disk full");
      return original(type, data);
    },
  );
  await f.session.prompt("/mode B");
  assert.deepEqual(query(f), before);
  assert.deepEqual(
    savedChoices(f.sm).map((entry) => entry.data),
    [{ id: "A" }],
  );
  assert.match(
    errors.at(-1) ?? "",
    /disk full.*Previous selection retained; retry \/mode B/,
  );
  fail = false;
  await f.session.prompt("/mode B");
  assert.equal(query(f)?.id, "B");
  append.mock.restore();
  assert.equal(f.sm.getSessionFile(), undefined);
});
test("direct invalid selection and restoration report one actionable failure per invocation", async (t) => {
  const errors = captureConsole(t, "error");
  const f = await nativeFixture(t);
  await writeFile(join(f.agentDir, "modes/A.md"), definition("invalid"));
  const before = query(f);
  await f.session.prompt("/mode A");
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Invalid mode.*\/A.md.*\/mode auto/);
  assert.deepEqual(query(f), before);
  assert.equal(savedChoices(f.sm).length, 0);
  errors.length = 0;
  await f.session.prompt("/mode nosuch");
  assert.equal(errors.length, 2);
  assert.match(errors[0], /\/A\.md/);
  assert.match(errors[1], /Unknown mode: nosuch.*Use \/mode/);
  assert.deepEqual(query(f), before);
  assert.equal(savedChoices(f.sm).length, 0);
  f.sm.appendCustomEntry("pi-modal:mode", { id: "A" });
  for (let invocation = 0; invocation < 2; invocation++) {
    errors.length = 0;
    await f.session.reload();
    assert.equal(errors.length, 1);
    const snapshot = query(f);
    assert.ok(snapshot && !snapshot.ready);
    assert.equal(snapshot.id, "A");
    assert.equal(snapshot.reason, errors[0]);
  }
});
test("malformed saved ids cannot become a ready placeholder or implicit auto", async (t) => {
  captureConsole(t, "error");
  const f = await nativeFixture(t);
  const statuses = recordStatus(f);
  await writeFile(
    join(f.agentDir, "modes/(invalid saved mode).md"),
    definition("None"),
  );
  for (const data of [
    null,
    {},
    Object.assign([], { id: "A" }),
    { id: 42 },
    { id: "" },
    { id: "../A" },
  ]) {
    f.sm.appendCustomEntry("pi-modal:mode", data);
    await f.session.extensionRunner.emit({
      type: "session_start",
      reason: "reload",
    });
    assert.equal(query(f)?.ready, false);
    assert.equal(query(f)?.id, "(invalid saved mode)");
    assert.ok(query(f)?.reason);
  }
  assert.equal(
    statuses.get("pi-modal"),
    "mode: (invalid saved mode) (unavailable)",
  );
  await f.session.prompt("/mode auto");
  assert.deepEqual(query(f), {
    sessionId: f.sm.getSessionId(),
    id: "auto",
    ready: true,
  });
  assert.deepEqual(savedChoices(f.sm).at(-1)?.data, { id: "auto" });
  assert.equal(statuses.get("pi-modal"), "mode: auto");
});
test("an unavailable saved definition consumes input, terminates tools, and requires recovery", async (t) => {
  const errors = captureConsole(t, "error");
  const f = await nativeFixture(t);
  const path = join(f.agentDir, "modes/A.md");
  await writeFile(path, definition("ReplaceProject", "CACHED BODY"));
  await f.session.prompt("/mode A");
  await rm(path);
  await f.session.reload();
  assert.equal(query(f)?.id, "A");
  assert.equal(query(f)?.ready, false);
  assert.match(query(f)?.reason ?? "", /\/mode auto/);
  const calls = f.faux.state.callCount;
  await f.session.prompt("ordinary input");
  assert.equal(f.faux.state.callCount, calls);
  f.faux.setResponses([
    (context) => {
      const prompt = getCurrentSystemPrompt(context.messages);
      assert.ok(prompt.includes("ANCESTOR"));
      assert.equal(prompt.includes("CACHED BODY"), false);
      return fauxAssistantMessage(
        fauxToolCall("read", { path: join(f.cwd, "CLAUDE.md") }),
        { stopReason: "toolUse" },
      );
    },
  ]);
  await f.session.sendCustomMessage(
    { customType: "bypass-input", content: "extension work", display: false },
    { triggerTurn: true },
  );
  assert.equal(
    f.faux.state.callCount,
    calls + 1,
    "tool block terminates rather than looping",
  );
  const last = f.session.messages.at(-1);
  assert.ok(last?.role === "toolResult" && last.isError);
  assert.match(JSON.stringify(last.content), /\/mode auto/);
  assert.ok(
    errors.some((message) => message.includes("Saved mode A is missing")),
  );
  await f.session.prompt("/mode auto");
  f.faux.setResponses([fauxAssistantMessage("recovered")]);
  await f.session.prompt("ordinary input works again");
  assert.equal(f.session.getLastAssistantText(), "recovered");
});
test("projection failure publishes unavailable status and retains actionable reporting", async (t) => {
  const f = await nativeFixture(t, [
    (pi) => {
      pi.on("before_agent_start", (event) => {
        event.systemPromptOptions.forceSystemPrompt = "OPAQUE";
      });
    },
  ]);
  const errors: string[] = [];
  const statuses = recordStatus(f, undefined, (message, type) => {
    if (type === "error") errors.push(message);
  });
  await f.session.prompt("/mode B");
  assert.equal(statuses.get("pi-modal"), "mode: B");
  f.faux.setResponses([fauxAssistantMessage("ok")]);
  await f.session.prompt("check projection");
  assert.equal(query(f)?.ready, false);
  assert.equal(query(f)?.id, "B");
  assert.equal(statuses.get("pi-modal"), "mode: B (unavailable)");
  assert.match(errors.at(-1) ?? "", /Cannot apply mode.*\/mode auto/);
});

test("shutdown prevents a pending restoration from republishing status", async (t) => {
  const f = await nativeFixture(t);
  const statuses = recordStatus(f);
  await f.session.prompt("/mode A");
  const { entered, release } = holdModeRead(t, "A");
  const restoring = f.session.extensionRunner.emit({
    type: "session_start",
    reason: "reload",
  });
  await entered.promise;
  assert.equal(statuses.get("pi-modal"), "mode: A (unavailable)");
  await f.session.extensionRunner.emit({ type: "session_shutdown", reason: "new" });
  assert.equal(statuses.get("pi-modal"), undefined);
  release.resolve();
  await restoring;
  assert.equal(statuses.get("pi-modal"), undefined);
  assert.equal(query(f), undefined);
});

test("restoration clears stale ready text before I/O and cannot overwrite a newer accepted choice", async (t) => {
  const f = await nativeFixture(t);
  const statuses = recordStatus(f);
  await f.session.prompt("/mode A");
  const { entered, release } = holdModeRead(t, "A");
  const restoring = f.session.extensionRunner.emit({
    type: "session_tree",
    oldLeafId: null,
    newLeafId: f.sm.getLeafId(),
    fromExtension: false,
  });
  await entered.promise;
  assert.equal(query(f)?.ready, false);
  assert.equal(statuses.get("pi-modal"), "mode: A (unavailable)");
  await f.session.prompt("/mode auto");
  assert.equal(statuses.get("pi-modal"), "mode: auto");
  release.resolve();
  await restoring;
  assert.equal(statuses.get("pi-modal"), "mode: auto");
  assert.deepEqual(query(f), {
    sessionId: f.sm.getSessionId(),
    id: "auto",
    ready: true,
  });
});
