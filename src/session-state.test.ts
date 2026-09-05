import { test } from "node:test";
import assert from "node:assert/strict";
import { ARM_ENTRY_TYPE, restoreArmState, rootUserMessageId, type ArmState } from "./session-state.ts";

const arm: ArmState = {
  path: "docs/clearthen-handoff.md",
  contextLimit: 150000,
  turnBudget: 3,
  hop: 1,
  goalPrompt: "build X",
  firstHop: false,
};

let counter = 0;
function entry(partial: Record<string, unknown>) {
  counter += 1;
  return { id: `e${counter}`, parentId: null, timestamp: "", ...partial } as any;
}
const user = () => entry({ type: "message", message: { role: "user", content: "hi" } });
const assistant = () => entry({ type: "message", message: { role: "assistant", content: "ok" } });
const armEntry = (data: unknown) => entry({ type: "custom", customType: ARM_ENTRY_TYPE, data });

test("a branch without an arm entry restores nothing", () => {
  assert.deepEqual(restoreArmState([user(), assistant()]), { arm: null, turnsSeen: 0 });
});

test("the latest arm entry wins and only later assistant turns count", () => {
  const branch = [assistant(), armEntry({ ...arm, hop: 0 }), user(), assistant(), armEntry(arm), user(), assistant(), assistant()];
  assert.deepEqual(restoreArmState(branch), { arm, turnsSeen: 2 });
});

test("a disarm entry after an arm entry restores nothing", () => {
  assert.deepEqual(restoreArmState([armEntry(arm), assistant(), armEntry(null)]), { arm: null, turnsSeen: 0 });
});

test("a malformed arm entry is treated as a disarm", () => {
  assert.deepEqual(restoreArmState([armEntry({ path: "x" })]), { arm: null, turnsSeen: 0 });
});

test("an unrelated custom entry is ignored", () => {
  const other = entry({ type: "custom", customType: "other", data: null });
  assert.deepEqual(restoreArmState([armEntry(arm), other, assistant()]), { arm, turnsSeen: 1 });
});

function manager(entries: any[], leafId: string | null) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  return { getLeafId: () => leafId, getEntry: (id: string) => byId.get(id) };
}

test("rootUserMessageId walks to the first user message on the branch", () => {
  const model = entry({ type: "model_change", parentId: null });
  const u1 = entry({ type: "message", parentId: model.id, message: { role: "user", content: "a" } });
  const a1 = entry({ type: "message", parentId: u1.id, message: { role: "assistant", content: "b" } });
  const u2 = entry({ type: "message", parentId: a1.id, message: { role: "user", content: "c" } });
  assert.equal(rootUserMessageId(manager([model, u1, a1, u2], u2.id)), u1.id);
});

test("rootUserMessageId is null with no user message", () => {
  const model = entry({ type: "model_change", parentId: null });
  assert.equal(rootUserMessageId(manager([model], model.id)), null);
  assert.equal(rootUserMessageId(manager([], null)), null);
});
