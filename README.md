# YapYap Messenger

YapYap is a decentralized, peer-to-peer messenger node and CLI library built with Node.js + TypeScript. It prioritizes reliable end-to-end encrypted delivery, offline/store-and-forward support, deduplication, and ACK-driven reliability inside a small-footprint CLI package (no UI) so other applications can embed YapYap as a dependency or run it as an executable.

## Key features
- Central `YapYapNode`/`MessageRouter` stack for message enqueue → transmit → receive → acknowledge → retry flows (see `docs/MESSAGE_FLOW.md`).
- Built on libp2p (TCP/WebSocket yamux transport, bootstrap + DHT discovery, autonat/relay fallbacks) with Noise XX/IK and Ed25519 for E2EE.
- SQLite-backed persistence using `better-sqlite3` (`message_queue`, `processed_messages`, replica tables) plus LRU dedup caches and replica-aware retries.
- CLI (`yapyap` binary) that ships `init`, `start`, `send`, `status`, `peers`, and HTTP API endpoints for automated control.

## Getting started

### Quick install (recommended)
```bash
curl -fsSL https://viliamvolosv.github.io/yapyap/install.sh | bash
```

Or use the installer with specific options:
```bash
# Install via npm (default)
curl -fsSL https://viliamvolosv.github.io/yapyap/install.sh | bash -s -- --no-onboard

# Install from GitHub source
curl -fsSL https://viliamvolosv.github.io/yapyap/install.sh | bash -s -- --method github --no-onboard
```

### Manual install
1. Install Node.js 22.12+ and clone the repository: https://github.com/viliamvolosv/yapyap
2. Run `npm install` to populate dependencies.
3. Build the project with `npm run build:all` (creates `dist/index.js` and `dist/cli.js`).
4. Start the node locally via `npm run dev` or run the CLI: `node dist/cli.js start`

**Requirements:** Node.js ≥22.12.0

## Development workflows
- **Tests:** `npm test` (uses Node.js native test runner with `tsx`). Test files use `.test.ts` suffix.
- **Lint/format/typecheck:** `npm run lint`, `npm run format`, `npm run check`, `npm run typecheck` (Biome + TypeScript).
- **Integration suites:** `bash tests/integration/docker/run-basic-suite.sh` (default scenarios) or `bash tests/integration/docker/run.sh` for custom scenarios using Docker Compose.
- **Build:** `npm run build:all` - Fast builds with esbuild (~10ms)

## Documentation & roadmap
- **Quick install:** Use the installer script: https://viliamvolosv.github.io/yapyap/install.sh
- **AGENT skill:** Get started quickly with `curl -s https://viliamvolosv.github.io/yapyap/skill.md | bash`
- **GitHub:** https://github.com/viliamvolosv/yapyap (issues and contributions)

## Contributing
- Keep TypeScript strict (`noImplicitAny`, no `any`, narrow `unknown` before use). Prefer interfaces for public APIs and `import type` when only types are needed.
- Use Node.js native APIs (`node:*` imports). The project uses `better-sqlite3` for SQLite, `ws` for WebSocket, and `esbuild` for bundling.
- Test files use Node's built-in test runner (`node:test`) with `assert` for assertions.
- Investigate lint warnings about unused parameters—either refactor or remove them rather than ignoring.

## Publishing & release notes
- Build artifacts land in `dist/` for the `yapyap` CLI and library exports (`package.json` points to `dist/index.js`/`cli.js`).
- Dependencies managed via `package-lock.json` and npm.
- Docker images use `node:22-alpine` base (see `tests/integration/docker/Dockerfile.*`).
- The repository is MIT licensed (see `LICENSE`).
- See [CHANGELOG.md](CHANGELOG.md) for detailed release notes.

For deeper dives, consult the individual docs referenced above before contributing significant changes.
