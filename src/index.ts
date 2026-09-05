/**
 * clearthen — clear context and run a prompt, in the same session
 *
 * Instead of compacting (lossy) or handoff (AI-generated, review step),
 * this navigates the session tree back to its root, which empties the
 * conversation while keeping the old branch in the file, and sends your
 * prompt immediately.
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
import { parseFrontmatter, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { DEFAULT_RESERVE_TOKENS, exceedsHeadroom } from "./config.ts";
import { initialHopState, stepHop, type HopState } from "./hop-state.ts";
import { DEFAULT_HANDOFF_PATH, loadCommand } from "./load.ts";
import { ARM_ENTRY_TYPE, clearTarget, restoreArmState, type ArmState } from "./session-state.ts";
import { buildPreamble, buildSteer } from "./steer.ts";

export { DEFAULT_HANDOFF_PATH, loadCommand } from "./load.ts";
export type { ArmState } from "./session-state.ts";

// The clear navigates the session tree in place, so this extension instance
// owns the mode state directly while it lives. pi re-imports the module on
// /reload, so the state is also recorded on the session branch (see
// session-state.ts) and rebuilt in session_start.
let armed: ArmState | null = null;
// Per-hop watch state; re-created whenever the mode arms and dropped on disarm.
let hopState: HopState | null = null;
// True from the clearthen tool queuing its command until the handler runs (or
// the run settles): those turns must not count toward the budget, since an
// abort would discard the queued command.
let clearQueued = false;
// Steer text to resend as a plain prompt once the aborted run has settled.
let pendingReprompt: string | null = null;
// True while a command handler is parked at waitForIdle or navigating: a
// second invocation in that window would clear and prompt twice.
let clearInFlight = false;

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
  pendingReprompt = null;
  clearQueued = false;
}

function compactionReserveTokens(cwd: string): number {
  try {
    return SettingsManager.create(cwd).getCompactionReserveTokens();
  } catch {
    return DEFAULT_RESERVE_TOKENS;
  }
}

export default function (pi: ExtensionAPI) {
  // The branch decides the mode: startup, reload and resume rebuild it from
  // the latest arm entry on the current branch (a fresh or different session
  // has none, so it disarms). /new and /fork always disarm.
  pi.on("session_start", async (event, ctx) => {
    if (event.reason === "new" || event.reason === "fork") {
      setArmed(null);
    } else {
      const restored = restoreArmState(ctx.sessionManager.getBranch());
      setArmed(restored.arm);
      // The steer latch is not persisted: a reload mid-handoff steers once
      // more at the next turn past the boundary. Turns already taken do
      // carry over so the below-baseline guard cannot misfire.
      if (hopState) hopState = { ...hopState, turnsSeen: restored.turnsSeen };
    }
    ctx.ui.setStatus("clearthen", footerText(armed, hopState));
  });

  // Tell the agent about the regime from its first turn, not only at the steer.
  pi.on("before_agent_start", async (event) => {
    if (!armed) return;
    const block = buildPreamble({ path: armed.path, contextLimit: armed.contextLimit, turnBudget: armed.turnBudget });
    return { systemPrompt: `${event.systemPrompt}\n\n${block}` };
  });

  // Boundary watch: once per hop, when usage is known and at or past the
  // boundary, steer the agent to write the handoff doc and clear.
  pi.on("turn_end", async (_event, ctx) => {
    if (!armed || !hopState) return;
    const tokens = ctx.getContextUsage()?.tokens ?? null;
    // A parked handler counts as pending too: an abort here would let it
    // resume while agent_settled sends the re-prompt, interleaving the two.
    const pending = clearQueued || clearInFlight || ctx.hasPendingMessages();
    const step = stepHop(hopState, { type: "turnEnd", tokens, pending });
    hopState = step.state;
    if (step.action === "steer") {
      pi.sendUserMessage(buildSteer(armed), { deliverAs: "steer" });
      hopState = stepHop(hopState, { type: "sent", kind: "steer" }).state;
      ctx.ui.setStatus("clearthen", footerText(armed, hopState));
    } else if (step.action === "abortPrompt") {
      // Stop the run; agent_settled resends the same instruction as the sole
      // task of a fresh turn.
      pendingReprompt = buildSteer(armed);
      ctx.abort();
    } else if (step.action === "belowBaseline") {
      const limit = armed.contextLimit;
      setArmed(null);
      // Recorded so a reload does not re-arm from the earlier arm entry.
      pi.appendEntry(ARM_ENTRY_TYPE, null);
      ctx.ui.setStatus("clearthen", undefined);
      ctx.ui.notify(
        `clearthen: boundary ${limit} is below this session's starting context (${tokens} tokens after the first turn); ` +
          "a handoff cannot help, so the mode is disarmed. Re-arm with a higher boundary.",
        "warning",
      );
    } else if (step.action === "giveUp") {
      ctx.ui.notify(
        "clearthen: the agent ignored the handoff instruction after one steer and two re-prompts; " +
          `no further instructions will be sent. Hand off yourself with /clearthen ${armed.path}`,
        "warning",
      );
    }
  });

  // Fallback ladder, second half: the aborted run has settled, so the identical
  // instruction now goes out as a normal prompt.
  pi.on("agent_settled", async () => {
    // A queued clear dispatches as the run ends; if we are still here, either
    // the handler already reset this or the dispatch did not happen.
    clearQueued = false;
    if (!pendingReprompt) return;
    const text = pendingReprompt;
    pendingReprompt = null;
    if (!armed || !hopState) return;
    pi.sendUserMessage(text);
    hopState = stepHop(hopState, { type: "sent", kind: "abortPrompt" }).state;
  });

  // Register a tool so the agent can call it programmatically.
  // The tool queues the /clearthen command as a follow-up message;
  // pi handles the session switch and prompt delivery.
  pi.registerTool({
    name: "clearthen",
    label: "Clear Then",
    description:
      "Clear the conversation context and run a prompt. " +
      "Use when the user wants to start a new focused task without the current " +
      "conversation history. The prompt is sent immediately once the context is cleared.",
    promptSnippet: "clearthen — clear context and run a prompt",
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
      if (clearInFlight) {
        return {
          content: [{ type: "text", text: "A clear is already in flight; it runs when this turn ends. Do not call clearthen again." }],
        };
      }
      pi.sendUserMessage(`/clearthen ${params.prompt}`, { deliverAs: "followUp", expandPromptTemplates: true });
      clearQueued = true;
      return {
        content: [
          {
            type: "text",
            text: `Queued /clearthen with prompt: "${params.prompt}". ` +
              `The context will clear and the prompt will run next.`,
          },
        ],
      };
    },
  });

  // Slash command for human use
  pi.registerCommand("clearthen", {
    description: "Clear context and run a prompt; prefix a token boundary or pass a handoff .md to arm",
    handler: async (args, ctx) => {
      if (clearInFlight) {
        ctx.ui.notify("clearthen: a clear is already in flight; this one is ignored", "warning");
        return;
      }
      // The flag is set before the first await so no other invocation can
      // pass the check at the top while this one is parked.
      clearInFlight = true;
      try {
        // Wait for any in-progress work to settle so its tool results are on
        // the branch we are about to leave, and so a document the agent wrote
        // during this run is what gets loaded.
        await ctx.waitForIdle();

        const loaded = loadCommand(args, ctx.cwd, ctx.model.contextWindow, {
          readFile: (p) => readFileSync(p, "utf8"),
          exists: existsSync,
          parseFrontmatter,
        });
        if (!loaded) {
          ctx.ui.notify("Usage: /clearthen [<tokens>] <prompt | path.md>", "warning");
          return;
        }
        if (loaded.refusal) {
          ctx.ui.notify(loaded.refusal, "warning");
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

        // Clear in place: the root user message becomes the target, which makes
        // the leaf an empty conversation in the same session file. The old hop
        // stays as a sibling branch under /tree.
        const where = clearTarget(ctx.sessionManager);
        if (where.kind === "navigate") {
          const result = await ctx.navigateTree(where.target, { summarize: false });
          if (result.cancelled) {
            ctx.ui.notify("clearthen: clear cancelled by another extension; nothing sent", "warning");
            return;
          }
          // pi puts the root prompt back in the editor on navigation.
          ctx.ui.setEditorText("");
        } else if (where.kind === "stuck") {
          warnings.push(
            "clearthen: nothing was cleared; the conversation holds only its first prompt with no reply and pi cannot navigate above it",
          );
        }

        // Plain use disarms; an armed load replaces whatever was armed before
        // and starts a fresh hop.
        setArmed(arm);
        // Recorded on the branch before the prompt so a re-imported module can
        // rebuild the mode from the session file.
        pi.appendEntry(ARM_ENTRY_TYPE, arm);
        ctx.ui.setStatus("clearthen", footerText(armed, hopState));
        for (const warning of warnings) ctx.ui.notify(warning, "warning");
        if (where.kind !== "stuck") {
          ctx.ui.notify(
            arm ? `Context cleared. Handoff armed at ${arm.contextLimit} tokens.` : "Context cleared. Running prompt...",
            "info",
          );
        }
        pi.sendUserMessage(prompt);
      } finally {
        clearInFlight = false;
      }
    },
  });
}

