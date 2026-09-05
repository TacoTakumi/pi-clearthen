/**
 * clearthen — clear context and run a prompt in a fresh session
 *
 * Instead of compacting (lossy) or handoff (AI-generated, review step),
 * this simply starts a new session and sends your prompt immediately.
 *
 * Usage:
 *   /clearthen implement the login flow
 *   /clearthen docs/handoff.md
 *   /clearthen 150000 implement the login flow
 *   /clearthen 120000 docs/handoff.md
 *
 * A leading positive integer arms the self-clearing handoff mode with that
 * absolute token boundary. A .md path loads the document: its body is the
 * prompt and its frontmatter configures the mode.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseFrontmatter, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { parseArgs } from "./args.ts";
import {
  DEFAULT_RESERVE_TOKENS,
  DEFAULT_TURN_BUDGET,
  exceedsHeadroom,
  interpretConfig,
  type ClearthenConfig,
} from "./config.ts";
import { initialHopState, stepHop, type HopState } from "./hop-state.ts";
import { buildSteer } from "./steer.ts";

export const DEFAULT_HANDOFF_PATH = "docs/clearthen-handoff.md";

/** Everything the next session needs to watch its boundary and write the steer. */
export interface ArmState {
  path: string;
  contextLimit: number;
  turnBudget: number;
  hop: number;
  goalPrompt: string;
  firstHop: boolean;
}

// Module-level so it survives the replacement session: pi caches the extension
// module for the same cwd and re-runs only the factory.
let armed: ArmState | null = null;
// Per-hop watch state; re-created whenever the mode arms and dropped on disarm.
let hopState: HopState | null = null;
// True only between our handler deciding to arm and the replacement session's
// session_start, so that start is distinguished from a plain /new.
let handoffPending = false;

export function getArmState(): ArmState | null {
  return armed;
}

function footerText(state: ArmState | null, hop: HopState | null): string | undefined {
  if (!state) return undefined;
  return hop?.fired ? "clearthen handoff..." : `clearthen armed ${state.contextLimit}`;
}

function setArmed(state: ArmState | null): void {
  armed = state;
  hopState = state ? initialHopState(state.contextLimit, state.turnBudget) : null;
}

function compactionReserveTokens(cwd: string): number {
  try {
    return SettingsManager.create(cwd).getCompactionReserveTokens();
  } catch {
    return DEFAULT_RESERVE_TOKENS;
  }
}

interface LoadedCommand {
  prompt: string;
  arm: ArmState | null;
  warnings: string[];
}

function loadCommand(
  args: string,
  cwd: string,
  contextWindow: number,
  readFile: (path: string) => string = (p) => readFileSync(p, "utf8"),
  exists: (path: string) => boolean = existsSync,
): LoadedCommand | null {
  const parsed = parseArgs(args, (p) => exists(resolve(cwd, p)));
  if (parsed.kind === "empty") return null;

  const warnings: string[] = [];
  let prompt: string;
  let path = DEFAULT_HANDOFF_PATH;
  let firstHop = true;
  let config: ClearthenConfig = { contextLimit: null, turnBudget: DEFAULT_TURN_BUDGET, hop: 0 };

  if (parsed.kind === "path") {
    path = parsed.path;
    firstHop = false;
    let frontmatter: unknown = {};
    let body = "";
    try {
      ({ frontmatter, body } = parseFrontmatter(readFile(resolve(cwd, parsed.path))));
    } catch (err) {
      warnings.push(`clearthen: could not parse frontmatter in ${parsed.path}: ${(err as Error).message}`);
      body = readFile(resolve(cwd, parsed.path));
    }
    prompt = body.trim();
    const result = interpretConfig(frontmatter, contextWindow);
    if (result.ok) {
      config = result.config;
    } else {
      warnings.push(`clearthen: ${result.error}; mode not armed from ${parsed.path}`);
    }
  } else {
    prompt = parsed.prompt;
  }

  if (parsed.boundary !== undefined) {
    if (parsed.boundary >= contextWindow) {
      warnings.push(
        `clearthen: boundary ${parsed.boundary} must be below the model's context window ${contextWindow}; mode not armed`,
      );
      config = { ...config, contextLimit: null };
    } else {
      config = { ...config, contextLimit: parsed.boundary };
    }
  }

  const arm: ArmState | null =
    config.contextLimit === null
      ? null
      : {
          path,
          contextLimit: config.contextLimit,
          turnBudget: config.turnBudget,
          hop: config.hop,
          goalPrompt: prompt,
          firstHop,
        };

  return { prompt, arm, warnings };
}

