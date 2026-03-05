# Agent Team Execution Plan (Tests + Refactor) for `v0.1.0`

## 1) Objective
Deliver a stable branch `v0.1.0` with:
1. Expanded, reliable tests for existing core behavior.
2. Safe refactor based on test protection.
3. Robust Docker integration artifacts for analysis.

Execution model:
1. Multi-agent team.
2. `git worktree` per agent.
3. Gitflow branching model.

---

## 2) Team Roles

## Role A: Release Coordinator (1 agent)
Responsibilities:
1. Initialize Gitflow branches and worktree layout.
2. Assign tasks, freeze scope, manage integration order.
3. Run integration checks on `develop`, `release/0.1.0`, and `v0.1.0`.
4. Resolve conflicts and control merges.

## Role B: Test Architecture Lead (1 agent)
Responsibilities:
1. Own contract matrix and test coverage map.
2. Enforce deterministic fixture rules.
3. Define test acceptance criteria for each feature area.

## Role C: Core Test Agents (3 agents)
Responsibilities:
1. Crypto/session negative-path tests.
2. Message router contract tests.
3. Database/storage/state invariants tests.

## Role D: Docker Integration Agents (2 agents)
Responsibilities:
1. Expand Docker scenarios.
2. Harden Docker test runner robustness.
3. Validate and maintain artifact collection format.

## Role E: Refactor Agents (3 agents)
Responsibilities:
1. API decomposition.
2. Message router decomposition.
3. Core/network boundary cleanup + lifecycle typing.

## Role F: Quality Gate Agent (1 agent)
Responsibilities:
1. Local quality scripts and guardrails.
2. Optional GitHub workflow sync (non-blocking for local progress).

---

## 3) Branching Model (Gitflow + target branch)

Required long-lived branches:
1. `main`
2. `develop`

Release branches:
1. `release/0.1.0`

Final delivery branch:
1. `v0.1.0` (target result branch requested by product owner)

Feature branch conventions:
1. `feature/tests-contract-matrix`
2. `feature/tests-crypto-negative`
3. `feature/tests-message-router-contracts`
4. `feature/tests-db-contracts`
5. `feature/tests-docker-scenarios`
6. `feature/tests-docker-harness`
7. `feature/refactor-api-split`
8. `feature/refactor-router-split`
9. `feature/refactor-core-network-boundary`
10. `feature/refactor-lifecycle-typing`
11. `feature/quality-local-gates`

Hotfix branch convention (if needed):
1. `hotfix/<issue-id>-<short-name>`

---

## 4) Worktree Strategy

Each agent works in a dedicated worktree to avoid branch switching conflicts.

Recommended layout (example):
1. `/Users/viliamvolosv/Code/BeepBoop` -> coordinator worktree
2. `/Users/viliamvolosv/Code/BeepBoop-wt-test-arch`
3. `/Users/viliamvolosv/Code/BeepBoop-wt-test-crypto`
4. `/Users/viliamvolosv/Code/BeepBoop-wt-test-router`
5. `/Users/viliamvolosv/Code/BeepBoop-wt-test-db`
6. `/Users/viliamvolosv/Code/BeepBoop-wt-docker-scenarios`
7. `/Users/viliamvolosv/Code/BeepBoop-wt-docker-harness`
8. `/Users/viliamvolosv/Code/BeepBoop-wt-refactor-api`
9. `/Users/viliamvolosv/Code/BeepBoop-wt-refactor-router`
10. `/Users/viliamvolosv/Code/BeepBoop-wt-refactor-core`
11. `/Users/viliamvolosv/Code/BeepBoop-wt-quality`

---

## 5) Bootstrap Commands (Coordinator)

Run once from repository root:

