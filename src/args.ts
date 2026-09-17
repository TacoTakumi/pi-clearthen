/**
 * Pure argument parser for the /clearthen command.
 *
 * Supported forms:
 *   /clearthen <prompt>
 *   /clearthen <path>.md
 *   /clearthen <tokens> <prompt>
 *   /clearthen <tokens> <path>.md
 *   /clearthen --new <tokens> <prompt>
 *
 * A single .md token is a path only when the file exists; otherwise it is a
 * literal prompt. A leading positive integer is a boundary override for the
 * hop and is stripped from the prompt. A leading --new asks for a new run:
 * the caller archives a handoff document left by a previous run. Filesystem access is injected so the
 * parser stays pure and testable.
 */

export type ParsedArgs =
  | { kind: "empty" }
  | { kind: "prompt"; prompt: string; boundary?: number; fresh?: true }
  | { kind: "path"; path: string; boundary?: number; fresh?: true };


const POSITIVE_INT = /^[1-9]\d*$/;

function isMdToken(token: string): boolean {
  return token.length > 3 && token.toLowerCase().endsWith(".md") && !/\s/.test(token);
}

function parseRemainder(
  rest: string,
  exists: (path: string) => boolean,
  boundary?: number,
): ParsedArgs {
  if (isMdToken(rest) && exists(rest)) {
    return boundary === undefined ? { kind: "path", path: rest } : { kind: "path", path: rest, boundary };
  }
  return boundary === undefined ? { kind: "prompt", prompt: rest } : { kind: "prompt", prompt: rest, boundary };
}

export function parseArgs(args: string, exists: (path: string) => boolean): ParsedArgs {
  const flag = /^--new(?:\s+([\s\S]*))?$/.exec(args.trim());
  if (flag) {
    const parsed = parseRest(flag[1] ?? "", exists);
    return parsed.kind === "empty" ? parsed : { ...parsed, fresh: true };
  }
  return parseRest(args, exists);
}

function parseRest(args: string, exists: (path: string) => boolean): ParsedArgs {
  const trimmed = args.trim();
  if (!trimmed) return { kind: "empty" };

  const match = /^(\S+)\s+(\S[\s\S]*)$/.exec(trimmed);
  if (match && POSITIVE_INT.test(match[1])) {
    const boundary = Number(match[1]);
    if (Number.isSafeInteger(boundary)) {
      return parseRemainder(match[2].trim(), exists, boundary);
    }
  }

  return parseRemainder(trimmed, exists);
}
