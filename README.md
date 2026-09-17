# pi-clearthen

Clear context and run a prompt, in the same session.

## Problem

When working on a project in sections, you often want to clear the conversation context and start fresh with a new prompt - without the lossy compaction or the review step of handoff.

## Solution

A single slash command that clears the context in place and immediately sends your prompt:

```
/clearthen implement the login flow
/clearthen review the changes in src/auth/
/clearthen write tests for the new API endpoints
```

The clear navigates the session tree back to its root. The old conversation
stays in the session file as a sibling branch, visible under `/tree`.

## Usage

### As a human (slash command)

```
/clearthen <prompt>
/clearthen <path>.md
/clearthen <tokens> <prompt>
/clearthen <tokens> <path>.md
/clearthen --new <tokens> <prompt>
```

- `/clearthen <prompt>` - Clear context, run prompt immediately
- If no prompt is provided, shows usage message
- Waits for any in-progress work to settle before clearing

### Prompt from a file

A single argument that ends in `.md` and names an existing file is loaded as the
prompt. The body of the file is sent; YAML frontmatter is not.

```
/clearthen docs/brief.md
```

If the file does not exist, the argument is sent as a literal prompt.

### Context boundary (self-clearing handoff)

A leading positive integer arms the self-clearing handoff mode with that number
of tokens as the context boundary:

```
/clearthen 150000 implement the login flow
/clearthen 120000 docs/brief.md
```

While the mode is armed:

- The footer shows `clearthen armed <tokens>`.
- The agent is told about the mode in its system prompt.
- When context usage reaches the boundary, the extension steers the agent to
  write a rolling handoff document and then call the `clearthen` tool with the
  path of that document. The context clears and the work continues from the
  document, armed again with the same boundary.
- If the agent ignores the steer for `turn_budget` turns, the run is aborted and
  the instruction is sent again, at most two times. After that a warning tells
  you to hand off yourself.

The handoff document is `docs/clearthen-handoff.md` for the prompt form, or the
file you gave for the path form. Its frontmatter configures the mode, so a
document can arm the mode without a boundary on the command line:

```yaml
---
clearthen:
  context_limit: 150000   # boundary in tokens
  turn_budget: 3          # turns allowed after the steer, default 3
hop: 2                    # number of clears so far, written by the agent
---
```

A boundary on the command line overrides `context_limit`. The boundary must be
below the model's context window. Also leave pi's compaction reserve free
between the boundary and the context window, or pi compacts before the boundary
is reached. clearthen warns you when this is so.

The mode disarms on `/new`, on `/fork`, and on a `/clearthen` that does not arm it.
It survives `/reload` and a resumed session.

### When a previous handoff document is in the way

`/clearthen <tokens> <prompt>` starts a new run, and a new run must not
overwrite the `docs/clearthen-handoff.md` of a previous run. When that file
exists, clearthen asks what to do:

- Resume the previous run - same as `/clearthen <tokens> docs/clearthen-handoff.md`
- Archive it and start the new run - the file is renamed to
  `docs/clearthen-handoff-<YYYYMMDD-HHMMSS>.md` (UTC)
- Cancel - nothing is cleared

To skip the question, add `--new`. It archives the old file and starts:

```
/clearthen --new 150000 implement the login flow
```

Where pi has no UI to ask the question, the command refuses and names both
commands, so an unattended run never drops a previous run by accident. `--new`
has no effect when there is no old file.

### As the agent (tool)

The agent can call `clearthen(prompt="...")` programmatically. It queues the
`/clearthen` command as a follow-up message, so the clear happens
after the current turn completes. The prompt takes the same forms as the slash
command, for example `clearthen(prompt="docs/clearthen-handoff.md")`. The `promptGuidelines` tell the agent to only
use it when you explicitly want a clean slate.

### As the agent, to continue its own workflow

An agent can call `clearthen` on itself to clear its own context mid-task and
continue with a clean context. This is useful for long, multi-step workflows
where the context fills with detail the agent no longer needs, for example when
moving between phases of a larger job. Instead of compacting (lossy) the agent
clears and hands itself exactly the context needed to keep going. The context
boundary above automates this pattern.

Because the cleared context has no history, the continuation prompt must be
fully self-contained. A good prompt carries:

- State: what has been accomplished so far
- Next steps: explicit, specific instructions, not just "continue" (a cleared
  context has no record of what "continue" means)
- Bootstrap: an instruction to keep using clearthen at the next boundary, so the
  pattern propagates itself across the whole workflow

This turns one long task that would otherwise exhaust the context window into a
chain of focused hops, each starting clean and picking up exactly where the
last one left off.

## Installation

```bash
# From source
pi install ./path/to/pi-clearthen

# Or add to settings.json packages array
```

## How it differs from similar extensions

| Extension | What it does | Review step? | AI generation? |
|-----------|-------------|-------------|----------------|
| `/new` | Creates empty new session | Yes (type prompt) | No |
| `/handoff` | AI-summarizes context, sets draft in editor | Yes | Yes |
| `/clearthen` | Clears context, runs prompt immediately | No | No |

## If you like this, try specflo

clearthen is a standalone extension and needs nothing else. If you like working
in a series of clean sessions, try [specflo](https://github.com/TacoTakumi/specflo),
a spec-driven brainstorm -> spec -> plan -> execute pipeline for coding agents.

specflo gives you auto-continue checkpoints. At each phase boundary it writes
its artifacts to disk and emits a self-contained handoff prompt for the next
phase. In its auto (unattended) mode, the agent calls clearthen at each
checkpoint to clear context and continue with that prompt, so a whole project
advances phase by phase without you, and every phase starts with a clean
context.
