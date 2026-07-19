# pi-clearthen

Clear context and run a prompt in a fresh session.

## Problem

When working on a project in sections, you often want to clear the conversation context and start fresh with a new prompt — without the lossy compaction or the review step of handoff.

## Solution

A single slash command that creates a new session and immediately sends your prompt:

```
/clearthen implement the login flow
/clearthen review the changes in src/auth/
/clearthen write tests for the new API endpoints
```

## Usage

### As a human (slash command)

- `/clearthen <prompt>` — Clear context, start new session, run prompt immediately
- If no prompt is provided, shows usage message
- Waits for any in-progress work to settle before switching

### As the agent (tool)

The agent can call `clearthen(prompt="...")` programmatically. It queues the
`/clearthen` command as a follow-up message, so the session switch happens
after the current turn completes. The `promptGuidelines` tell the agent to only
use it when you explicitly want a clean slate.

### As the agent, to continue its own workflow

An agent can call `clearthen` on itself to clear its own context mid-task and
continue in a fresh session. This is useful for long, multi-step workflows
where the context fills with detail the agent no longer needs, for example when
moving between phases of a larger job. Instead of compacting (lossy) the agent
starts a clean session and hands itself exactly the context needed to keep going.

Because the new session starts with no history, the continuation prompt must be
fully self-contained. A good prompt carries:

- State: what has been accomplished so far
- Next steps: explicit, specific instructions, not just "continue" (a fresh
  session has no context for what "continue" means)
- Bootstrap: an instruction to keep using clearthen at the next boundary, so the
  pattern propagates itself across the whole workflow

This turns one long task that would otherwise exhaust the context window into a
chain of focused sessions, each starting clean and picking up exactly where the
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

## Works with specflo

clearthen was built for [specflo](https://github.com/TacoTakumi/specflo), a spec-driven
brainstorm -> spec -> plan -> execute pipeline for coding agents. At each phase
boundary specflo writes its artifacts to disk and emits a self-contained handoff
prompt for the next phase, but by design it never clears context itself.

clearthen is that trigger. In specflo's auto (unattended) mode, the agent calls
clearthen to clear context at each phase boundary and continue the run with
specflo's handoff payload as the prompt, so a whole project advances phase by
phase across a series of clean sessions.
