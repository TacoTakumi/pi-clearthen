/**
 * Turns the /clearthen argument string into the prompt to send and the mode
 * to arm. Pure apart from the injected file and frontmatter functions, so it
 * runs under node --test without pi.
 */

import { resolve } from "node:path";
import { parseArgs } from "./args.ts";
import { DEFAULT_TURN_BUDGET, interpretConfig, type ClearthenConfig } from "./config.ts";
import type { ArmState } from "./session-state.ts";

export const DEFAULT_HANDOFF_PATH = "docs/clearthen-handoff.md";

export interface LoadDeps {
  readFile: (path: string) => string;
  exists: (path: string) => boolean;
  parseFrontmatter: (text: string) => { frontmatter: unknown; body: string };
}

export interface LoadedCommand {
  prompt: string;
  arm: ArmState | null;
  warnings: string[];
  /**
   * Set when an armed prompt-form run finds a previous run's rolling doc. The
   * handler asks the user, archives the doc when fresh is set, or refuses.
   */
  stale?: StaleDoc;
}

export interface StaleDoc {
  /** Arguments that resume the previous run instead. */
  resumeArgs: string;
  /** Arguments that archive the doc and start this run. */
  newArgs: string;
  /** True when the command carried --new. */
  fresh: boolean;
}

export function staleRefusal(stale: StaleDoc): string {
  return (
    `clearthen: ${DEFAULT_HANDOFF_PATH} already exists from a previous run. ` +
    `Resume it with /clearthen ${stale.resumeArgs}, or archive it and start a new run with /clearthen ${stale.newArgs}`
  );
}

/** Where a previous run's doc goes when a new run starts. */
export function archivePath(now: Date): string {
  const stamp = now.toISOString().replace(/\.\d+Z$/, "").replace(/[-:]/g, "").replace("T", "-");
  return DEFAULT_HANDOFF_PATH.replace(/\.md$/, `-${stamp}.md`);
}

export function loadCommand(
  args: string,
  cwd: string,
  contextWindow: number,
  deps: LoadDeps,
): LoadedCommand | null {
  const { readFile, exists, parseFrontmatter } = deps;
  const parsed = parseArgs(args, (p) => exists(resolve(cwd, p)));
  if (parsed.kind === "empty") return null;

  const warnings: string[] = [];
  let prompt: string;
  let path = DEFAULT_HANDOFF_PATH;
  let firstHop = true;
  let config: ClearthenConfig = { contextLimit: null, turnBudget: DEFAULT_TURN_BUDGET, hop: 0 };
  // A doc whose frontmatter cannot be parsed or interpreted never arms, even
  // with an integer prefix: arming with defaults would silently reset the
  // hop counter and turn budget of a rolling doc.
  let docInvalid = false;

  if (parsed.kind === "path") {
    path = parsed.path;
    let frontmatter: unknown = {};
    let body = "";
    try {
      ({ frontmatter, body } = parseFrontmatter(readFile(resolve(cwd, parsed.path))));
    } catch (err) {
      warnings.push(`clearthen: could not parse frontmatter in ${parsed.path}: ${(err as Error).message}; mode not armed`);
      body = readFile(resolve(cwd, parsed.path));
      docInvalid = true;
    }
    prompt = body.trim();
    const result = interpretConfig(frontmatter, contextWindow);
    if (result.ok) {
      config = result.config;
    } else {
      warnings.push(`clearthen: ${result.error}; mode not armed from ${parsed.path}`);
      docInvalid = true;
    }
    // A doc that has never been through a hop (no clearthen block, hop 0) is
    // a plain brief: the steer must create the Goal and Standing instructions
    // rather than claim they exist. A rolling handoff doc always has the block.
    const hasBlock = typeof frontmatter === "object" && frontmatter !== null && "clearthen" in frontmatter;
    firstHop = !hasBlock && config.hop === 0;
  } else {
    prompt = parsed.prompt;
  }

  if (parsed.boundary !== undefined && docInvalid) {
    warnings.push(`clearthen: boundary ${parsed.boundary} ignored until the frontmatter in ${path} is fixed`);
  } else if (parsed.boundary !== undefined) {
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

  // A new run must not overwrite a previous run's rolling doc. Resuming it is
  // the path form; starting over archives the file first.
  if (arm && parsed.kind === "prompt" && exists(resolve(cwd, DEFAULT_HANDOFF_PATH))) {
    return {
      prompt,
      arm,
      warnings,
      stale: {
        resumeArgs: `${parsed.boundary} ${DEFAULT_HANDOFF_PATH}`,
        newArgs: `--new ${parsed.boundary} <prompt>`,
        fresh: parsed.fresh === true,
      },
    };
  }

  return { prompt, arm, warnings };
}