```bash
# Ensure local state
git fetch --all --prune

# Ensure develop exists from main
git checkout main
git pull --ff-only
git checkout -B develop main

# Create feature branches (no checkout in main worktree)
git branch feature/tests-contract-matrix develop
git branch feature/tests-crypto-negative develop
git branch feature/tests-message-router-contracts develop
git branch feature/tests-db-contracts develop
git branch feature/tests-docker-scenarios develop
git branch feature/tests-docker-harness develop
git branch feature/refactor-api-split develop
git branch feature/refactor-router-split develop
git branch feature/refactor-core-network-boundary develop
git branch feature/refactor-lifecycle-typing develop
git branch feature/quality-local-gates develop
```

Create worktrees:

```bash
git worktree add ../BeepBoop-wt-test-arch feature/tests-contract-matrix
git worktree add ../BeepBoop-wt-test-crypto feature/tests-crypto-negative
git worktree add ../BeepBoop-wt-test-router feature/tests-message-router-contracts
git worktree add ../BeepBoop-wt-test-db feature/tests-db-contracts
git worktree add ../BeepBoop-wt-docker-scenarios feature/tests-docker-scenarios
git worktree add ../BeepBoop-wt-docker-harness feature/tests-docker-harness
git worktree add ../BeepBoop-wt-refactor-api feature/refactor-api-split
git worktree add ../BeepBoop-wt-refactor-router feature/refactor-router-split
git worktree add ../BeepBoop-wt-refactor-core feature/refactor-core-network-boundary
git worktree add ../BeepBoop-wt-quality feature/quality-local-gates
```

---

## 6) Mandatory Rules for All Agents

1. Test-first rule:
   - No structural refactor work starts before test gate completion.
2. Core change test delta rule:
   - Any code change in `src/core`, `src/message`, `src/database`, `src/network`, `src/api` must include at least one updated or new test.
3. Deterministic fixtures only:
   - fixed IDs/timestamps/peer IDs/payload fixtures.
4. No destructive git commands.
5. No force-push to shared branches.
6. Commit scope must be single-intent.
7. Every task summary must include commands run and outcome.

---

## 7) Execution Phases

## Phase 1: Testing Gate (blocker for refactor)

Owners:
1. Test Architecture Lead
2. Core Test Agents
3. Docker Integration Agents

Deliverables:
1. Contract matrix document.
2. P0 unit + integration contract suites.
3. Expanded Docker scenarios.
4. Hardened Docker harness + artifacts.

Required local checks:
```bash
npm run typecheck
npm run lint
npm test
bash tests/integration/docker/run-basic-suite.sh
```

Artifact requirement:
1. Docker runs must populate:
   - `tests/integration/docker/results/artifacts/<run-id>/<scenario>/`

Phase 1 exit criteria:
1. All planned P0 tests merged to `develop`.
2. Repeated local runs are stable.
3. Artifact output is complete and analyzable.

## Phase 2: Safe Refactor

Owners:
1. Refactor Agents
2. Quality Gate Agent

Work order:
1. API split.
2. Message router split.
3. Core/network boundary cleanup.
4. Lifecycle/type hardening.
5. Local quality guardrails.

Refactor guard:
1. No behavior change unless test-covered.
2. Re-run affected suites after each merge.

Phase 2 exit criteria:
1. `develop` remains green with full local checks.
2. No regression in Docker scenario pass set.

---

## 8) Integration Flow (Gitflow)

For each feature branch:
1. Agent commits in own worktree.
2. Coordinator rebases feature branch onto latest `develop`.
3. Coordinator runs local validation in that worktree.
4. Coordinator merges into `develop` with `--no-ff`.

Example:
```bash
git checkout develop
git pull --ff-only
git checkout feature/tests-crypto-negative
git rebase develop
npm run typecheck && npm run lint && npm test
git checkout develop
git merge --no-ff feature/tests-crypto-negative -m "merge: tests crypto negative paths"
```

---

## 9) Release Assembly for `v0.1.0`

When `develop` is stable:

