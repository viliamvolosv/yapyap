# YapYap Refactor and Futureproofing Plan for AI Agents

## 1) Why this plan exists

This plan is designed for multiple AI coding agents (including less capable agents) to execute safely and consistently.

Current project state:
- Project compiles and tests pass (`typecheck`, `lint`, and full `npm test` passed during review).
- Core functionality exists and is tested, but structure is too monolithic in critical files.
- There are correctness and maintainability risks that can block safe long-term extension.

Business goal:
- Not an "ideal" architecture.
- A practical architecture with:
  - clear structure,
  - simple workflows,
  - safe extension points,
  - predictable refactor path.

## 2) Context summary from review

Observed codebase shape:
- TypeScript Node.js project with libp2p networking, message routing, API module, CLI, SQLite persistence.
- Very large multi-responsibility files:
  - `src/api/index.ts` (~1830 lines)
  - `src/message/message-router.ts` (~1493 lines)
  - `src/cli/index.ts` (~1215 lines)
  - `src/database/index.ts` (~1178 lines)
  - `src/core/node.ts` (~975 lines)
  - `src/network/NetworkModule.ts` (~914 lines)

Critical findings to address first:
1. API module performs `process.exit(...)` in handler path.
2. ACK validation path appears to use wrong fallback field.
3. Runtime schema definitions and runtime usage are out of sync.
4. Contact search query likely uses mismatched keying.
5. API includes stubbed endpoints that always return empty arrays.
6. Version drift between package version and OpenAPI version.

## 3) Scope and non-goals

In scope:
- Fix correctness risks and schema drift.
- Split monolith files into coherent modules.
- Establish boundaries and rules for future extensions.
- Add guardrails (tests + local quality gates + docs).

Out of scope:
- Full rewrite.
- New protocols/features not required for structural goals.
- Performance micro-optimizations unless tied to correctness or maintainability.

## 4) Constraints and engineering rules

All agents must follow these rules:
1. Keep behavior backward-compatible unless task explicitly says otherwise.
2. Prefer small change sets with one intent each.
3. Never combine structural refactor and behavior changes in one change set unless required.
4. If unsure, add test first, then change code.
5. Do not delete existing integration tests.
6. Keep strict TypeScript and existing lint standards.
7. No silent schema changes without explicit local validation strategy.
8. Testing-first gate is mandatory: no structural refactor starts before the test expansion gate is complete.
9. Test planning remains behavior-only and must not include refactor implementation details (see `docs/EXTENSIVE_TEST_PLAN.md`).
10. Core change test delta rule: any non-doc/core-code change in `src/core`, `src/message`, `src/database`, `src/network`, or `src/api` must include at least one updated/added test.
11. Execution workflow is local repository first (forks are optional). Do not require pull-request workflow to proceed.
12. Current alpha workflow does not depend on CI/CD automation. GitHub workflows are optional supplementary checks.

## 5) Target architecture (practical, not over-engineered)

Target layering:
1. `core`:
   - orchestration, lifecycle, domain coordination.
2. `network`:
   - transport, discovery, protocol stream handling.
3. `message`:
   - send/receive/retry/ack/relay logic.
4. `database`:
   - persistence API + schema + domain adapters.
5. `api`:
   - route handling + request validation + response mapping.
6. `cli`:
   - command UX only (calls API/core, minimal business logic).

Rule:
- Layer can depend only downward or on shared abstractions.
- No circular import dependencies.

## 6) Work decomposition by phase

---

### Phase 0: Coordination and baseline lock

Owner: Lead Agent (Coordinator)

Tasks:
1. Create branch: `refactor/structure-futureproof-v1`.
2. Create/update docs:
   - `docs/architecture/current-state.md`
   - `docs/architecture/target-state.md`
   - `docs/architecture/work-log.md`
3. Record baseline command results:
   - `npm run typecheck`
   - `npm run lint`
   - `npm test`
