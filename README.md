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