```bash
git checkout develop
git pull --ff-only
git checkout -B release/0.1.0 develop

# Final stabilization checks
npm run typecheck
npm run lint
npm test
bash tests/integration/docker/run-basic-suite.sh
```

If stable:

```bash
# keep Gitflow convention
git checkout main
git merge --no-ff release/0.1.0 -m "release 0.1.0"
git checkout develop
git merge --no-ff release/0.1.0 -m "back-merge release 0.1.0"

# requested target result branch
git checkout -B v0.1.0 release/0.1.0
```

Optional tag:
```bash
git tag -a v0.1.0 -m "v0.1.0"
```

---

## 10) Conflict Resolution Protocol

1. If 2 features touch same files:
   - merge smaller/riskier test branch first.
   - rebase second branch and re-run all affected tests.
2. If test and refactor conflict:
   - preserve test intent first.
   - adapt refactor code to satisfy contracts.
3. If Docker scenario becomes flaky:
   - do not skip silently.
   - compare at least two artifact runs.
   - fix harness/assertions before continuing.

---

## 11) Required Daily Report per Agent

Template:
1. Branch + worktree path.
2. Files changed.
3. Commands executed.
4. Pass/fail summary.
5. Artifact path(s) if Docker tests run.
6. Risks/blockers.
7. Next task.

---

## 12) Done Criteria for `v0.1.0`

1. Branch `v0.1.0` exists from stabilized `release/0.1.0`.
2. Test expansion implemented and stable.
3. Refactor completed without core regressions.
4. Docker integration suite runs robustly.
5. Artifact collection works for all Docker scenarios.
6. Local quality checks pass on final branch.

---

## 13) Parallel vs Sequential Execution Map

This section explicitly defines what can run in parallel and what is blocked by dependencies.

Legend:
1. `PARALLEL`: can run at same time as other listed tasks.
2. `SEQUENTIAL`: must wait for prerequisite completion.
3. `GATE`: hard stop for downstream tasks.

### 13.1 Hard Gates (Sequential)

1. Gate G0: Workspace/bootstrap ready
   - Must complete before any feature task.
   - Includes: `develop` creation, feature branches, worktrees.

2. Gate G1: Test Expansion Gate complete (`Phase 1`)
   - Must complete before any structural refactor work (`Phase 2`).
   - Includes P0 tests + Docker artifact validation.

3. Gate G2: Release stabilization
   - Must complete before creating/updating `v0.1.0`.
   - Includes final full local validation on `release/0.1.0`.

### 13.2 Phase 1 (Testing Gate) Dependency Matrix

Task T1: Contract Matrix (`feature/tests-contract-matrix`)
1. Type: `SEQUENTIAL` start task.
2. Prereq: G0.
3. Blocks: T2, T3, T4, T5, T6.

Task T2: Crypto negative tests (`feature/tests-crypto-negative`)
1. Type: `PARALLEL`.
2. Prereq: T1.
3. Can run with: T3, T4, T5, T6.

Task T3: Message-router contracts (`feature/tests-message-router-contracts`)
1. Type: `PARALLEL`.
2. Prereq: T1.
3. Can run with: T2, T4, T5, T6.

Task T4: DB/state contracts (`feature/tests-db-contracts`)
1. Type: `PARALLEL`.
2. Prereq: T1.
3. Can run with: T2, T3, T5, T6.

Task T5: Docker scenario expansion (`feature/tests-docker-scenarios`)
1. Type: `PARALLEL`.
2. Prereq: T1.
3. Can run with: T2, T3, T4, T6.
4. Note: avoid editing same scenario files concurrently with T6.

Task T6: Docker harness hardening (`feature/tests-docker-harness`)
1. Type: `PARALLEL`.
2. Prereq: T1.
3. Can run with: T2, T3, T4, T5.
4. Note: coordinate with T5 for shared script files.

