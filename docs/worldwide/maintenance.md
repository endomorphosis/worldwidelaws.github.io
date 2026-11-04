# Source refresh and operational maintenance

Site maintainers refresh pinned source bytes. The host supervisor recovers its own processes. Those are different owners. A refresh never starts, stops, or reconfigures the supervisor, and credentials never enter the site.

The pipeline is `scripts/worldwide/refresh.ts`. It reads the worktree inputs below, hashes each file before it writes a derived manifest, audits rights, schema, and coverage, and publishes only to a refresh store outside this repository.

| Role | Path |
| --- | --- |
| Inventory | `data/worldwide/source-inventory.json` |
| Dispositions | `data/worldwide/source-dispositions.json` |
| Rights | `data/worldwide/rights.json` |
| Catalog schema | `data/worldwide/catalog.schema.json` |
| Coverage audit | `docs/worldwide/coverage-audit.json` |
| Ingestion ledger | `data/worldwide/ingestion-ledger.json` |
| Geography | `data/worldwide/geography-manifest.json` |

Check the current tree without writing:

```bash
node --experimental-strip-types scripts/worldwide/refresh.ts --check
```

Publish a snapshot into an operator store that is not inside the site repository:

```bash
node --experimental-strip-types scripts/worldwide/refresh.ts --state /path/outside/the/site/refresh-store
```

Restore the previous published manifest:

```bash
node --experimental-strip-types scripts/worldwide/refresh.ts --state /path/outside/the/site/refresh-store --rollback
```

`--check` is the default when `--state` is omitted. A second publish of the same bytes reports `unchanged` and does not rewrite `current.json`. The script does not fetch upstream datasets, does not rewrite `scripts/worldwide/update.ts` snapshots, and does not rebuild the browser catalog.

## Refresh

Pin the source revision before writing derived artifacts. Every input is pinned by the SHA-256 of its exact file bytes. Inventory rows also carry a `resolved_revision`, rights rows carry an `artifact_revision`, and the geography manifest carries its own revision. Floating names such as `main`, `latest`, and `current` are rejected. Disposition, rights, coverage, and ledger documents must cite the inventory hash of the bytes just read. Rights and the ledger must cite the disposition hash. The ledger must cite the rights hash.

A change is a pin whose SHA-256 differs from the snapshot named by `current.json`. The new manifest records the parent snapshot id, the pin list, and which pins changed. The snapshot id is the SHA-256 of that canonical identity. The manifest file is staged in the store, fsynced, and renamed into `snapshots/<snapshot-id>/manifest.json`. Only then is `current.json` replaced by a temporary file in the same directory, an fsync, and `rename`. Readers of the pointer see either the previous complete snapshot or the next complete snapshot.

The store layout is `current.json`, `previous.json`, `snapshots/<id>/manifest.json`, and `quarantine/<id>.json`. A leftover `.refresh.lock` from a killed process blocks the next publish until that file is removed. The pipeline does not steal a lock. An unreferenced snapshot directory is not the current result.

## Rights

Audit redistribution rights for text, boundaries, translations, embeddings, and indexes. `data/worldwide/rights.json` must use `worldwide-legal-search.rights@1`. Organization membership in `justicedao` or `endomorphosis` is not a license, and `organization_membership_is_not_a_license` must stay true. `inferred_from_organization` must be false on every record.

A resolved record needs a license, an attribution string, and a null blocker. An unresolved record needs a blocker with a kind and a reason. The blocker covers every artifact kind on that record. Summary counts, when present, must match the records. The geography manifest needs its own license and attribution. A boundary gap stays unresolved until the pinned card of that dataset says otherwise.

An incompatible rights document is quarantined. It does not replace the current snapshot.

## Schema

Quarantine incompatible schemas without poisoning the current snapshot. `data/worldwide/catalog.schema.json` must be JSON Schema 2020-12, with `additionalProperties` false. Each coverage cell must require `coverage_state`, `record_denominator`, `collection_count`, `legal_completeness`, `as_of`, and `integrity`.

