/**
 * Pure helpers over the session branch: where the clear navigates to, and
 * how the armed mode is persisted so it survives a module re-import.
 *
 * pi re-imports the extension module on /reload (and starts a fresh one on
 * startup and resume), which drops module-level state. The handler therefore
 * records the ArmState as a custom session entry right after each clear, and
 * session_start rebuilds the mode from the latest such entry on the current
 * branch. Custom entries never reach the model's context.
 */

import type { SessionEntry, SessionManager } from "@earendil-works/pi-coding-agent";

export const ARM_ENTRY_TYPE = "clearthen-arm";

/** Everything the next session needs to watch its boundary and write the steer. */
export interface ArmState {
  path: string;
  contextLimit: number;
  turnBudget: number;
  hop: number;
  goalPrompt: string;
  firstHop: boolean;
}

/**
 * The root user message of the current branch. Navigating the tree to it
 * resets the leaf to an empty conversation while keeping the old branch in
 * the same session file. Null when the conversation has no user message yet.
 */
export function rootUserMessageId(sm: Pick<SessionManager, "getLeafId" | "getEntry">): string | null {
  let id = sm.getLeafId();
  let root: string | null = null;
  while (id) {
    const entry = sm.getEntry(id);
    if (!entry) break;
    if (entry.type === "message" && entry.message.role === "user") root = entry.id;
    id = entry.parentId;
  }
  return root;
}

export interface RestoredArm {
  /** Null when the branch carries no arm entry or its latest one is a disarm. */
  arm: ArmState | null;
  /** Assistant turns on the branch after the arm entry, so a rebuilt hop does not mistake its next turn for the first. */
  turnsSeen: number;
}

function isArmState(data: unknown): data is ArmState {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.path === "string" &&
    typeof d.contextLimit === "number" &&
    typeof d.turnBudget === "number" &&
    typeof d.hop === "number" &&
    typeof d.goalPrompt === "string" &&
    typeof d.firstHop === "boolean"
  );
}

/** Rebuild the armed mode from a branch (root first, leaf last). */
export function restoreArmState(branch: readonly SessionEntry[]): RestoredArm {
  let arm: ArmState | null = null;
  let turnsSeen = 0;
  for (const entry of branch) {
    if (entry.type === "custom" && entry.customType === ARM_ENTRY_TYPE) {
      arm = isArmState(entry.data) ? entry.data : null;
      turnsSeen = 0;
    } else if (arm && entry.type === "message" && entry.message.role === "assistant") {
      turnsSeen += 1;
    }
  }
  return { arm, turnsSeen };
}
