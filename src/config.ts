/**
 * Pure interpreter for the handoff document's frontmatter.
 *
 * Expected shape (all optional):
 *   clearthen:
 *     context_limit: <positive integer below the model's context window>
 *     turn_budget:   <positive integer, default 3>
 *   hop: <non-negative integer, default 0>
 *
 * contextLimit is null when the doc does not ask to arm the mode. Invalid
 * values are reported as an error so the caller can warn and still send the
 * prompt un-armed.
 */

export interface ClearthenConfig {
  contextLimit: number | null;
  turnBudget: number;
  hop: number;
}

export type ConfigResult =
  | { ok: true; config: ClearthenConfig; headroomWarning: boolean }
  | { ok: false; error: string };

export const DEFAULT_TURN_BUDGET = 3;
export const DEFAULT_RESERVE_TOKENS = 16384;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asInteger(value: unknown): number | null {
  if (typeof value === "number") return Number.isInteger(value) ? value : null;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

/** True when a boundary leaves less than reserveTokens before the context window. */
export function exceedsHeadroom(boundary: number, contextWindow: number, reserveTokens: number): boolean {
  return boundary > contextWindow - reserveTokens;
}

export function interpretConfig(
  frontmatter: unknown,
  contextWindow: number,
  reserveTokens: number = DEFAULT_RESERVE_TOKENS,
): ConfigResult {
  const fm = isRecord(frontmatter) ? frontmatter : {};
  const block = fm.clearthen;

  if (block !== undefined && !isRecord(block)) {
    return { ok: false, error: "clearthen must be a map" };
  }

  const config: ClearthenConfig = { contextLimit: null, turnBudget: DEFAULT_TURN_BUDGET, hop: 0 };

  if (fm.hop !== undefined) {
    const hop = asInteger(fm.hop);
    if (hop === null || hop < 0) {
      return { ok: false, error: `hop must be a non-negative integer, got ${JSON.stringify(fm.hop)}` };
    }
    config.hop = hop;
  }

  if (block !== undefined) {
    if (block.turn_budget !== undefined) {
      const turnBudget = asInteger(block.turn_budget);
      if (turnBudget === null || turnBudget <= 0) {
        return {
          ok: false,
          error: `clearthen.turn_budget must be a positive integer, got ${JSON.stringify(block.turn_budget)}`,
        };
      }
      config.turnBudget = turnBudget;
    }

    if (block.context_limit !== undefined) {
      const limit = asInteger(block.context_limit);
      if (limit === null || limit <= 0) {
        return {
          ok: false,
          error: `clearthen.context_limit must be a positive integer, got ${JSON.stringify(block.context_limit)}`,
        };
      }
      if (limit >= contextWindow) {
        return {
          ok: false,
          error: `clearthen.context_limit ${limit} must be below the model's context window ${contextWindow}`,
        };
      }
      config.contextLimit = limit;
    }
  }

  const headroomWarning =
    config.contextLimit !== null && exceedsHeadroom(config.contextLimit, contextWindow, reserveTokens);

  return { ok: true, config, headroomWarning };
}
