# Changelog

All notable changes to the YapYap Messenger project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.1] - 2026-02-13

### Added
- Initial MVP release of YapYap Messenger
- Decentralized P2P messenger node and CLI library built with Bun + TypeScript
- End-to-end encrypted messaging with Ed25519 keys and Noise XX/IK protocols
- Offline/store-and-forward support with SQLite persistence
- Message routing with deduplication and ACK-driven reliability
- libp2p-based networking with TCP/WebSocket/WebRTC transports
- Bootstrap + DHT discovery with autonat/relay fallbacks
- CLI with commands: init, start, send, status, peers
- HTTP API endpoints for automated control
- Integration tests with Docker Compose
- CI/CD pipelines with GitHub Actions
- Project documentation (README, CONTRIBUTING, PLAN.md roadmap)

### Security
- Implemented Ed25519 for key generation and signing
- Noise XX/IK encryption protocols for transport security
- No hardcoded secrets in configuration files

### Known Limitations
- MVP focused on basic P2P messaging functionality
- Limited test coverage for edge cases
- No built-in UI (command-line only)
- No multi-device synchronization
- Limited offline delivery guarantees (basic store-and-forward)