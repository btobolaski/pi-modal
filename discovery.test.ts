import assert from "node:assert/strict";
import fs, {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { discoverModes, operations } from "./index.ts";
import { definition } from "./test-helpers.ts";
test("directory-read errors keep auto and use the documented directory diagnostic key", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-modal-unreadable-"));
  const directory = join(dir, "modes");
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(directory);
  t.mock.method(fs, "readdir", async () => {
    throw Object.assign(new Error("EACCES: permission denied, scandir"), {
      code: "EACCES",
    });
  });
  const { modes, errors } = await discoverModes(dir);
  assert.deepEqual([...modes.keys()], ["auto"]);
  assert.deepEqual([...errors.keys()], [directory]);
  assert.match(errors.get(directory)!, /EACCES/);
});
test("discovery validates definitions, honors Pi agent dir, and never resolves input as a path", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-modal-modes-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  assert.deepEqual([...(await discoverModes(dir)).modes.keys()], ["auto"]);
  await mkdir(join(dir, "modes"));
  for (const operation of operations) {
    await writeFile(
      join(dir, "modes", `${operation}.md`),
      definition(operation),
    );
  }
  const invalid = [
    "no frontmatter",
    "---\nreplace_mode: [\n---\nBODY",
    "---\n[]\n---",
    "---\nscalar\n---",
    definition("replaceglobal"),
  ];
  for (const [i, source] of invalid.entries())
    await writeFile(join(dir, "modes", `bad${i}.md`), source);
  await writeFile(join(dir, "modes", ".md"), definition("None"));
  await writeFile(join(dir, "modes", "bad\\name.md"), definition("None"));
  await writeFile(join(dir, "modes", "auto.md"), "---\nmalformed: [\n---");
  for (const id of ["review ", " review", "   ", "review", "review notes"])
    await writeFile(join(dir, "modes", `${id}.md`), definition("None", id));
  await writeFile(
    join(dir, "modes", "empty.md"),
    definition("ReplaceBoth", ""),
  );
  await writeFile(
    join(dir, "modes", "spaced.md"),
    "\uFEFF---\r\nreplace_mode: Append\r\nunused: true\r\n---\r\n  BODY  \r\n",
  );
  await writeFile(join(dir, "modes", "ignored.txt"), definition("None"));
  await mkdir(join(dir, "modes", "directory.md"));
  await symlink(join(dir, "modes", "Append.md"), join(dir, "modes", "link.md"));
  await symlink(join(dir, "missing"), join(dir, "modes", "broken.md"));
  const nonregular = join(dir, "modes", "nonregular.md");
  await symlink(join(dir, "modes", "directory.md"), nonregular);
  const unreadable = join(dir, "modes", "unreadable.md");
  await writeFile(unreadable, definition("None"));
  const read = fs.readFile;
  const reads = t.mock.method(
    fs,
    "readFile",
    async (...args: Parameters<typeof read>) => {
      if (String(args[0]) === unreadable)
        throw Object.assign(new Error("EACCES: permission denied, open"), {
          code: "EACCES",
        });
      return read(...args);
    },
  );
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  });
  const { modes, errors } = await discoverModes();
  assert.deepEqual(
    [...modes.keys()],
    [
      "auto",
      ...[...operations, "empty", "link"].sort(),
      "review notes",
      "review",
      "spaced",
    ],
  );
  for (const operation of operations)
    assert.deepEqual(modes.get(operation), {
      id: operation,
      operation,
      body: "MODE",
    });
  assert.equal(modes.get("empty")?.body, "");
  assert.equal(modes.get("spaced")?.body, "BODY");
  for (let i = 0; i < invalid.length; i++)
    assert.match(errors.get(`bad${i}`)!, /Invalid mode/);
  assert.match(errors.get("broken")!, /ENOENT/);
  assert.match(errors.get("nonregular")!, /regular file/);
  assert.equal(
    reads.mock.calls.some((call) => String(call.arguments[0]) === nonregular),
    false,
  );
  assert.match(errors.get("unreadable")!, /EACCES/);
  const readme = await readFile(
    new URL("./README.md", import.meta.url),
    "utf8",
  );
  const example = readme.match(/```markdown\n([\s\S]*?)\n```/)![1];
  assert.deepEqual(parseFrontmatter(example), {
    frontmatter: { replace_mode: "ReplaceProject" },
    body: "Review changes for correctness. Do not modify files.",
  });
  assert.match(errors.get("")!, /nonempty filename stem/);
  assert.match(errors.get("bad\\name")!, /not a path/);
  assert.equal(errors.has("auto"), false);
  for (const id of ["review ", " review", "   "])
    assert.match(errors.get(id)!, /surrounding whitespace/);
  for (const id of ["review", "review notes"])
    assert.equal(modes.get(id)?.body, id);
});
