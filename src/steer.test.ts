import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSteer, SECTION_NAMES } from "./steer.ts";

const base = {
  path: "docs/x/handoff.md",
  contextLimit: 150000,
  turnBudget: 3,
  hop: 2,
  goalPrompt: "build the login flow\nwith tests",
  firstHop: false,
};

test("steer names the path, frontmatter values, incremented hop and the command", () => {
  const text = buildSteer(base);
  assert.match(text, /docs\/x\/handoff\.md/);
  assert.match(text, /context_limit: 150000/);
  assert.match(text, /turn_budget: 3/);
  assert.match(text, /hop: 3/);
  assert.ok(text.includes("/clearthen docs/x/handoff.md"));
});

test("a doc without hop instructs hop 1", () => {
  assert.match(buildSteer({ ...base, hop: 0 }), /hop: 1/);
});

test("steer names all five sections", () => {
  const text = buildSteer(base);
  for (const name of SECTION_NAMES) assert.ok(text.includes(name), `missing section ${name}`);
});

test("first hop carries the goal verbatim and the obey/stop standing instructions", () => {
  const text = buildSteer({ ...base, firstHop: true, path: "docs/clearthen-handoff.md" });
  assert.ok(text.includes("build the login flow"));
  assert.ok(text.includes("with tests"));
  assert.match(text, /obey it immediately/);
  assert.match(text, /stop and do not run \/clearthen again/);
  assert.ok(text.includes("/clearthen docs/clearthen-handoff.md"));
  assert.doesNotMatch(text, /Do not change this section/);
});

test("later hop says do not change the fixed sections and omits the goal", () => {
  const text = buildSteer(base);
  assert.match(text, /Goal - already present\. Do not change this section\./);
  assert.match(text, /Standing instructions - already present\. Do not change this section\./);
  assert.ok(!text.includes("build the login flow"));
  assert.ok(!text.includes("Original brief"));
});

import { buildPreamble } from "./steer.ts";

test("preamble names the boundary, the doc path, the steer and the command", () => {
  const text = buildPreamble({ path: "docs/x/handoff.md", contextLimit: 40000, turnBudget: 3 });
  assert.match(text, /40000 tokens/);
  assert.ok(text.includes("docs/x/handoff.md"));
  assert.match(text, /handoff steer/);
  assert.ok(text.includes("/clearthen docs/x/handoff.md"));
  assert.match(text, /3 turns/);
  assert.match(text, /Do not run \/clearthen again/);
});
