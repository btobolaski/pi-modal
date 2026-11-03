import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  getAgentDir,
  SessionManager,
  type ContextWithSystemEvent,
  type NormalizedBuildSystemPromptOptions,
} from "@earendil-works/pi-coding-agent";
import {
  fauxAssistantMessage,
  getCurrentSystemMessage,
  getCurrentSystemPrompt,
} from "@earendil-works/pi-ai";
import {
  operations,
  projectMessages,
  transformGroups,
  type Operation,
} from "./index.ts";
import { captureConsole, nativeFixture, query } from "./test-helpers.ts";

type Messages = ContextWithSystemEvent["messages"];
const block = (path: string, content: string) =>
  `<project_instructions path="${path}">\n${content}\n</project_instructions>`;
const wrap = (content: string) =>
  `<project_context>\nProject-specific instructions and guidelines:\n\n${content}\n</project_context>`;
const mode = (operation: Operation, body = "MODE") => ({
  id: "check",
  operation,
  body,
});

test("all six operations preserve source paths and concatenate only nonempty parts", () => {
  const files = [
    { path: "/agent/CLAUDE.md", content: "G1" },
    { path: "/agent/second.md", content: "G2" },
    { path: "/ancestor/CLAUDE.md", content: "P1" },
    { path: "/project/AGENTS.override.md", content: "P2" },
  ];
  const apply = (operation: Operation, input = files, body = "MODE") =>
    transformGroups(input, mode(operation, body), "/agent");
  const expected = {
    None: ["G1", "G2", "P1", "P2"],
    ReplaceGlobal: ["MODE", "P1", "P2"],
    ReplaceProject: ["G1", "G2", "MODE"],
    ReplaceBoth: ["MODE"],
    Prepend: ["MODE\n\nG1", "G2", "P1", "P2"],
    Append: ["G1", "G2\n\nMODE", "P1", "P2"],
  };
  const before = structuredClone(files);
  for (const operation of operations) {
    assert.deepEqual(
      apply(operation).map((f) => f.content),
      expected[operation],
    );
  }
  assert.deepEqual(files, before);
  assert.equal(apply("None"), files);
  assert.equal(apply("ReplaceProject")[2].path, files[2].path);
  for (const operation of ["ReplaceGlobal", "ReplaceBoth"] as const)
    assert.equal(apply(operation)[0].path, files[0].path);
  for (const operation of ["Prepend", "Append"] as const) {
    assert.equal(
      apply(operation, [{ ...files[0], content: "" }])[0].content,
      "MODE",
    );
    assert.deepEqual(apply(operation, files, ""), files);
    assert.deepEqual(apply(operation, []), [
      { path: "pi-modal:global", content: "MODE" },
    ]);
  }
  assert.deepEqual(apply("ReplaceBoth", [], ""), [
    { path: "pi-modal:global", content: "" },
  ]);
  assert.deepEqual(apply("ReplaceBoth", files, ""), [
    { ...files[0], content: "" },
  ]);
  assert.deepEqual(apply("ReplaceGlobal", files.slice(2)), [
    { path: "pi-modal:global", content: "MODE" },
    ...files.slice(2),
  ]);
  assert.deepEqual(apply("ReplaceProject", files.slice(0, 2)), [
    ...files.slice(0, 2),
    { path: "pi-modal:project", content: "MODE" },
  ]);
});

test("source-directory grouping honors configured/default directories and instruction aliases", () => {
  for (const agentDir of [getAgentDir(), "/custom-agent"]) {
    const global = ["AGENTS.md", "CLAUDE.md", "AGENTS.override.md"].map(
      (name) => ({ path: `${agentDir}/nested/../${name}`, content: name }),
    );
    const project = { path: "/ancestor/project/AGENTS.md", content: "PROJECT" };
    assert.deepEqual(
      transformGroups([...global, project], mode("ReplaceGlobal"), agentDir),
      [{ ...global[0], content: "MODE" }, project],
    );
  }
});