4. Establish local change log template for all sub-agents:
   - what changed,
   - why,
   - risks,
   - tests run,
   - schema impact (if any).

Acceptance criteria:
1. Baseline green and documented.
2. Work-log has ownership map per phase.

---

### Phase 1: Test expansion gate (must complete first)

Owner: Test Lead Agent + assigned test agents

Primary goals:
- Strengthen behavior contracts for existing code before any structural change.
- Ensure tests can detect regressions in core features.

Scope source:
- Execute and track `docs/EXTENSIVE_TEST_PLAN.md` (this plan is intentionally test-only and refactor-agnostic).

Tasks:
1. Complete contract inventory and missing tests matrix.
2. Implement P0 unit/stateful integration contract tests.
3. Implement P0 docker scenarios for reliability and persistence behavior.
4. Add/enable contract harness tests in local quality gates for core modules.
5. Record pass/fail metrics and flake baseline.
6. Expand docker integration harness stability:
   - stronger timeout handling,
   - deterministic scenario assertions,
   - automatic artifact capture for each scenario run.

Acceptance criteria:
1. All P0 test items from `docs/EXTENSIVE_TEST_PLAN.md` are implemented or explicitly deferred with issue links.
2. `npm test` and required integration subset pass consistently.
3. Core contract tests are wired into local quality gates.
4. Only after this phase is complete may structural refactor phases start.
5. Docker scenarios generate analyzable artifacts in `tests/integration/docker/results/artifacts/`.

---

### Phase 2: Immediate correctness and safety fixes

Owner: Agent A (Runtime Safety)

Primary goals:
- Remove unsafe process termination in reusable modules.
- Fix ACK validation bug candidate.
- Protect behavior with tests.

Tasks:
1. Replace direct `process.exit(...)` usage in API stop flow with lifecycle callback/event.
2. Ensure `/api/node/stop` returns "shutdown initiated" without force-killing host process.
3. Fix ACK validation fallback logic in router (`targetPeerId` derivation).
4. Add/adjust tests:
   - API stop behavior test
   - ACK validation cases:
     - direct ACK from target
     - relay ACK from expected replica
     - reject unknown ACK source

Potential files:
- `src/api/index.ts`
- `src/message/message-router.ts`
- `tests/unit/api/index.test.ts`
- `src/message/message-router.test.ts`

Acceptance criteria:
1. No process kill call from API request path.
2. ACK validation tests pass and cover edge cases.
3. All tests green.

Rollback:
- Revert only Phase 2 commits if regressions appear in stop flow or ACK handling.

---

### Phase 3: Database schema consistency (alpha mode)

Owner: Agent B (Persistence Reliability)

Primary goals:
- Keep runtime schema consistent with current code expectations.
- Avoid breaking existing local data directories.

Tasks:
1. Diff runtime schema definitions and actual runtime usage:
   - tables,
   - columns,
   - indexes.
2. Reconcile:
   - remove obsolete schema artifacts or keep with explicit compatibility notes.
   - include missing columns used by runtime (`ack_expected`, `ack_received_at`, `ttl` where required).
3. Add runtime schema doctor check on startup:
   - fail fast with actionable diagnostics on mismatch.
4. Add tests:
   - schema doctor positive/negative cases.

Potential files:
- `src/database/schema.ts`
- `src/database/index.ts`
- `tests/unit/database/*.test.ts` (new/additions)

Acceptance criteria:
1. Runtime schema and runtime usage are consistent by automated check.
2. Schema doctor reports actionable errors for mismatch.
3. Existing alpha local DB usage is not broken in core flows.

Rollback:
- Revert only schema changes from this phase if local DB flows regress.

---

### Phase 4: API contract completion and consistency

Owner: Agent C (API Contract)

Primary goals:
- Remove stub behavior from published endpoints.
- Align docs/spec with runtime.

Tasks:
1. Implement actual logic for:
   - `GET /api/database/messages`
   - `GET /api/database/routing`
