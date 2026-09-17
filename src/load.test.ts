import { test } from "node:test";
import assert from "node:assert/strict";
import { archivePath, DEFAULT_HANDOFF_PATH, loadCommand, staleRefusal, type LoadDeps } from "./load.ts";

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

test("an integer prefix does not arm a doc with invalid frontmatter", () => {
  const d = deps({ "h.md": { frontmatter: { clearthen: { context_limit: 120000 }, hop: "two" }, body: "body" } });
  const out = loadCommand("100000 h.md", CWD, WINDOW, d);
  assert.equal(out?.arm, null);
  assert.equal(out?.prompt, "body");
  assert.ok(out?.warnings.some((w) => w.includes("mode not armed")));
  assert.ok(out?.warnings.some((w) => w.includes("boundary 100000 ignored")));
});

test("an integer prefix does not arm a doc whose frontmatter fails to parse", () => {
  const d = deps({ "h.md": { body: "---\nbad: [\n---\nbody", throws: true } });
  const out = loadCommand("100000 h.md", CWD, WINDOW, d);
  assert.equal(out?.arm, null);
  assert.ok(out?.warnings.some((w) => w.includes("could not parse frontmatter")));
  assert.ok(out?.warnings.some((w) => w.includes("boundary 100000 ignored")));
});

test("an integer prefix overrides a valid doc's context_limit", () => {
  const d = deps({ "h.md": { frontmatter: { clearthen: { context_limit: 120000, turn_budget: 2 }, hop: 3 }, body: "body" } });
  const out = loadCommand("90000 h.md", CWD, WINDOW, d);
  assert.equal(out?.arm?.contextLimit, 90000);
  assert.equal(out?.arm?.turnBudget, 2);
  assert.equal(out?.arm?.hop, 3);
});

test("the prompt form reports a stale doc when the default handoff doc exists", () => {
  const d = deps({ [DEFAULT_HANDOFF_PATH]: { frontmatter: { clearthen: { context_limit: 120000 }, hop: 1 }, body: "## Goal" } });
  const out = loadCommand("150000 build X", CWD, WINDOW, d);
  assert.equal(out?.prompt, "build X");
  assert.equal(out?.arm?.contextLimit, 150000);
  assert.equal(out?.arm?.hop, 0);
  assert.deepEqual(out?.stale, {
    resumeArgs: `150000 ${DEFAULT_HANDOFF_PATH}`,
    newArgs: "--new 150000 <prompt>",
    fresh: false,
  });
  assert.ok(staleRefusal(out!.stale!).includes(`/clearthen 150000 ${DEFAULT_HANDOFF_PATH}`));
  assert.ok(staleRefusal(out!.stale!).includes("/clearthen --new 150000"));
});

test("--new marks the stale doc for archiving", () => {
  const d = deps({ [DEFAULT_HANDOFF_PATH]: { body: "## Goal" } });
  const out = loadCommand("--new 150000 build X", CWD, WINDOW, d);
  assert.equal(out?.prompt, "build X");
  assert.equal(out?.stale?.fresh, true);
});

test("--new without a stale doc arms as usual", () => {
  const out = loadCommand("--new 150000 build X", CWD, WINDOW, deps({}));
  assert.equal(out?.stale, undefined);
  assert.equal(out?.arm?.contextLimit, 150000);
});

test("the archive path carries a timestamp next to the default doc", () => {
  assert.equal(archivePath(new Date("2026-09-17T14:05:09.123Z")), "docs/clearthen-handoff-20260917-140509.md");
});

test("the path form is exempt from the existing-doc refusal", () => {
  const d = deps({ [DEFAULT_HANDOFF_PATH]: { frontmatter: { clearthen: { context_limit: 120000 }, hop: 1 }, body: "## Goal" } });
  const out = loadCommand(`150000 ${DEFAULT_HANDOFF_PATH}`, CWD, WINDOW, d);
  assert.equal(out?.stale, undefined);
  assert.equal(out?.arm?.contextLimit, 150000);
  assert.equal(out?.arm?.hop, 1);
});

test("a plain prompt without a boundary does not arm and is not refused", () => {
  const d = deps({ [DEFAULT_HANDOFF_PATH]: { body: "x" } });
  const out = loadCommand("build X", CWD, WINDOW, d);
  assert.equal(out?.arm, null);
  assert.equal(out?.stale, undefined);
});

test("a prefix boundary at or above the context window warns and does not arm", () => {
  const out = loadCommand(`${WINDOW} build X`, CWD, WINDOW, deps({}));
  assert.equal(out?.arm, null);
  assert.equal(out?.prompt, "build X");
  assert.ok(out?.warnings.some((w) => w.includes("must be below the model's context window")));
});

test("empty arguments return null", () => {
  assert.equal(loadCommand("   ", CWD, WINDOW, deps({})), null);
});
