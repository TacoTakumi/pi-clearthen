import { test } from "node:test";
import assert from "node:assert/strict";
import { interpretConfig, exceedsHeadroom } from "./config.ts";

const WINDOW = 200000;
const RESERVE = 16384;

test("valid block with explicit values", () => {
  assert.deepEqual(
    interpretConfig({ clearthen: { context_limit: 150000, turn_budget: 5 }, hop: 2 }, WINDOW, RESERVE),
    { ok: true, config: { contextLimit: 150000, turnBudget: 5, hop: 2 }, headroomWarning: false },
  );
});

test("defaults apply for turn_budget and hop", () => {
  assert.deepEqual(interpretConfig({ clearthen: { context_limit: 150000 } }, WINDOW, RESERVE), {
    ok: true,
    config: { contextLimit: 150000, turnBudget: 3, hop: 0 },
    headroomWarning: false,
  });
});

test("missing clearthen block is ok and does not arm", () => {
  assert.deepEqual(interpretConfig({ title: "notes" }, WINDOW, RESERVE), {
    ok: true,
    config: { contextLimit: null, turnBudget: 3, hop: 0 },
    headroomWarning: false,
  });
  assert.deepEqual(interpretConfig(undefined, WINDOW, RESERVE), {
    ok: true,
    config: { contextLimit: null, turnBudget: 3, hop: 0 },
    headroomWarning: false,
  });
});

test("block without context_limit does not arm but keeps turn_budget", () => {
  assert.deepEqual(interpretConfig({ clearthen: { turn_budget: 2 } }, WINDOW, RESERVE), {
    ok: true,
    config: { contextLimit: null, turnBudget: 2, hop: 0 },
    headroomWarning: false,
  });
});

test("non-integer context_limit is an error", () => {
  const r = interpretConfig({ clearthen: { context_limit: "abc" } }, WINDOW, RESERVE);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /context_limit/);
  assert.equal(interpretConfig({ clearthen: { context_limit: 1.5 } }, WINDOW, RESERVE).ok, false);
});

test("non-positive context_limit is an error", () => {
  assert.equal(interpretConfig({ clearthen: { context_limit: 0 } }, WINDOW, RESERVE).ok, false);
  assert.equal(interpretConfig({ clearthen: { context_limit: -1 } }, WINDOW, RESERVE).ok, false);
});

test("context_limit at or above the context window is an error", () => {
  const r = interpretConfig({ clearthen: { context_limit: WINDOW } }, WINDOW, RESERVE);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /context window/);
  assert.equal(interpretConfig({ clearthen: { context_limit: WINDOW + 1 } }, WINDOW, RESERVE).ok, false);
});

test("invalid turn_budget and hop are errors", () => {
  assert.equal(interpretConfig({ clearthen: { context_limit: 1000, turn_budget: 0 } }, WINDOW, RESERVE).ok, false);
  assert.equal(interpretConfig({ clearthen: { context_limit: 1000, turn_budget: "x" } }, WINDOW, RESERVE).ok, false);
  assert.equal(interpretConfig({ clearthen: { context_limit: 1000 }, hop: -1 }, WINDOW, RESERVE).ok, false);
  assert.equal(interpretConfig({ clearthen: { context_limit: 1000 }, hop: "two" }, WINDOW, RESERVE).ok, false);
});

test("non-map clearthen value is an error", () => {
  assert.equal(interpretConfig({ clearthen: "yes" }, WINDOW, RESERVE).ok, false);
});

test("numeric strings from frontmatter are accepted", () => {
  const r = interpretConfig({ clearthen: { context_limit: "150000" }, hop: "2" }, WINDOW, RESERVE);
  assert.deepEqual(r, {
    ok: true,
    config: { contextLimit: 150000, turnBudget: 3, hop: 2 },
    headroomWarning: false,
  });
});

test("headroom warning fires when the limit is inside the compaction reserve", () => {
  const r = interpretConfig({ clearthen: { context_limit: 190000 } }, WINDOW, RESERVE);
  assert.equal(r.ok, true);
  assert.equal((r as { headroomWarning: boolean }).headroomWarning, true);
});

test("headroom warning does not fire with room to spare", () => {
  const r = interpretConfig({ clearthen: { context_limit: 150000 } }, WINDOW, RESERVE);
  assert.equal((r as { headroomWarning: boolean }).headroomWarning, false);
  assert.equal(exceedsHeadroom(WINDOW - RESERVE, WINDOW, RESERVE), false);
  assert.equal(exceedsHeadroom(WINDOW - RESERVE + 1, WINDOW, RESERVE), true);
});
