import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "./args.ts";

const none = () => false;
const only = (present: string) => (path: string) => path === present;

test("plain prompt is sent as-is with no boundary", () => {
  assert.deepEqual(parseArgs("build the login flow", none), {
    kind: "prompt",
    prompt: "build the login flow",
  });
});

test("existing single .md token is a path", () => {
  assert.deepEqual(parseArgs("docs/handoff.md", only("docs/handoff.md")), {
    kind: "path",
    path: "docs/handoff.md",
  });
});

test("missing .md token is a literal prompt", () => {
  assert.deepEqual(parseArgs("notes.md", none), { kind: "prompt", prompt: "notes.md" });
});

test("leading positive integer plus prompt sets the boundary", () => {
  assert.deepEqual(parseArgs("150000 build X", none), {
    kind: "prompt",
    prompt: "build X",
    boundary: 150000,
  });
});

test("leading positive integer plus existing .md path sets the boundary", () => {
  assert.deepEqual(parseArgs("120000 docs/handoff.md", only("docs/handoff.md")), {
    kind: "path",
    path: "docs/handoff.md",
    boundary: 120000,
  });
});

test("leading integer plus missing .md token is a prompt with a boundary", () => {
  assert.deepEqual(parseArgs("100000 notes.md", none), {
    kind: "prompt",
    prompt: "notes.md",
    boundary: 100000,
  });
});

test("zero, negative and non-numeric prefixes are part of the prompt", () => {
  assert.deepEqual(parseArgs("0 build X", none), { kind: "prompt", prompt: "0 build X" });
  assert.deepEqual(parseArgs("-5 build X", none), { kind: "prompt", prompt: "-5 build X" });
  assert.deepEqual(parseArgs("12abc build X", none), { kind: "prompt", prompt: "12abc build X" });
});

test("a bare integer with no remainder is a prompt", () => {
  assert.deepEqual(parseArgs("150000", none), { kind: "prompt", prompt: "150000" });
});

test("multi-token text ending in .md is a prompt even when a file matches", () => {
  assert.deepEqual(parseArgs("summarize notes.md", () => true), {
    kind: "prompt",
    prompt: "summarize notes.md",
  });
});

test("empty and whitespace-only input is empty", () => {
  assert.deepEqual(parseArgs("", none), { kind: "empty" });
  assert.deepEqual(parseArgs("   ", none), { kind: "empty" });
});

test("surrounding whitespace is trimmed", () => {
  assert.deepEqual(parseArgs("  150000   build X  ", none), {
    kind: "prompt",
    prompt: "build X",
    boundary: 150000,
  });
});