export default function (pi: ExtensionAPI) {
  // Re-apply the footer in the replacement session; any other new or resumed
  // session (for example /new) disarms.
  pi.on("session_start", async (event, ctx) => {
    if (handoffPending) {
      handoffPending = false;
    } else if (event.reason === "new" || event.reason === "resume" || event.reason === "fork") {
      setArmed(null);
    }
    ctx.ui.setStatus("clearthen", footerText(armed, hopState));
  });

  // Boundary watch: once per hop, when usage is known and at or past the
  // boundary, steer the agent to write the handoff doc and clear.
  pi.on("turn_end", async (_event, ctx) => {
    if (!armed || !hopState) return;
    const tokens = ctx.getContextUsage()?.tokens ?? null;
    const step = stepHop(hopState, { type: "turnEnd", tokens });
    hopState = step.state;
    if (step.action === "steer") {
      pi.sendUserMessage(buildSteer(armed), { deliverAs: "steer" });
      hopState = stepHop(hopState, { type: "sent", kind: "steer" }).state;
      ctx.ui.setStatus("clearthen", footerText(armed, hopState));
    }
  });

  // Register a tool so the agent can call it programmatically.
  // The tool queues the /clearthen command as a follow-up message;
  // pi handles the session switch and prompt delivery.
  pi.registerTool({
    name: "clearthen",
    label: "Clear Then",
    description:
      "Clear the conversation context and run a prompt in a fresh session. " +
      "Use when the user wants to start a new focused task without the current " +
      "conversation history. The prompt is sent immediately in the new session.",
    promptSnippet: "clearthen — clear context and run a prompt in a fresh session",
    promptGuidelines: [
      "Use clearthen when the user explicitly asks to clear context and start a new task, or when continuing the current conversation would be counterproductive.",
      "Do NOT use clearthen for simple topic changes — only when the user wants a clean slate.",
    ],
    parameters: Type.Object({
      prompt: Type.String({
        minLength: 1,
        description: "The prompt to run in the new session after clearing context",
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      pi.sendUserMessage(`/clearthen ${params.prompt}`, { deliverAs: "followUp", expandPromptTemplates: true });
      return {
        content: [
          {
            type: "text",
            text: `Queued /clearthen with prompt: "${params.prompt}". ` +
              `The session will clear and the prompt will run in a fresh session.`,
          },
        ],
      };
    },
  });

  // Slash command for human use
  pi.registerCommand("clearthen", {
    description: "Clear context and run a prompt in a fresh session; prefix a token boundary or pass a handoff .md to arm",
    handler: async (args, ctx) => {
      const loaded = loadCommand(args, ctx.cwd, ctx.model.contextWindow);
      if (!loaded) {
        ctx.ui.notify("Usage: /clearthen [<tokens>] <prompt | path.md>", "warning");
        return;
      }
      if (!loaded.prompt) {
        ctx.ui.notify("clearthen: the document has no body to send as the prompt", "warning");
        return;
      }
      const { prompt, arm, warnings } = loaded;
      if (arm) {
        const reserve = compactionReserveTokens(ctx.cwd);
        if (exceedsHeadroom(arm.contextLimit, ctx.model.contextWindow, reserve)) {
          warnings.push(
            `clearthen: boundary ${arm.contextLimit} is inside the compaction reserve ` +
              `(${reserve} of ${ctx.model.contextWindow} tokens); pi will compact before the boundary is reached`,
          );
        }
      }

      // Plain use disarms; an armed load replaces whatever was armed before
      // and starts a fresh hop.
      setArmed(arm);
      handoffPending = true;

      // Wait for any in-progress work to settle before switching sessions
      await ctx.waitForIdle();

      const parentSession = ctx.sessionManager.getSessionFile();

      const result = await ctx.newSession({
        parentSession,
        withSession: async (replacementCtx) => {
          for (const warning of warnings) replacementCtx.ui.notify(warning, "warning");
          replacementCtx.ui.notify(
            arm ? `Context cleared. Handoff armed at ${arm.contextLimit} tokens.` : "Context cleared. Running prompt...",
            "info",
          );
          await replacementCtx.sendUserMessage(prompt);
        },
      });
      handoffPending = false;

      if (result?.cancelled) {
        ctx.ui.notify("New session cancelled", "info");
      }
    },
  });
}

export { loadCommand };