2. Validate request/response shape consistency.
3. Sync OpenAPI version with package version automatically (single source of truth).
4. Add endpoint tests for:
   - empty state,
   - non-empty state,
   - response schema shape.

Potential files:
- `src/api/index.ts`
- `package.json` or shared version source utility
- `tests/unit/api/index.test.ts`

Acceptance criteria:
1. No intentional stub endpoints in production API.
2. OpenAPI version matches package version.
3. Endpoint tests cover both empty and populated DB.

---

### Phase 5: API module decomposition

Owner: Agent D (HTTP Structure)

Primary goals:
- Reduce `src/api/index.ts` into route modules and reusable utilities.

Target structure:
- `src/api/server.ts`
- `src/api/request.ts`
- `src/api/response.ts`
- `src/api/openapi.ts`
- `src/api/routes/node.ts`
- `src/api/routes/peer.ts`
- `src/api/routes/message.ts`
- `src/api/routes/database.ts`

Tasks:
1. Extract stateless helpers first.
2. Extract route handlers by domain.
3. Keep old class facade temporarily for compatibility.
4. Ensure no behavior change (tests should stay mostly unchanged).

Acceptance criteria:
1. `src/api/index.ts` becomes thin orchestrator (or compatibility export).
2. No route file exceeds ~300-350 lines.
3. All API tests remain green.

---

### Phase 6: Message router decomposition

Owner: Agent E (Messaging Domain)

Primary goals:
- Split router by responsibilities.

Target structure:
- `src/message/router/types.ts`
- `src/message/router/send.ts`
- `src/message/router/receive.ts`
- `src/message/router/retry.ts`
- `src/message/router/relay.ts`
- `src/message/router/rate-limit.ts`
- `src/message/router/vector-clock.ts`
- `src/message/router/index.ts`

Tasks:
1. Preserve current external API (`MessageRouter` class).
2. Move logic into composable internal modules.
3. Keep shared constants in one place.
4. Add targeted tests if extraction introduces edge risk.

Acceptance criteria:
1. `message-router.ts` no longer a monolith.
2. No functional regressions in existing router tests.
3. New module boundaries are explicit and documented.

---

### Phase 7: Core vs network boundary cleanup

Owner: Agent F (Orchestration Boundary)

Primary goals:
- Remove overlapping ownership between `YapYapNode` and `NetworkModule`.

Tasks:
1. Write ownership matrix:
   - protocol registration,
   - peer lifecycle events,
   - discovery,
   - health checks,
   - session triggers.
2. Consolidate ownership and remove duplicate handling.
3. Introduce clear interfaces/adapters where needed.

Potential files:
- `src/core/node.ts`
- `src/network/NetworkModule.ts`
- `src/core/protocols.ts` (if needed)

Acceptance criteria:
1. No duplicate protocol/event lifecycle paths.
2. Responsibilities documented and enforced by code shape.

---

### Phase 8: Type lifecycle hardening

Owner: Agent G (Type Safety)

Primary goals:
- Remove type-erasure lifecycle hacks.
- Make state transitions explicit.

Tasks:
1. Remove patterns like `undefined as unknown as ...`.
2. Introduce explicit nullable fields and guards.
3. Add lifecycle state enum for major services/modules.
4. Add tests for invalid state transitions.

Acceptance criteria:
1. No unsafe teardown casting.
2. Cleaner shutdown/startup semantics.
3. Typecheck remains green with strict settings.

---

### Phase 9: Observability and operational consistency

Owner: Agent H (Operational Quality)

Primary goals:
- Replace ad-hoc console logging with structured logger abstraction.

Tasks:
1. Create logger adapter interface and default implementation.
2. Replace direct logs in core/network/message/api modules.
3. Add correlation IDs for message flow where practical.
4. Ensure sensitive payload/key material is not logged.

Acceptance criteria:
1. Core modules use logger abstraction.
2. Debug logging remains available and controlled by configuration.

---

