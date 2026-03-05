# Agent Team Organization for v0.1.0

## Team Structure Overview

This document defines the multi-agent team structure for the v0.1.0 release execution plan.

## Team Members & Roles

### 1. Release Coordinator (You)
**Worktree:** `/Users/viliamvolosv/Code/BeepBoop`
**Branch:** `release/0.1.0`
**Responsibilities:**
- Initialize Gitflow branches and worktree layout ✅ DONE
- Assign tasks, freeze scope, manage integration order
- Run integration checks on `develop`, `release/0.1.0`, and `v0.1.0`
- Resolve conflicts and control merges
- Execute integration sweeps (R5, L1, L2, L3)

### 2. Test Architecture Lead
**Worktree:** `/Users/viliamvolosv/Code/BeepBoop-wt-test-arch`
**Branch:** `feature/tests-contract-matrix`
**Responsibilities:**
- Own contract matrix and test coverage map
- Enforce deterministic fixture rules
- Define test acceptance criteria for each feature area
- **Current Task:** Create contract matrix document

### 3. Core Test Agent 1 - Crypto Tests
**Worktree:** `/Users/viliamvolosv/Code/BeepBoop-wt-test-crypto`
**Branch:** `feature/tests-crypto-negative`
**Responsibilities:**
- Crypto/session negative-path tests
- Edge case testing for cryptographic operations

### 4. Core Test Agent 2 - Message Router Tests
**Worktree:** `/Users/viliamvolosv/Code/BeepBoop-wt-test-router`
**Branch:** `feature/tests-message-router-contracts`
**Responsibilities:**
- Message router contract tests
- Routing contract validation

### 5. Core Test Agent 3 - Database Tests
**Worktree:** `/Users/viliamvolosv/Code/BeepBoop-wt-test-db`
**Branch:** `feature/tests-db-contracts`
**Responsibilities:**
- Database/storage/state invariants tests
- Schema integrity and transaction tests

### 6. Docker Integration Agent 1 - Scenarios
**Worktree:** `/Users/viliamvolosv/Code/BeepBoop-wt-docker-scenarios`
**Branch:** `feature/tests-docker-scenarios`
**Responsibilities:**
- Expand Docker scenarios
- Scenario coverage for integration tests

### 7. Docker Integration Agent 2 - Harness
**Worktree:** `/Users/viliamvolosv/Code/BeepBoop-wt-docker-harness`
**Branch:** `feature/tests-docker-harness`
**Responsibilities:**
- Harden Docker test runner robustness
- Artifact collection format validation

### 8. Refactor Agent 1 - API Split
**Worktree:** `/Users/viliamvolosv/Code/BeepBoop-wt-refactor-api`
**Branch:** `feature/refactor-api-split`
**Responsibilities:**
- API decomposition
- API boundary cleanup

### 9. Refactor Agent 2 - Router Split
**Worktree:** `/Users/viliamvolosv/Code/BeepBoop-wt-refactor-router`
**Branch:** `feature/refactor-router-split`
**Responsibilities:**
- Message router decomposition
- Router boundary cleanup

### 10. Refactor Agent 3 - Core Network
**Worktree:** `/Users/viliamvolosv/Code/BeepBoop-wt-refactor-core`
**Branch:** `feature/refactor-core-network-boundary`
**Responsibilities:**
- Core/network boundary cleanup
- Lifecycle typing

### 11. Quality Gate Agent
**Worktree:** `/Users/viliamvolosv/Code/BeepBoop-wt-quality`
**Branch:** `feature/quality-local-gates`
**Responsibilities:**
- Local quality scripts and guardrails
- Test gate status reporting
- Build/test/lint automation

## Branching Model

### Long-lived Branches
- `main` - Production branch
- `develop` - Integration branch
- `release/0.1.0` - Release candidate branch (current)

### Feature Branches (all based on release/0.1.0)
1. `feature/tests-contract-matrix` - Contract matrix
2. `feature/tests-crypto-negative` - Crypto tests
3. `feature/tests-message-router-contracts` - Router tests
4. `feature/tests-db-contracts` - DB tests
5. `feature/tests-docker-scenarios` - Docker scenarios
6. `feature/tests-docker-harness` - Docker harness
7. `feature/refactor-api-split` - API refactor
8. `feature/refactor-router-split` - Router refactor
9. `feature/refactor-core-network-boundary` - Core refactor
10. `feature/refactor-lifecycle-typing` - Lifecycle typing
11. `feature/quality-local-gates` - Quality guards

