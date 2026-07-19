# Changelog

All notable changes to pi-clearthen are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-07-19

### Added

- Initial release.
- `/clearthen <prompt>` slash command: waits for in-progress work to settle,
  clears the conversation context, starts a fresh session, and runs the prompt
  immediately.
- `clearthen` agent tool: queues the same command as a follow-up so an agent can
  clear its own context and continue a workflow in a clean session.
