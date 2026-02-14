# Contributing to YapYap

Thank you for wanting to help make YapYap better! Please follow these steps to keep the codebase reliable, secure, and easy to review.

## Before you start
1. Run `bun install` to ensure your lockfile is current.
2. Review `docs/MESSAGE_FLOW.md` and `PLAN.md` to understand the message pipeline, reliability guarantees, and MVP scope before touching routing or database layers.
3. Create an issue or comment on an existing one before working on a large change; smaller fixes can target an open issue directly.

## Local workflow
- Build the project with `bun run build` and the CLI with `bun run build:cli`. The `yapyap` binary lives in `dist/` after building.
- Run `bun test` (or targeted `.test.ts` files) to validate behavior. Bun requires the `.test` suffix for discovery.
- Enforce linting and formatting by running `bun run lint`, `bun run format`, `bun run check`, and `bun run typecheck` before submitting.
- Integration scenarios live under `tests/integration/docker/` and are invoked with `bash tests/integration/docker/run-basic-suite.sh` or `run.sh` for custom scenarios.

## Branches & commits
- Keep commits focused and describe the what/why in the message.
- Rebase onto `main` before opening a pull request to minimize merge conflicts.
- Squash or tidy commits if requested by reviewers.

## Code expectations
- No `any` types; use `unknown` only when unavoidable and narrow it before use.
- Prefer `interface` for exported shapes and `import type` for type-only imports.
- Use Bun-native APIs when available; rely on Node built-ins (`node:crypto`, `node:events`) only as needed.
- Investigate unused-parameter lint warnings; remove truly unused params or refactor to make them necessary.
- Update documentation (`docs/`, `PLAN.md`, or `yapyap_mvp_stabilization_roadmap.md`) whenever you change core flows or architecture.

## Documentation and support
- Use GitHub issues for feature requests or bugs.
- Describe reproducible steps, expected vs actual behavior, and relevant log snippets when reporting problems.
- Update `README.md` if your change affects setup, CLI usage, or publishing guidance.

## Thank you
Meaningful contributions—code, docs, tests, ideas—are always appreciated. Please be patient with maintainers and help new contributors stay productive.
