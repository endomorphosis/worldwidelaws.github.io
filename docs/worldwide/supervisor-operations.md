# Worldwide legal search supervisor operations

The campaign uses the native `DatabaseImplementationDaemon` with real Portal implementation, validation and merge callbacks. The website and framework have separate campaign branches. The embedded DuckDB store has one process owner; monitors read atomic projections and submit scoped control requests rather than opening its live database.

The host configuration is `config/worldwide_supervisor_host.json`. The operational framework is the isolated worktree at `/home/barberb/.local/state/ipfs_accelerate_py/worldwide-legal-search-v1/framework`; its source repository is `~/ipfs_accelerate_py`. State, private provider receipts and logs stay outside the website repository under `/home/barberb/.local/state/ipfs_accelerate_py/worldwide-legal-search-v1/campaign`.

Inspect current native progress and service health:

```bash
python3 -B scripts/worldwide_supervisor_host.py status
python3 -B scripts/worldwide_supervisor_host.py status --full
journalctl --user -u worldwide-legal-search-supervisor.service -u worldwide-legal-search-watchdog.service -f
```

Stop only this campaign and set its persistent HOLD marker:

```bash
python3 -B scripts/worldwide_supervisor_host.py stop
```

The supervisor and watchdog are user-systemd services with persistent enabling, bounded restarts and HOLD checks. The user manager has lingering enabled. Service installation never changes another campaign's units. The configured supervisor runs continuously; native receipts in `campaign-status.json` show completed tasks. A running process alone does not establish completion.

Grok 4.7 is primary through the canonical `llm_router` agent route. Codex is available for typed emergency eligibility only. An alive process, growing log, accepted repair request or zero worker exit does not complete a task: native validation, merge and completion receipts remain authoritative.

Observation-only monitoring can run during bootstrap with mutation capabilities explicitly false. Automatic recovery requires registered ownership/fencing controls. Automatic code repair additionally requires verified reproducer scope, a separate native repair lane, regression checks, native validated promotion and an accepted repair receipt. The readiness projection reports which bindings are actually installed.

The watchdog checks every 30 seconds. Policy thresholds distinguish idle work (300 seconds), missing heartbeats (600 seconds), unchanged meaningful progress (1,200 seconds), and the task deadline (5,400 seconds). Recovery reconciles native state before restarting the exact campaign service. An expired reconciliation can escalate to the registered service fence when a hung worker cannot consume its own control queue. Lost acknowledgements retain their original action IDs and budgets until native evidence settles them. Repairs have per-incident and campaign budgets; unresolved effects and exhausted budgets remain visible rather than granting a task completion.

After the same canonical attempt exhausts its two reconciliation and two registered recovery actions, the watchdog may request a bounded native diagnosis when that capability is available and no control action remains unsettled. Diagnosis is read-only, retains the original incident and spent budgets, and is separately capped by the existing reconciliation limit and campaign action cap. Its evidence is retained in `control/diagnoses/ACTION.json`. A diagnosis does not infer a software defect or turn unknown provider effects into known effects; paid repair still requires native custody, a current bound reproducer and a verified repair canary. When diagnosis is unavailable or its limit is spent, monitoring continues without further actions for that incident. A new canonical task attempt has its own incident identity; process restarts, revision changes and log activity cannot reset spent budgets. If a later recovery proves the same old owner was fenced, the adapter can settle an earlier timed-out recovery as failed with known fencing. This does not certify current owner health or task completion.

Keep protected plans, host configuration and watchdog sources stable while a task runs. To update them, first stop the campaign, finish and commit the changes, reconcile the stopped attempt through native APIs, then resume. Concurrent edits to protected files correctly block the active attempt, including edits made by the operator. Candidate work and incident receipts must be retained.

Private operational evidence lives beneath the state root: `bootstrap-receipt.json`, `campaign-status.json`, `campaign-readiness.json`, `repair-canary.json`, `control/`, `native/`, and `watchdog/`. The repair canary uses an isolated fixture and an explicitly deterministic provider; it verifies native red/green validation, merge and completion without paid calls. It does not certify model output or replace the production task validators.

Release preparation follows the same native validation and merge path as other tasks. WWL-111 owns the static release candidate, WWL-112 owns deployment through the configured GitHub Pages workflow, and WWL-113 owns the public smoke checks and rollback evidence. Their dependencies and exact validation argument lists remain authoritative. A successful local build cannot substitute for an Actions run, the deployed artifact identity, or a public smoke check.

The native deterministic rescue runs before a failed candidate is discarded. When declared generated artifacts are missing and the task's actual validation CLI exposes a matching `materialize`, `write`, or `generate` operation, it tries those finite operations in the retained worktree, stages only declared outputs, and runs the full original validation again. It also has one staging and revalidation pass for present but unstaged outputs. The generator must actually exist; the worldwide `audit.mjs` read-only modes alone do not grant an artifact generator. Generator output, staging, or a zero generator exit never establishes task completion. Native proposal, validation, integration and completion receipts are still required.

After a supervisor or environment prerequisite is repaired, retain the failed candidate and use the native candidate continuation path to rerun its unchanged checks and merge without repeating model implementation. Keep the earlier failed attempt, model usage, validation failures and recovery budgets in the history. A repaired test environment must preserve the sealed interpreter and private validation home. In particular, API test setup pins an initialized local datasets checkout only when its actual package exists; an empty optional gitlink must not import an unrelated global datasets distribution into every test. Tests requiring that dependency still import and validate it normally.

This campaign also opts into bounded fresh repair claims for a normally exited provider whose candidate failed the required validations. Native must have persisted the exact `database-native-provider-exit@2` custody proof, the rejected retained source, unchanged sealed state and events, and a repairable validation review with no accepted merge or execution effects. The next claim receives bounded diagnostic feedback about the retained source and failed original commands. Each fresh claim spends the existing task attempt allowance; it never resets paid history or grants success to the rejected candidate. Unknown callback effects, hard rejection, changed evidence and exhausted allowances cannot enter this path. Other campaigns retain their existing policy unless they explicitly opt in.

The runtime automatically refreshes stale repair-canary evidence by running the real isolated native canary against the current pipeline. It records the actual result in `control/repair-canary-refresh.json`; freshness is restored only after the new evidence verifies. Release code or artifact repairs likewise require actual reruns of the admitted checks. Never regenerate a passing receipt from a stale log, remove a required check, turn a failure into a skip, or disable branch or environment protection to unblock a release.

Missing GitHub credentials, repository permissions, environment approval, unavailable source rights, and exhausted admitted budgets remain typed external blockers. Recover automatically when an admitted probe proves the relevant prerequisite changed; continue independent ready work meanwhile. Repeated restarts cannot create release authority or reset the action budget. These states must remain visible in campaign projections until the actual prerequisite is satisfied.

The service environment pins `IPFS_ACCELERATE_AGENT_ORCHESTRATION_DIR` to the account's canonical orchestration directory. The campaign namespace also has a native managed-state marker. These prevent legacy global adoption from relocating the campaign's inactive database sidecars. Use the same environment pin for maintenance commands before importing native supervisor modules. Custody restoration evidence is retained in `custody-audit/`; retain both versions if a misplaced store was replaced by an empty file.

Setup fixes include recognizing native `todo` work, measuring meaningful progress independently of log activity, routing the complete execution/validation/merge bridge to each task's owning repository, preserving validation argument lists at admission, batching native snapshot reads, and avoiding duplicate pytest governance-plugin registration while retaining the native plugins. Focused regressions accompany these changes in the framework branch. Already-admitted validation records require an authorized native plan revision; recreating the database would discard task history and is not a migration.
