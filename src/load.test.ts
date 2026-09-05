import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_HANDOFF_PATH, loadCommand, type LoadDeps } from "./load.ts";

const CWD = "/repo";
const WINDOW = 200000;

/** In-memory files; frontmatter is supplied as an object per path, so no YAML parser is needed. */
function deps(files: Record<string, { frontmatter?: unknown; body: string; throws?: boolean }>): LoadDeps {
  const byPath = (p: string) => files[p.replace(`${CWD}/`, "")];
  return {
    exists: (p) => byPath(p) !== undefined,
    readFile: (p) => {
      const f = byPath(p);
      if (!f) throw new Error(`ENOENT ${p}`);
      return f.body;
    },
    parseFrontmatter: (text) => {
      const f = Object.values(files).find((x) => x.body === text);
      if (f?.throws) throw new Error("bad yaml");
      return { frontmatter: f?.frontmatter ?? {}, body: text };
    },
  };
}

test("a plain brief loaded by path with an integer prefix is a first hop", () => {
  const d = deps({ "brief.md": { body: "Build X" } });
  const out = loadCommand("100000 brief.md", CWD, WINDOW, d);
  assert.ok(out?.arm);
  assert.equal(out.arm.firstHop, true);
  assert.equal(out.arm.path, "brief.md");
  assert.equal(out.arm.goalPrompt, "Build X");
  assert.equal(out.arm.hop, 0);
});

test("a rolling handoff doc with a clearthen block is a later hop", () => {
  const d = deps({ "h.md": { frontmatter: { clearthen: { context_limit: 120000 }, hop: 1 }, body: "## Goal\nBuild X" } });
  const out = loadCommand("h.md", CWD, WINDOW, d);
  assert.equal(out?.arm?.firstHop, false);
  assert.equal(out?.arm?.hop, 1);
  assert.equal(out?.arm?.contextLimit, 120000);
});

test("a doc with hop set but no clearthen block is still a later hop", () => {
  const d = deps({ "h.md": { frontmatter: { hop: 2 }, body: "body" } });
  const out = loadCommand("50000 h.md", CWD, WINDOW, d);
  assert.equal(out?.arm?.firstHop, false);
  assert.equal(out?.arm?.hop, 2);
});

test("the prompt form is always a first hop at the default path", () => {
  const out = loadCommand("150000 build X", CWD, WINDOW, deps({}));
  assert.equal(out?.arm?.firstHop, true);
  assert.equal(out?.arm?.path, DEFAULT_HANDOFF_PATH);
});
