# Changelog

All notable changes to pi-clearthen are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0]

### Added

- `--new` flag: `/clearthen --new <tokens> <prompt>` archives a previous run's
  `docs/clearthen-handoff.md` as `docs/clearthen-handoff-<YYYYMMDD-HHMMSS>.md`
  and starts the new run.

### Changed

- When `docs/clearthen-handoff.md` from a previous run is in the way,
  `/clearthen <tokens> <prompt>` now asks whether to resume, archive and start
  new, or cancel, instead of refusing. Without a UI it still refuses and names
  both commands.
- README: document the prompt-file and context-boundary forms, the handoff
  frontmatter, and the in-place clear.

## [0.1.0]

### Added

- Initial release.
- `/clearthen <prompt>` slash command: waits for in-progress work to settle,
  clears the conversation context, starts a fresh session, and runs the prompt
  immediately.
- `clearthen` agent tool: queues the same command as a follow-up so an agent can
  clear its own context and continue a workflow in a clean session.