`coverage_state` is exactly `known`, `partial`, `missing`, `unknown`, and `unavailable`. `legal_completeness` includes `not_claimed` and does not include `complete`. Record and collection counts are non-negative integers. `integrity.sha256` is a 64-digit hex digest. The geography manifest must be hierarchical. The inventory must name `justicedao` and `endomorphosis`, with exhausted pagination and a pinned revision on every dataset.

A schema that drops a coverage state, opens the cell, or treats a count as legal completeness fails the audit. The failure writes a quarantine record and leaves `current.json` bytes unchanged.

## Coverage

Record known, partial, missing, unknown, and unavailable coverage. Those five states come from the catalog schema. The coverage audit and the ingestion ledger bind the same inventory and disposition hashes. `national_count`, `local_count`, `regional_count`, and `other_count` are the sums of ledger `record_count` for national, municipal, regional, and other rows. Null counts are not invented. `entry_count` and the trace follow the ledger in order.

`legal_completeness` stays `not_claimed` on the ledger, the coverage audit, and the geography manifest. `counts_are_not_legal_completeness` stays true. `complete_world` stays false. Verified ingest receipts, admitted child tasks, and the eligible, blocked, and excluded totals must agree across the ledger and the coverage audit when both documents carry them. A collection count, a record denominator, or a known cell is not legal completeness.

## Rollback

Restore the previous manifest atomically when audit fails. Before a new pointer is written, the audit runs against the bytes just pinned. Rights, schema, coverage, pin, and credential findings all take the failure path. The attempt is written under `quarantine/` with `poisonedCurrent: false` and `rolledBack: true`. Staging is removed. `current.json` is read again and must be byte-for-byte the pointer from before the attempt. An empty store stays empty. A corrupt current pointer fails closed and is not replaced with an invented snapshot.

A successful publish copies the old `current.json` to `previous.json` before replacing `current.json`. `rollback()` verifies that previous snapshot, then renames its pointer onto `current.json` and keeps the displaced pointer as the next rollback target. One rollback returns to the prior pin. A second rollback swaps back. If the previous pointer is missing, rollback stops with `rollback target required`.

## Ownership

Site maintainers own the refresh pipeline. The host supervisor owns process recovery.

Site maintainers own the source pins, the rights audit, the schema audit, the coverage audit, and the atomic rollback of the refresh pointer. They run `scripts/worldwide/refresh.ts`. They may replace the JSON inputs in the worktree and publish a store outside the site. They do not treat a supervisor heartbeat, a growing log, or a zero process exit as a source pin.

The host supervisor owns process recovery, service restart, and the watchdog for `worldwide-legal-search-supervisor.service` and `worldwide-legal-search-watchdog.service`. That operation is `scripts/worldwide_supervisor_host.py` with `config/worldwide_supervisor_host.json`, as described in `docs/worldwide/supervisor-operations.md`. The refresh pipeline does not read the host configuration, does not import the supervisor, and does not start, stop, or restart those units. Protected plan files, the host configuration, and the watchdog sources stay out of the pin set. A successful refresh does not prove the supervisor is healthy. A running supervisor does not publish a source pin.

The refresh store must stay outside the site repository. A path inside the worktree is rejected before any manifest is written.

## Credentials

Credentials never enter the site repository, the refresh store, or the browser bundle. Do not copy Hugging Face tokens, GitHub tokens, cloud access keys, private keys, or passwords into source files, docs, receipts, or published pins.

The pipeline does not read credential environment variables and does not fetch with them. It does not accept `.env` files, private-key files, or the host supervisor configuration as inputs. Before publish, every pinned file is scanned. A private-key block, a cloud access-key id, a Hugging Face token, an `sk-` token, or an assigned API key, secret, password, or access token is a hard failure. The finding names the file and does not echo the material. The current snapshot is left untouched.

Upstream credentials, when an operator needs them for a separate fetch, stay outside this repository. Missing source rights stay typed blockers on the rights record. They are not filled in from organization membership or from a token.