### Phase 10: Guardrails for future extensions

Owner: Agent I (Quality Gates)

Primary goals:
- Prevent architecture drift.

Tasks:
1. Add architecture checks:
   - max file size threshold warning/fail.
   - dependency direction checks.
   - schema/runtime sync check.
2. Local verification stages:
   - typecheck,
   - lint,
   - unit tests,
   - integration smoke,
   - schema doctor.
3. Optional GitHub workflow sync:
   - mirror the same local checks where useful, without making workflow status a hard dependency for local progress.
4. Write extension playbook:
   - how to add protocol,
   - how to add API endpoint,
   - how to add DB table/schema updates (alpha mode),
   - how to add CLI command.

Acceptance criteria:
1. Local quality gates block structural regressions.
2. New contributor can extend system via documented path.

## 7) Recommended Integration Sequence (Local Repo)

1. Step 1..N: Phase 1 test expansion gate deliverables from `docs/EXTENSIVE_TEST_PLAN.md`.
2. Next step: Phase 2 safety/correctness.
3. Next step: Phase 3 schema consistency.
4. Next step: Phase 4 API contract completion.
5. Next steps: Phases 5 and 6 decomposition (API and router).
6. Next step: Phase 7 boundary cleanup.
7. Next step: Phase 8 lifecycle/type hardening.
8. Next step: Phase 9 logging standardization.
9. Final step: Phase 10 local quality guardrails + extension playbook.

Rules:
- Do not start structural decomposition before Phase 1 (tests) is complete.
- Do not start large decomposition before schema and correctness issues are closed.
- If a behavior bug is found during decomposition, pause and add/adjust test first.

## 8) Agent execution template (mandatory for each task)

Each agent must include in output:
1. Task objective.
2. Files changed.
3. Behavioral impact.
4. Risk assessment.
5. Commands run:
   - typecheck,
   - lint,
   - tests relevant to scope.
6. Result summary:
   - pass/fail,
   - unresolved concerns.

## 9) Verification commands by phase (Local-first)

Global baseline:
```bash
npm run typecheck
npm run lint
npm test
```

Suggested focused runs:
```bash
# API-focused
npm test -- tests/unit/api/index.test.ts

# Message router-focused
npm test -- src/message/message-router.test.ts

# Database-focused
npm test -- src/database/*.test.ts tests/unit/database/*.test.ts
```

Integration smoke (when relevant):
```bash
npm run test:integration:docker
```

Optional supplementary GitHub workflow checks may mirror the same commands, but local verification remains the primary gate in current alpha stage.

## 10) Risks and mitigation

Risk 1: Refactor introduces hidden behavior regressions.
- Mitigation: keep behavior-preserving extraction PRs, rely on existing tests + add targeted tests before extraction.

Risk 2: Schema mismatch causes runtime DB failures in local environments.
- Mitigation: schema doctor and schema consistency tests.

Risk 3: Multiple agents create conflicting edits.
- Mitigation: strict phase ownership + file ownership + step sequencing.

Risk 4: Over-engineering slows delivery.
- Mitigation: enforce practical targets (clear modules, no framework rewrite).

## 11) Definition of done (project-level)

Project is considered futureproof enough when:
1. Critical correctness issues are fixed.
2. Runtime schema and runtime usage are consistent and checked.
3. Large monolith modules are split into clear domains.
4. API contracts are implemented (no stubs).
5. Lifecycle and typing are explicit and safe.
6. Logging and diagnostics are standardized.
7. Local quality gates enforce architecture and schema guardrails.
8. Extension playbook exists and is usable.

## 12) Minimal extension workflow after refactor

To add a new feature safely:
1. Update domain model/type in target layer.
2. Update schema and schema doctor checks (if persistence changes).
3. Implement business logic module.
4. Expose via API route and/or CLI.
5. Add unit tests + integration smoke.
6. Update OpenAPI and docs.
7. Run full quality gates.

This keeps future expansion linear and low-risk.