Task T7: Local gate scripts (`feature/quality-local-gates`)
1. Type: `SEQUENTIAL-INTEGRATION`.
2. Prereq: T2 + T3 + T4 + T5 + T6 merged to `develop`.
3. Output: test gate status report for G1.

Gate G1 pass condition:
1. T1..T7 complete.
2. `develop` passes:
   - `npm run typecheck`
   - `npm run lint`
   - `npm test`
   - `bash tests/integration/docker/run-basic-suite.sh`

### 13.3 Phase 2 (Refactor) Dependency Matrix

Task R1: API split (`feature/refactor-api-split`)
1. Type: `PARALLEL`.
2. Prereq: G1.
3. Can run with: R2, R3, R4.

Task R2: Router split (`feature/refactor-router-split`)
1. Type: `PARALLEL`.
2. Prereq: G1.
3. Can run with: R1, R3, R4.

Task R3: Core/network boundary (`feature/refactor-core-network-boundary`)
1. Type: `PARALLEL` with caution.
2. Prereq: G1.
3. Can run with: R1, R2, R4.
4. Conflict risk: high with R2; integrate in smaller commits.

Task R4: Lifecycle typing hardening (`feature/refactor-lifecycle-typing`)
1. Type: `PARALLEL`.
2. Prereq: G1.
3. Can run with: R1, R2, R3.
4. Preferred to start after first integration of R1/R2 to reduce churn.

Task R5: Refactor integration sweep (Coordinator)
1. Type: `SEQUENTIAL-INTEGRATION`.
2. Prereq: R1 + R2 + R3 + R4 merged to `develop`.
3. Required checks:
   - full local checks
   - docker suite + artifact inspection.

### 13.4 Release and Target Branch (Sequential)

Task L1: Create `release/0.1.0`
1. Type: `SEQUENTIAL`.
2. Prereq: R5 complete.

Task L2: Stabilization fixes on `release/0.1.0` (if needed)
1. Type: `SEQUENTIAL`.
2. Prereq: L1.
3. Rule: only fixes, no new scope.

Task L3: Finalize target branch `v0.1.0`
1. Type: `SEQUENTIAL`.
2. Prereq: L2 pass checks.

### 13.5 Merge Windows (to reduce conflicts)

Use merge windows to keep parallel work safe:
1. Window W1: Merge all test branches (T2..T6) in batches, then run T7.
2. Window W2: Freeze test branch merges; start refactor branches (R1..R4).
3. Window W3: Merge refactor branches one-by-one with full rerun of affected suites.
4. Window W4: Release stabilization only.

### 13.6 Branch Start Conditions (quick reference)

1. `feature/tests-contract-matrix`: start after G0.
2. `feature/tests-crypto-negative`: start after T1.
3. `feature/tests-message-router-contracts`: start after T1.
4. `feature/tests-db-contracts`: start after T1.
5. `feature/tests-docker-scenarios`: start after T1.
6. `feature/tests-docker-harness`: start after T1.
7. `feature/quality-local-gates`: start after T2..T6 merged.
8. `feature/refactor-api-split`: start after G1.
9. `feature/refactor-router-split`: start after G1.
10. `feature/refactor-core-network-boundary`: start after G1.
11. `feature/refactor-lifecycle-typing`: start after G1.

---

## 14) Recommended Parallel Team Schedule

Wave 1 (parallel):
1. Test Architecture Lead: T1.

Wave 2 (parallel after T1):
1. Core Test Agent 1: T2.
2. Core Test Agent 2: T3.
3. Core Test Agent 3: T4.
4. Docker Agent 1: T5.
5. Docker Agent 2: T6.

Wave 3 (sequential integration):
1. Quality Gate Agent + Coordinator: T7 and G1 validation.

Wave 4 (parallel refactor after G1):
1. Refactor Agent 1: R1.
2. Refactor Agent 2: R2.
3. Refactor Agent 3: R3 + R4 (split into small commits).

Wave 5 (sequential):
1. Coordinator: R5, L1, L2, L3.