### Target Branch
- `v0.1.0` - Final delivery branch (to be created after stabilization)

## Worktree Locations

```
/Users/viliamvolosv/Code/BeepBoop                                    (Coordinator)
/Users/viliamvolosv/Code/BeepBoop-wt-test-arch                      (Test Arch Lead)
/Users/viliamvolosv/Code/BeepBoop-wt-test-crypto                    (Crypto Tests)
/Users/viliamvolosv/Code/BeepBoop-wt-test-router                    (Router Tests)
/Users/viliamvolosv/Code/BeepBoop-wt-test-db                        (DB Tests)
/Users/viliamvolosv/Code/BeepBoop-wt-docker-scenarios              (Docker Scenarios)
/Users/viliamvolosv/Code/BeepBoop-wt-docker-harness                (Docker Harness)
/Users/viliamvolosv/Code/BeepBoop-wt-refactor-api                  (API Refactor)
/Users/viliamvolosv/Code/BeepBoop-wt-refactor-router                (Router Refactor)
/Users/viliamvolosv/Code/BeepBoop-wt-refactor-core                  (Core Refactor)
/Users/viliamvolosv/Code/BeepBoop-wt-quality                        (Quality Gate)
```

## Execution Phases

### Phase 1: Testing Gate (Current)
**Status:** In Progress
**Gate G0:** Workspace/bootstrap ready ✅ DONE
**Gate G1:** Test Expansion Gate (pending)

**Tasks:**
- T1: Contract Matrix (Test Architecture Lead) - **START NOW**
- T2: Crypto negative tests (PARALLEL with T3, T4, T5, T6)
- T3: Message-router contracts (PARALLEL with T2, T4, T5, T6)
- T4: DB/state contracts (PARALLEL with T2, T3, T5, T6)
- T5: Docker scenario expansion (PARALLEL with T2, T3, T4, T6)
- T6: Docker harness hardening (PARALLEL with T2, T3, T4, T5)
- T7: Local gate scripts (SEQUENTIAL - after T2..T6 merged)

### Phase 2: Safe Refactor (Blocked by G1)
**Status:** Pending
**Gate G1:** Must pass before Phase 2 starts

**Tasks:**
- R1: API split (PARALLEL with R2, R3, R4)
- R2: Router split (PARALLEL with R1, R3, R4)
- R3: Core/network boundary (PARALLEL with caution)
- R4: Lifecycle typing hardening (PARALLEL)
- R5: Refactor integration sweep (SEQUENTIAL - after R1..R4 merged)

### Phase 3: Release Assembly (Blocked by R5)
**Status:** Pending

**Tasks:**
- L1: Create `release/0.1.0` (SEQUENTIAL)
- L2: Stabilization fixes (SEQUENTIAL)
- L3: Finalize target branch `v0.1.0` (SEQUENTIAL)

## Mandatory Rules

1. **Test-first rule:** No structural refactor work before test gate completion
2. **Core change test delta rule:** Any code change in `src/core`, `src/message`, `src/database`, `src/network`, `src/api` must include at least one updated or new test
3. **Deterministic fixtures only:** Fixed IDs/timestamps/peer IDs/payload fixtures
4. **No destructive git commands:** Only safe, reversible operations
5. **No force-push to shared branches**
6. **Commit scope must be single-intent**
7. **Every task summary must include commands run and outcome**

## Daily Report Template

Each agent must provide:
1. Branch + worktree path
2. Files changed
3. Commands executed
4. Pass/fail summary
5. Artifact path(s) if Docker tests run
6. Risks/blockers
7. Next task

## Integration Flow

For each feature branch:
1. Agent commits in own worktree
2. Coordinator rebases feature branch onto latest `develop`
3. Coordinator runs local validation in that worktree
4. Coordinator merges into `develop` with `--no-ff`

## Conflict Resolution Protocol

1. If 2 features touch same files: merge smaller/riskier test branch first
2. If test and refactor conflict: preserve test intent first
3. If Docker scenario becomes flaky: compare artifact runs, fix before continuing

---

**Current Status:** G0 Complete. Ready to start Phase 1, Task T1 (Contract Matrix).