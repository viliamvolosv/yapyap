# YapYap Core Stability Test Expansion Plan (Contract-First)

## 1) Objective
Build a test system that defines correct and incorrect behavior of YapYap, not just current implementation details. Tests must protect core features and keep the project in a reliable working state as code evolves.

Primary focus areas:
- End-to-end message behavior
- Data persistence and recovery
- Encryption/decryption and crypto/session guarantees
- Module-level contracts and full-module integration behavior

## 2) Non-Negotiable Test Principles
1. Test externally observable behavior (API, module contracts, stored state transitions), not private internals.
2. Each test must include at least one negative path (what must fail or be rejected).
3. Every stateful flow must assert invariants before/after restart.
4. Every reliability test must assert eventual outcome and intermediate state transitions.
5. Any bug fix must include a regression test first.
6. Use deterministic data and explicit time control where possible (avoid flaky wall-clock assumptions).
7. Name tests in Given/When/Then form.

## 3) Current Baseline (from repository scan)
Existing strong areas:
- Crypto primitives and E2E helpers: `src/crypto/*.test.ts`
- Session manager: `src/crypto/session-manager*.test.ts`
- Message router behavioral tests: `src/message/message-router.test.ts`
- Database dedup/sequence/persistence basics: `src/database/dedup-sequence.test.ts`
- Handshake/sync protocol basics: `src/protocols/*.test.ts`
- Unit API/core/network coverage in `tests/unit/**`
- Docker integration scenarios in `tests/integration/docker/scenarios/**`

Main gaps to close:
- Contract tests for untested protocol modules (`framing.ts`, `route.ts`, `error-handler.ts`)
- Strong negative-path crypto tests (tamper, wrong identity, malformed payload fields)
- Persistence crash/restart semantics under in-flight retry/replica-ack flows
- Deterministic E2E assertions for ordering, dedup, TTL expiry, replay rejection, and multi-hop recovery
- Search/metadata/domain DB consistency tests through `StorageModule`
- Schema consistency checks for current alpha database shape

## 4) Target Test Architecture
1. Fast unit contract tests (`src/**/*.test.ts`, `tests/unit/**`)
2. Stateful integration tests (real `DatabaseManager`, `MessageRouter`, and `YapYapNode` with mocked network boundaries)
3. Docker E2E scenario tests (multi-node, disruption, restart, cross-network)
4. Resilience suite (soak/retry/recovery under failures)

Quality gates by layer:
- Unit: deterministic, <2s per file, no network
- Stateful integration: deterministic with bounded waits
- Docker E2E: scenario-driven assertions on delivery, encryption, persistence, recovery
- Resilience: bounded runtime, produces failure artifact logs

Docker integration stability requirements:
1. Each scenario must have bounded timeout and deterministic pass/fail criteria.
2. Retry logic in test harness should handle transient startup delays (without hiding real failures).
3. Each scenario run must emit artifacts for post-failure analysis.
4. Failure reports must include:
   - scenario name,
   - exit status,
   - controller result file (if present),
   - per-service docker logs,
   - compose `ps` snapshot.

## 5) Work Breakdown for Less-Capable Agents
Execute in order. Do not skip phases.

## Phase A: Contract Inventory + Missing Tests Matrix
Deliverable: `docs/test-contract-matrix.md`

Steps:
1. Enumerate public functions/classes in each module:
   - `src/message/message-router.ts`
   - `src/crypto/index.ts`
   - `src/crypto/session-manager.ts`
   - `src/database/index.ts`
   - `src/storage/StorageModule.ts`
   - `src/protocols/{framing,route,error-handler,handshake,sync}.ts`
   - `src/core/node.ts`
2. For each public behavior, define:
   - success contract
   - failure contract
   - invariants
   - persistence expectation (if stateful)
3. Mark status: `covered`, `partially-covered`, `missing`.
4. Prioritize missing contracts by risk: `P0`, `P1`, `P2`.

