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
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { parseArgs } from "./args.ts";
import { DEFAULT_TURN_BUDGET, interpretConfig, type ClearthenConfig } from "./config.ts";

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

export function getArmState(): ArmState | null {
  return armed;
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
      for (const warning of loaded.warnings) ctx.ui.notify(warning, "warning");

      // Plain use disarms; an armed load replaces whatever was armed before.
      armed = loaded.arm;
      const { prompt, arm } = loaded;

      // Wait for any in-progress work to settle before switching sessions
      await ctx.waitForIdle();

      const parentSession = ctx.sessionManager.getSessionFile();

      const result = await ctx.newSession({
        parentSession,
        withSession: async (replacementCtx) => {
          replacementCtx.ui.setStatus("clearthen", arm ? `clearthen armed ${arm.contextLimit}` : undefined);
          replacementCtx.ui.notify(
            arm ? `Context cleared. Handoff armed at ${arm.contextLimit} tokens.` : "Context cleared. Running prompt...",
            "info",
          );
          await replacementCtx.sendUserMessage(prompt);
        },
      });

      if (result?.cancelled) {
        ctx.ui.notify("New session cancelled", "info");
      }
    },
  });
}

export { loadCommand };
