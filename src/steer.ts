/**
 * Pure builder for the handoff steer text.
 *
 * The steer tells the agent to write one rolling handoff document and then
 * clear into a fresh session that re-arms from that document's frontmatter.
 * The same text is reused verbatim for the abort-and-prompt fallback.
 */

export interface SteerInput {
  path: string;
  contextLimit: number;
  turnBudget: number;
  hop: number;
  goalPrompt: string;
  firstHop: boolean;
}

export const SECTION_NAMES = ["Goal", "Standing instructions", "State", "Next steps", "Gotchas"] as const;

export function buildSteer(input: SteerInput): string {
  const { path, contextLimit, turnBudget, hop, goalPrompt, firstHop } = input;
  const nextHop = hop + 1;

  const lines: string[] = [];
  lines.push(
    `Your context has reached its configured boundary. Stop the current work now, write the handoff document at ${path}, then clear into a fresh session.`,
    "",
    "Do not summarise in chat. Do not call any other tool between finishing the document and running the command below.",
    "",
    `The document must start with this YAML frontmatter:`,
    "",
    "```yaml",
    "---",
    "clearthen:",
    `  context_limit: ${contextLimit}`,
    `  turn_budget: ${turnBudget}`,
    `hop: ${nextHop}`,
    "---",
    "```",
    "",
    "The body has exactly these five sections, in this order, each as a level-2 heading:",
    "",
  );

  if (firstHop) {
    lines.push(
      `1. Goal - create it with the original brief below, copied verbatim, followed by the definition of done. Mark it "do not edit".`,
      "",
      "   Original brief:",
      "",
      ...goalPrompt.split("\n").map((line) => `   > ${line}`),
      "",
      `2. Standing instructions - create it with these two rules, marked "do not edit": (a) when the extension's handoff steer arrives, obey it immediately; (b) once the goal is met, stop and do not run /clearthen again.`,
    );
  } else {
    lines.push(
      `1. Goal - already present. Do not change this section.`,
      `2. Standing instructions - already present. Do not change this section.`,
    );
  }

  lines.push(
    "3. State - replace with what is done so far and how each item was verified.",
    "4. Next steps - replace with an explicit, ordered list that a fresh session can run with no history.",
    "5. Gotchas - replace with decisions made and traps not to rediscover.",
    "",
    `Sections 1 and 2 are fixed. Sections 3, 4 and 5 are yours to rewrite each hop.`,
    "",
    `When the file is saved, run exactly this command and nothing else:`,
    "",
    `/clearthen ${path}`,
  );

  return lines.join("\n");
}

export interface PreambleInput {
  path: string;
  contextLimit: number;
  turnBudget: number;
}

/**
 * System prompt block for an armed session, so the agent knows the handoff
 * regime from its first turn rather than only when the steer arrives.
 */
export function buildPreamble(input: PreambleInput): string {
  const { path, contextLimit, turnBudget } = input;
  return [
    "# Self-clearing handoff mode",
    "",
    `This session is armed with a context boundary of ${contextLimit} tokens. When usage reaches it, a handoff steer will arrive as a user message. Obey it immediately: it tells you to write the rolling handoff document at ${path} and then run /clearthen ${path}, which clears context and continues the work in a fresh session that reads that document.`,
    "",
    "Work so that a handoff is cheap at any moment:",
    "- Break the goal into small, verifiable steps and finish one before starting the next.",
    "- Keep a running picture of what is done, how it was verified, and what comes next; the handoff document has sections for exactly those (State, Next steps, Gotchas).",
    "- Prefer tools and commands whose output is short. Do not read large files into context without need.",
    `- After the steer arrives you have ${turnBudget} turns to write the document and run the command before the run is interrupted and re-prompted.`,
    "- Once the goal is met, say so and stop. Do not run /clearthen again.",
  ].join("\n");
}