Definition of done:
- Every exported behavior has a contract row.
- Every P0 row has an assigned future test file and owner.

## Phase B: P0 Contract Tests (unit + stateful integration)

### B1) Crypto/E2E negative-path suite
Files to add:
- `src/crypto/e2e-negative.test.ts`

Must cover:
1. Reject decrypt when ciphertext is tampered.
2. Reject decrypt when nonce is tampered.
3. Reject decrypt when signature is tampered.
4. Reject verify when sender key is wrong.
5. Reject deriveSharedSecret when key type is invalid.
6. Reject decrypt when payload missing required fields.
7. Ensure errors are explicit and stable enough for callers.

### B2) MessageRouter behavior-contract suite
Files to add:
- `src/message/message-router.contract.test.ts`

Must cover:
1. Send path requires recipient key and node keys; missing keys fails before transmit.
2. Receive duplicate message is idempotent (no double side effects/events).
3. Out-of-order sequence buffering flushes in correct order.
4. NAK schedules retry with bounded backoff and reason propagation.
5. ACK on non-pending message is safely ignored.
6. Replay of old vector clock does not regress local clock.
7. Fallback relay selection avoids blocked peers and excludes target peer.
8. Retry cleanup removes expired/terminal entries.

### B3) Database transactional and lifecycle contract suite
Files to add:
- `src/database/persistence-contract.test.ts`

Must cover:
1. `persistIncomingMessageAtomically` never applies partial updates.
2. Duplicate incoming message causes zero sequence/vector-clock side effects.
3. `queueMessage` upsert semantics preserve message_id uniqueness.
4. Retry scheduling increments attempts exactly once per schedule call.
5. Replica ack lifecycle (`assigned -> stored -> ack_expected -> ack_received`).
6. Cleanup deletes only expired/terminal rows.
7. LWW behavior for contacts/routing under equal timestamps.
8. Search index consistency after contact update/delete.

### B4) Protocol module coverage completion
Files to add:
- `src/protocols/framing.test.ts`
- `src/protocols/route.test.ts`
- `src/protocols/error-handler.test.ts`

Must cover:
1. Framing decode rejects truncated/oversized/invalid payloads.
2. Route announce signature validation and rejection paths.
3. Route query/result handling with missing fields and stale timestamps.
4. Error-handler wraps/normalizes unknown thrown values.

Definition of done for Phase B:
- All tests pass locally with `npm test`.
- No flaky waits; each async test has explicit timeout guard.
- New tests assert both positive and negative paths.

## Phase C: P0 End-to-End Messaging + Persistence + Crypto

Use Docker scenario flow plus assertion scripts.

Scenario files to add:
- `tests/integration/docker/scenarios/e2e-replay-attack.yml`
- `tests/integration/docker/scenarios/e2e-key-rotation.yml`
- `tests/integration/docker/scenarios/restart-during-retry.yml`
- `tests/integration/docker/scenarios/replica-ack-timeout-recovery.yml`
- `tests/integration/docker/scenarios/out-of-order-delivery.yml`

Behavioral assertions required:
1. E2E replay attack:
   - replayed encrypted envelope is rejected or deduplicated
   - no duplicate inbox append
2. Key rotation:
   - sender uses stale key -> failure
   - key refresh -> subsequent send succeeds
3. Restart during retry:
   - pending retry survives restart
   - message eventually delivered or terminally failed with reason
4. Replica ACK timeout recovery:
   - missing replica ack triggers alternate relay/recovery path
   - eventual delivery state and audit trail present
5. Out-of-order delivery:
   - receiver commits in sequence order
   - no sequence regression after reconnect

Definition of done for Phase C:
- `npm run test:integration:docker` passes with new scenarios integrated.
- Scenario logs contain deterministic pass/fail checks.
- Each scenario validates DB/API state, not just process liveness.
- Artifacts are produced per scenario under `tests/integration/docker/results/artifacts/<run-id>/<scenario>/`.

