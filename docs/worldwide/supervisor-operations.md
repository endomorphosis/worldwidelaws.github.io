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

The supervisor and watchdog are user-systemd services with persistent enabling, bounded restarts and HOLD checks. The user manager has lingering enabled. Service installation never changes another campaign's units. The initial launch uses `run --once` to verify the first real task before sustained execution; current configuration and canonical status determine the active mode.

Grok 4.7 is primary through the canonical `llm_router` agent route. Codex is available for typed emergency eligibility only. An alive process, growing log, accepted repair request or zero worker exit does not complete a task: native validation, merge and completion receipts remain authoritative.

Observation-only monitoring can run during bootstrap with mutation capabilities explicitly false. Automatic recovery requires registered ownership/fencing controls. Automatic code repair additionally requires verified reproducer scope, a separate native repair lane, regression checks, native validated promotion and an accepted repair receipt. The readiness projection reports which bindings are actually installed.

Setup fixes include recognizing native `todo` work, measuring meaningful progress independently of log activity, routing the complete execution/validation/merge bridge to each task's owning repository, and avoiding duplicate pytest governance-plugin registration while retaining the native plugins. Focused regressions accompany these changes in the framework branch.
