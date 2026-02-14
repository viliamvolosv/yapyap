# YapYap Messenger v0.0.1

YapYap is a decentralized, peer-to-peer messenger node and CLI library built with Bun + TypeScript. It prioritizes reliable end-to-end encrypted delivery, offline/store-and-forward support, deduplication, and ACK-driven reliability inside a small-footprint CLI package (no UI) so other applications can embed YapYap as a dependency or run it as an executable.

## Key features
- Central `YapYapNode`/`MessageRouter` stack for message enqueue → transmit → receive → acknowledge → retry flows (see `docs/MESSAGE_FLOW.md`).
- Built on libp2p (TCP/WebSocket yamux transport, bootstrap + DHT discovery, autonat/relay fallbacks) with Noise XX/IK and Ed25519 for E2EE.
- SQLite-backed persistence (`message_queue`, `processed_messages`, replica tables) plus LRU dedup caches and replica-aware retries.
- CLI (`yapyap` binary) that ships `init`, `start`, `send`, `status`, `peers`, and HTTP API endpoints for automated control.

## Getting started
1. Install Bun 1.3+ and clone the repository: https://github.com/viliamvolosv/yapyap
2. Run `bun install` to populate dependencies (lockfile in `bun.lock`).
3. Build the project with `bun run build` and the CLI with `bun run build:cli` (or run `bun run build:all`).
4. Start the node locally via `bun dev` or run the CLI from `dist/` after building.

**Note:** This project uses Bun as the only runtime. No Node.js is required.

## Development workflows
- **Tests:** `bun test` (targets `.test.ts` files—Bun requires the `.test` suffix). Use `bun test path/to/file.test.ts` for focused runs.
- **Lint/format/typecheck:** `bun run lint`, `bun run format`, `bun run check`, `bun run typecheck` (Biome + TypeScript strict mode).
- **Integration suites:** `bash tests/integration/docker/run-basic-suite.sh` (default scenarios) or `bash tests/integration/docker/run.sh` for custom scenarios; the stack uses `tests/integration/docker/docker-compose.yml`.

## Documentation & roadmap
- `docs/MESSAGE_FLOW.md`: canonical message lifecycle, retry/backoff, database schema, and debugging commands.
- `PLAN.md`: architecture, protocols, CLI API, testing strategy, MVP readiness criteria, and roadmap.
- `yapyap_mvp_stabilization_roadmap.md`: step-by-step phases to reach MVP stability, including the checklist in section 13.
- **GitHub:** https://github.com/viliamvolosv/yapyap (issues and contributions)

## Contributing
- Keep TypeScript strict (`noImplicitAny`, no `any`, narrow `unknown` before use). Prefer interfaces for public APIs and `import type` when only types are needed.
- Use Bun-native APIs (`Bun.file`, `Bun.serve`, `Bun.password`) when available; fall back to Node (`node:crypto`, `node:events`) only if Bun lacks equivalent.
- Investigate lint warnings about unused parameters—either refactor or remove them rather than ignoring.
- Update `docs/` when core flows change and record major decisions in `PLAN.md` or `yapyap_mvp_stabilization_roadmap.md`.

## Version
Current version: **0.0.1** (MVP release)

## Publishing & release notes
- Build artifacts land in `dist/` for the `yapyap` binary and library exports (`package.json` points `dist/index.js`/`cli.js`).
- Keep dependencies in sync with `bun.lock` and rebuild Docker images before publishing (see `tests/integration/docker/Dockerfile.*`).
- The repository is MIT licensed (see `LICENSE`).
- See [CHANGELOG.md](CHANGELOG.md) for detailed release notes.

For deeper dives, consult the individual docs referenced above before contributing significant changes.
