import { test } from "node:test";
import assert from "node:assert/strict";
import { initialHopState, stepHop, type HopAction, type HopEvent, type HopState } from "./hop-state.ts";

const LIMIT = 150000;
const BUDGET = 3;

function run(events: HopEvent[], start: HopState = initialHopState(LIMIT, BUDGET)) {
  const actions: HopAction[] = [];
  let state = start;
  for (const event of events) {
    const out = stepHop(state, event);
    state = out.state;
    actions.push(out.action);
  }
  return { state, actions };
}

const turnEnd = (tokens: number | null): HopEvent => ({ type: "turnEnd", tokens });
const repeat = (event: HopEvent, n: number): HopEvent[] => Array.from({ length: n }, () => event);

test("below the boundary nothing happens", () => {
  const { actions, state } = run([turnEnd(1000), turnEnd(LIMIT - 1)]);
  assert.deepEqual(actions, ["none", "none"]);
  assert.equal(state.fired, false);
});

test("null usage never fires and the latch stays clear", () => {
  const { actions, state } = run(repeat(turnEnd(null), 5));
  assert.deepEqual(actions, ["none", "none", "none", "none", "none"]);
  assert.equal(state.fired, false);
});

test("crossing the boundary steers exactly once even when held there", () => {
  const { actions } = run([turnEnd(LIMIT), turnEnd(LIMIT + 5)]);
  assert.deepEqual(actions, ["steer", "none"]);
});

test("boundary at exactly the limit fires", () => {
  assert.equal(stepHop(initialHopState(LIMIT, BUDGET), turnEnd(LIMIT)).action, "steer");
});

test("abortPrompt after turnBudget turn ends since the steer", () => {
  const { actions } = run([turnEnd(LIMIT), ...repeat(turnEnd(LIMIT), BUDGET)]);
  assert.deepEqual(actions, ["steer", "none", "none", "abortPrompt"]);
});

test("null usage after the steer still counts toward the turn budget", () => {
  const { actions } = run([turnEnd(LIMIT), ...repeat(turnEnd(null), BUDGET)]);
  assert.deepEqual(actions, ["steer", "none", "none", "abortPrompt"]);
});

test("sent resets the turn counter", () => {
  const { actions } = run([
    turnEnd(LIMIT),
    turnEnd(LIMIT),
    turnEnd(LIMIT),
    { type: "sent", kind: "steer" },
    turnEnd(LIMIT),
    turnEnd(LIMIT),
    turnEnd(LIMIT),
  ]);
  assert.deepEqual(actions, ["steer", "none", "none", "none", "none", "none", "abortPrompt"]);
});

test("full non-compliance: one steer, two abortPrompts, one giveUp, then silence", () => {
  const { actions, state } = run([turnEnd(LIMIT), ...repeat(turnEnd(LIMIT), BUDGET * 3 + 4)]);
  assert.deepEqual(
    actions.filter((a) => a !== "none"),
    ["steer", "abortPrompt", "abortPrompt", "giveUp"],
  );
  assert.deepEqual(actions.slice(-4), ["none", "none", "none", "none"]);
  assert.equal(state.gaveUp, true);
  assert.equal(state.escalations, 2);
});

test("cleared resets to the initial armed state so the next hop can fire again", () => {
  const spent = run([turnEnd(LIMIT), ...repeat(turnEnd(LIMIT), BUDGET * 3 + 1)]).state;
  assert.equal(spent.gaveUp, true);
  const { state, actions } = run([{ type: "cleared" }, turnEnd(LIMIT - 1), turnEnd(LIMIT)], spent);
  assert.deepEqual(actions, ["none", "none", "steer"]);
  assert.equal(state.escalations, 0);
  assert.equal(state.gaveUp, false);
  assert.equal(state.limit, LIMIT);
  assert.equal(state.turnBudget, BUDGET);
});

test("cleared mid-hop discards the fired latch", () => {
  const { state } = run([turnEnd(LIMIT), { type: "cleared" }]);
  assert.deepEqual(state, initialHopState(LIMIT, BUDGET));
});