test("native outgoing requests project A to B to auto without changing source or history", async (t) => {
  const f = await nativeFixture(t);
  const seen: string[] = [];
  f.faux.setResponses(
    [0, 1, 2, 3].map(() => (context) => {
      seen.push(getCurrentSystemPrompt(context.messages));
      return fauxAssistantMessage("ok");
    }),
  );
  for (const id of ["A", "B", "auto", "none"]) {
    await f.session.prompt(`/mode ${id}`);
    await f.session.prompt("check");
  }
  const globalBlock = `<project_instructions path="${join(f.agentDir, "CLAUDE.md")}">\nGLOBAL\n</project_instructions>`;
  assert.ok(seen[0].includes(globalBlock));
  assert.equal(seen[0].includes("ANCESTOR"), false);
  assert.equal(seen[0].includes("PROJECT"), false);
  assert.ok(
    seen[0].includes(
      `<project_instructions path="${join(f.dir, "AGENTS.md")}">\nA\n</project_instructions>`,
    ),
  );
  assert.ok(seen[1].includes("GLOBAL\n\nB\n</project_instructions>"));
  assert.ok(seen[1].includes("ANCESTOR"));
  assert.ok(seen[1].includes("PROJECT"));
  assert.equal(seen[2], seen[3]);
  assert.equal(getCurrentSystemPrompt(f.session.messages), seen[2]);
  assert.equal(await readFile(join(f.agentDir, "CLAUDE.md"), "utf8"), "GLOBAL");
  assert.equal(await readFile(join(f.cwd, "CLAUDE.md"), "utf8"), "PROJECT");
});
test("cwd equal to agentDir loads global context once and ReplaceBoth stays request-local", async (t) => {
  const f = await nativeFixture(t);
  const same = await f.open(
    SessionManager.inMemory(f.agentDir),
    "startup",
    f.agentDir,
  );
  let initial: ReturnType<typeof getCurrentSystemMessage>;
  f.faux.setResponses([
    (context) => {
      initial = getCurrentSystemMessage(context.messages);
      assert.equal(
        getCurrentSystemPrompt(context.messages).split(
          block(join(f.agentDir, "CLAUDE.md"), "GLOBAL"),
        ).length - 1,
        1,
      );
      return fauxAssistantMessage("baseline");
    },
    (context) => {
      const actual = getCurrentSystemMessage(context.messages)!;
      assert.ok(initial);
      assert.deepEqual(actual, {
        ...initial,
        sections: {
          ...initial.sections,
          project_context: actual.sections!.project_context,
        },
      });
      const section = actual.sections!.project_context!;
      assert.equal(section.split("\nstatus\n").length - 1, 1);
      assert.doesNotMatch(section, /GLOBAL|ANCESTOR/);
      return fauxAssistantMessage("projected");
    },
  ]);
  await same.session.prompt("baseline");
  await same.session.prompt("/mode status");
  await same.session.prompt("project both groups");
  assert.deepEqual(query(same), {
    sessionId: same.sm.getSessionId(),
    id: "status",
    ready: true,
  });
  assert.equal(await readFile(join(f.agentDir, "CLAUDE.md"), "utf8"), "GLOBAL");
  assert.equal(await readFile(join(f.dir, "AGENTS.md"), "utf8"), "ANCESTOR");
});
function baseline() {
  const files = [
    { path: "/agent/CLAUDE.md", content: "G\n" },
    { path: "/project/AGENTS.md", content: "P" },
  ];
  const blocks = files.map((f) => block(f.path, f.content));
  const section = wrap(`EARLIER EDIT\n${blocks.join("\n\n")}\nUNRELATED`);
  // SAFETY: the projector reads only contextFiles/forceSystemPrompt from normalized inputs.
  const options = { contextFiles: files } as NormalizedBuildSystemPromptOptions;
  const messages: Messages = [
    {
      role: "system",
      content: "BASE",
      sections: { project_context: "OLD", skills: "SKILLS" },
      toolsAdded: [
        { name: "old", description: "old", parameters: { type: "object" } },
      ],
      timestamp: 1,
    },
    { role: "user", content: "hello", timestamp: 2 },
    {
      role: "system",
      content: "EXTENSION",
      sections: { project_context: section, extra: "EXTRA" },
      toolsRemoved: [{ name: "old" }],
      toolsAdded: [
        { name: "new", description: "new", parameters: { type: "object" } },
      ],
      timestamp: 3,
    },
    {
      role: "system",
      content: "UNRELATED",
      sections: { other: "X" },
      timestamp: 4,
    },
  ];
  const withSection = (current: string): Messages =>
    messages.map((m, i) =>
      i === 2 && m.role === "system"
        ? { ...m, sections: { ...m.sections, project_context: current } }
        : m,
    );
  return { files, blocks, section, options, messages, withSection };
}
test("request projection preserves unrelated sections, source input, content and tool deltas", () => {
  const f = baseline(),
    before = structuredClone(f.messages);
  const result = projectMessages(
    f.messages,
    f.options,
    mode("ReplaceProject"),
    "/agent",
  );
  assert.deepEqual(f.messages, before);
  const expected = structuredClone(getCurrentSystemMessage(f.messages)!);
  expected.sections!.project_context = f.section.replace(
    f.blocks[1],
    block(f.files[1].path, "MODE"),
  );
  assert.deepEqual(
    getCurrentSystemMessage(result),
    expected,
    "only project_context may change, including during tool replay",
  );
  assert.deepEqual(result[1], f.messages[1]);
  assert.deepEqual(result[3], f.messages[3]);
  assert.equal(
    projectMessages(f.messages, undefined, mode("None")),
    f.messages,
  );
});
test("incompatible projection baselines fail atomically at their named guard", () => {
  const f = baseline(),
    before = structuredClone(f.messages);
  const overlap = [{ ...f.files[0], content: f.blocks[1] }, f.files[1]];
  const reject = (
    error: RegExp,
    messages = f.messages,
    options = f.options,
  ) => {
    const before = structuredClone(messages);
    assert.throws(
      () => projectMessages(messages, options, mode("ReplaceGlobal"), "/agent"),
      error,
    );
    assert.deepEqual(messages, before, error.source);
  };
  reject(/wrapper/, f.withSection("opaque"));
  reject(
    /source block/,
    f.withSection(f.section.replace(f.blocks[1], "edited source")),
  );
  reject(
    /ambiguous source block/,
    f.withSection(f.section.replace(f.blocks[1], f.blocks[1] + f.blocks[1])),
  );
  assert.throws(
    () => projectMessages(f.messages, undefined, mode("ReplaceGlobal")),
    /Structured prompt inputs/,
  );
  reject(/opaque forced prompt/, f.messages, {
    ...f.options,
    forceSystemPrompt: "OPAQUE",
  });
  reject(/Missing leading/, [f.messages[1]]);
  reject(/Missing project_context/, [
    { role: "system", content: "BASE", timestamp: 0 },
  ]);
  reject(
    /Overlapping/,
    f.withSection(wrap(block(overlap[0].path, overlap[0].content))),
    { ...f.options, contextFiles: overlap },
  );
  reject(/duplicate/, f.messages, {
    ...f.options,
    contextFiles: [f.files[0], f.files[0]],
  });
  reject(/Ambiguous projected/, f.messages, {
    ...f.options,
    contextFiles: [{ path: "pi-modal:global", content: "OTHER" }],
  });
  assert.deepEqual(f.messages, before);
});
test("synthetic projection preserves earlier edits and supports an absent context section", () => {
  const f = baseline(),
    options = { ...f.options, contextFiles: [] };
  for (const operation of ["ReplaceGlobal", "ReplaceProject"] as const) {
    const result = getCurrentSystemPrompt(
      projectMessages(f.messages, options, mode(operation, "M")),
    );
    assert.ok(result.includes("EARLIER EDIT"));
    assert.ok(
      result.includes(
        block(
          `pi-modal:${operation === "ReplaceProject" ? "project" : "global"}`,
          "M",
        ),
      ),
    );
    assert.ok(result.includes("guidelines:\n\n"));
  }
  const messages: Messages = [
    { role: "system", content: "BASE", timestamp: 0 },
  ];
  assert.ok(
    getCurrentSystemPrompt(
      projectMessages(messages, options, mode("ReplaceBoth", "M")),
    ).includes(wrap(block("pi-modal:global", "M"))),
  );
});
test("native forced prompts expose an actionable projection failure, not silent success", async (t) => {
  const errors = captureConsole(t, "error");
  const f = await nativeFixture(t, [
    (pi) => {
      pi.on("before_agent_start", (event) => {
        event.systemPromptOptions.forceSystemPrompt = "OPAQUE";
      });
    },
  ]);
  f.faux.setResponses([
    (context) => {
      assert.equal(getCurrentSystemPrompt(context.messages), "OPAQUE");
      return fauxAssistantMessage("ok");
    },
  ]);
  await f.session.prompt("/mode B");
  await f.session.prompt("check");
  assert.ok(
    errors.some(
      (message) =>
        message.includes("Cannot apply mode") && message.includes("/mode auto"),
    ),
  );
});