## Phase D: Core Behavior Contract Harness

Files to add:
- `tests/contracts/public-api.contract.test.ts`
- `tests/contracts/state-invariants.contract.test.ts`

Purpose:
- Freeze expected observable contracts so core behavior remains stable across ongoing development.

Must include invariants:
1. Message ID uniqueness and idempotency on receive.
2. Monotonic per-peer sequence tracking.
3. Non-decreasing vector clocks.
4. No plaintext persistence for encrypted payloads (except allowed metadata).
5. ACK/NAK state transitions remain valid and terminal states are terminal.

Definition of done:
- Contract suite is required before integrating any core code changes (`src/message`, `src/database`, `src/api`, `src/core`, `src/network`) into the main local branch.

## 6) Test Design Templates (mandatory)

Use this template per new test case:
- Name: `Given <state>, When <action>, Then <expected behavior>`
- Type: `unit | integration | docker-e2e | contract`
- Risk: `P0 | P1 | P2`
- Preconditions
- Stimulus
- Assertions:
  - primary observable result
  - secondary state transitions
  - forbidden outcomes
- Failure diagnostics:
  - what logs/state to print if it fails

## 7) Coding Rules for Agents
1. Reuse helpers in `tests/helpers/test-utils.ts` for waits/timeouts.
2. Prefer real `DatabaseManager` over deep mocking for persistence behavior.
3. Keep mock boundaries only at network transport or external process boundaries.
4. Avoid random data unless seeded and printed.
5. Keep each test independent; no global mutable shared state.
6. Every bug reproduction test must fail before fix and pass after fix.
7. Test fixtures must be deterministic:
   - fixed IDs, timestamps, peer IDs, and payload samples;
   - no non-deterministic assertions based on wall-clock drift unless bounded;
   - if randomness is necessary, use explicit seed and print it in failure diagnostics.

## 8) Suggested Execution Order and Ownership
1. Agent 1: Phase A matrix + protocol coverage completion (B4)
2. Agent 2: Crypto/message-router contracts (B1/B2)
3. Agent 3: Database + storage contract suite (B3)
4. Agent 4: Docker E2E scenarios (Phase C)
5. Agent 5: Contract harness + cleanup of flaky tests (Phase D)

## 9) Local Quality Gates (Current Alpha Workflow)
Project policy for now:
1. Primary development/testing is local machine first.
2. GitHub workflows may run, but are supplementary and not the core gate mechanism.
3. No dependency on external CI/CD automation for daily progress.

Required local checks before integrating changes:
1. `npm run typecheck`
2. `npm run lint`
3. `npm test`
4. Relevant docker scenario subset for changed area (when integration behavior is affected).
5. Validate that docker scenario artifacts were generated and attached to run summary when failures happen.

Stability checks:
1. Re-run critical suites to detect flakes on the same commit.
2. Store scenario logs locally for failed runs and attach to task summary.
3. For flaky docker scenarios, compare artifacts from at least two failing runs before changing assertions.

## 10) Metrics to Track Weekly
1. Contract coverage ratio (`covered / total contracts` from matrix).
2. P0 missing contracts count.
3. Flake rate by suite.
4. Mean time to detect regression in messaging pipeline.
5. Number of regressions caught by contract tests before merge.

## 11) Immediate Next Tasks (first sprint)
1. Create `docs/test-contract-matrix.md`.
2. Implement `src/crypto/e2e-negative.test.ts`.
3. Implement `src/database/persistence-contract.test.ts`.
4. Add `tests/integration/docker/scenarios/restart-during-retry.yml`.
5. Wire new scenario into `tests/integration/docker/run-basic-suite.sh` as optional stage.

## 12) Scope Guard (important)
This document is intentionally limited to testing current and expected behavior of existing core features.

It must not include:
1. Structural refactor roadmap.
2. Module split strategy.
3. File move plans.
4. Dependency or layering redesign notes.

Those belong in architecture/refactor planning documents only.
