/**
 * clearthen — clear context and run a prompt in a fresh session
 *
 * Instead of compacting (lossy) or handoff (AI-generated, review step),
 * this simply starts a new session and sends your prompt immediately.
 *
 * Usage:
 *   /clearthen implement the login flow
 *   /clearthen review the changes in src/auth/
 *   /clearthen write tests for the new API endpoints
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

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
      pi.sendUserMessage(`/clearthen ${params.prompt}`, { deliverAs: "followUp" });
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
    description: "Clear context and run a prompt in a fresh session",
    handler: async (args, ctx) => {
      const prompt = args.trim();
      if (!prompt) {
        ctx.ui.notify("Usage: /clearthen <prompt>", "warning");
        return;
      }

      // Wait for any in-progress work to settle before switching sessions
      await ctx.waitForIdle();

      const parentSession = ctx.sessionManager.getSessionFile();

      const result = await ctx.newSession({
        parentSession,
        withSession: async (replacementCtx) => {
          replacementCtx.ui.notify("Context cleared. Running prompt...", "info");
          await replacementCtx.sendUserMessage(prompt);
        },
      });

      if (result?.cancelled) {
        ctx.ui.notify("New session cancelled", "info");
      }
    },
  });
}
