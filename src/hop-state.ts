/**
 * Pure per-hop state machine for the boundary watch.
 *
 * One hop lives from the moment the mode arms until the session is cleared.
 * Within a hop: the boundary fires exactly once (steer), then the agent has
 * turnBudget turns to clear; if it does not, we abort and re-prompt with the
 * same instruction, at most twice; after the second failure we give up once
 * and stay quiet. A clear resets everything for the next hop.
 *
 * If the very first turn of a hop is already at or past the boundary, the
 * boundary sits below the session's baseline context and a hop cannot help;
 * belowBaseline tells the caller to warn and disarm instead of steering.
 *
 * A turn that ends while a clear is pending never counts toward the budget:
 * the agent's clearthen tool call starts the command handler at once, which
 * parks until the run is idle, and an abort here would let it resume while
 * the re-prompt is being sent, interleaving the two.
 */

export type HopAction = "none" | "steer" | "abortPrompt" | "giveUp" | "belowBaseline";

export type HopEvent =
  | { type: "turnEnd"; tokens: number | null; pending?: boolean }
  | { type: "sent"; kind: "steer" | "abortPrompt" }
  | { type: "cleared" };

export interface HopState {
  limit: number;
  turnBudget: number;
  fired: boolean;
  turnsSeen: number;
  turnsSinceInstruction: number;
  escalations: number;
  gaveUp: boolean;
}

export const MAX_ESCALATIONS = 2;

export function initialHopState(limit: number, turnBudget: number): HopState {
  return { limit, turnBudget, fired: false, turnsSeen: 0, turnsSinceInstruction: 0, escalations: 0, gaveUp: false };
}

export function stepHop(state: HopState, event: HopEvent): { state: HopState; action: HopAction } {
  switch (event.type) {
    case "cleared":
      return { state: initialHopState(state.limit, state.turnBudget), action: "none" };

    case "sent":
      return { state: { ...state, turnsSinceInstruction: 0 }, action: "none" };

    case "turnEnd": {
      if (state.gaveUp) return { state, action: "none" };

      const firstTurn = state.turnsSeen === 0;
      state = { ...state, turnsSeen: state.turnsSeen + 1 };

      if (!state.fired) {
        if (event.tokens === null || event.tokens < state.limit) return { state, action: "none" };
        if (firstTurn) return { state: { ...state, gaveUp: true }, action: "belowBaseline" };
        return { state: { ...state, fired: true, turnsSinceInstruction: 0 }, action: "steer" };
      }

      if (event.pending) return { state, action: "none" };

      const turns = state.turnsSinceInstruction + 1;
      if (turns < state.turnBudget) {
        return { state: { ...state, turnsSinceInstruction: turns }, action: "none" };
      }

      if (state.escalations < MAX_ESCALATIONS) {
        return {
          state: { ...state, turnsSinceInstruction: 0, escalations: state.escalations + 1 },
          action: "abortPrompt",
        };
      }

      return { state: { ...state, turnsSinceInstruction: 0, gaveUp: true }, action: "giveUp" };
    }
  }
}
