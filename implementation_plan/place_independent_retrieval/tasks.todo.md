# Caller-independent retrieval tasks

Bootstrap status is `todo`. That is not live progress. Do not copy these ids into the worldwide-legal-search-v1 DuckDB board. `PLAN.md` wins when a task and this file disagree. `PARALLEL.md` says which tasks may run together.

The supervisor, not the worker, changes a status line. A worker writes its evidence file and, when the acceptance is still false, the source paths in its write scope.

## PIR-001 Worldwide jurisdiction helper
- Status: completed
- Parent goal: PIR-G010
- Subgoal: PIR-G010.S1
- Track: helper
- Depends on: none
- Write scope: /home/barberb/worldwidelaws.github.io/src/lib/worldwide/search/caller-independent.ts, /home/barberb/worldwidelaws.github.io/tests/worldwide/caller-independent.test.ts, /home/barberb/worldwidelaws.github.io/implementation_plan/place_independent_retrieval/evidence/PIR-001.md
- Authorization: edit only the write scope
- Acceptance: Export `CALLER_INDEPENDENT_SCHEMA` as `worldwide-legal-search.caller-independent-filter@1` and `worldwideJurisdictionIds(origin, channel, placeIds)`. When `origin` is `url`, `manual`, or `saved`, return the non-empty place ids. When `origin` is `suggestion` or `unselected`, return an empty array. When `origin` is absent and `channel` is `geoip`, `device`, or `none`, return an empty array. When both `origin` and `channel` are absent, return the non-empty place ids. An explicit origin wins over a suggestion channel. Do not import `geoip.ts`. Do not read a caller IP. Do not fetch. Fixed check: `/home/barberb/worldwidelaws.github.io/node_modules/.bin/jest --runTestsByPath tests/worldwide/caller-independent.test.ts --watchAll=false --forceExit` with cwd `/home/barberb/worldwidelaws.github.io` and `NODE_OPTIONS=--experimental-vm-modules`.
- Must not: edit SearchResults, the planner, or the shell

## PIR-002 Worldwide retrieval filter
- Status: completed
- Parent goal: PIR-G020
- Subgoal: PIR-G020.S1
- Track: retrieval
- Depends on: PIR-001
- Write scope: /home/barberb/worldwidelaws.github.io/src/components/worldwide/SearchResults.tsx, /home/barberb/worldwidelaws.github.io/tests/worldwide/worldwide-place-filter.test.ts, /home/barberb/worldwidelaws.github.io/implementation_plan/place_independent_retrieval/evidence/PIR-002.md
- Authorization: edit only the write scope
- Acceptance: `ProductionRetrievalInput` may carry optional `placeOrigin` and `placeChannel`. In the worldwide branch, the `jurisdictions` filter is `worldwideJurisdictionIds` applied to the place ids, and a city-only place still forces that filter empty. When both new fields are absent, the jurisdictions stay what they are today. Do not change the reciprocal-rank sort, `planPlaceSearch`, or `INSTRUMENT_KINDS`. A test shows a `suggestion` origin with place ids yields a worldwide search whose jurisdiction filter is empty, and a `manual` origin keeps those place ids. No fetch is added. Fixed check: `/home/barberb/worldwidelaws.github.io/node_modules/.bin/jest --runTestsByPath tests/worldwide/worldwide-place-filter.test.ts --watchAll=false --forceExit` with cwd `/home/barberb/worldwidelaws.github.io` and `NODE_OPTIONS=--experimental-vm-modules`.
- Must not: edit the planner, fusion rank order, hub-bindings, or catalog.ts

## PIR-003 Shell does not read the caller
- Status: completed
- Parent goal: PIR-G030
- Subgoal: PIR-G030.S1
- Track: shell
- Depends on: none
- Write scope: /home/barberb/worldwidelaws.github.io/src/components/worldwide/WorldwideLegalSearchApp.tsx, /home/barberb/worldwidelaws.github.io/tests/worldwide/shell.test.tsx, /home/barberb/worldwidelaws.github.io/implementation_plan/place_independent_retrieval/evidence/PIR-003.md
- Authorization: edit only the write scope
- Acceptance: If `WorldwideLegalSearchApp` does not call `executeProductionRetrieval`, leave the shell unchanged and write that finding. Do not mount `SearchResults`. Do not import `geoip.ts`. Do not add a caller-IP field. The shell test still exits 0. Fixed check: `/home/barberb/worldwidelaws.github.io/node_modules/.bin/jest --runTestsByPath tests/worldwide/shell.test.tsx --watchAll=false --forceExit` with cwd `/home/barberb/worldwidelaws.github.io` and `NODE_OPTIONS=--experimental-vm-modules`.
- Must not: edit SearchResults or the location geoip module

## PIR-004 Retrieval note
- Status: completed
- Parent goal: PIR-G040
- Subgoal: PIR-G040.S1
- Track: docs
- Depends on: PIR-001
- Write scope: /home/barberb/worldwidelaws.github.io/docs/worldwide/caller-independent-retrieval.md, /home/barberb/worldwidelaws.github.io/implementation_plan/place_independent_retrieval/evidence/PIR-004.md
- Authorization: edit only the write scope
- Acceptance: Create `docs/worldwide/caller-independent-retrieval.md`. Say the package is in this tree. Quote `worldwide-legal-search.caller-independent-filter@1`. Say a worldwide query of the endomorphosis and justicedao datasets is not narrowed by a `suggestion`, `geoip`, or `device` place. Say a `url`, `manual`, or `saved` place still narrows. Say caller IP is not a retrieval input. Say closed routes and pins stay closed. Do not say a view is untracked. Do not edit `docs/worldwide/hub-source-schemas.md`, `docs/worldwide/site-modules.md`, or `docs/worldwide/instrument-views.md`. Fixed check: `/home/barberb/lift_coding/external/ipfs_datasets/.venv/bin/python -m ipfs_datasets_py.processors.legal_scrapers.legal_corpus.check_doc_drift` with cwd `/home/barberb/lift_coding/external/ipfs_datasets` and `PYTHONPATH=/home/barberb/lift_coding/external/ipfs_datasets`.
- Must not: edit a TypeScript module

## PIR-005 Prove the retrieval wave
- Status: completed
- Parent goal: PIR-G050
- Subgoal: PIR-G050.S1
- Track: proof
- Depends on: PIR-001, PIR-002, PIR-003, PIR-004
- Write scope: /home/barberb/worldwidelaws.github.io/implementation_plan/place_independent_retrieval/evidence/PIR-005.md
- Authorization: read-only against source; write only the evidence file
- Acceptance: Re-run the PIR-001, PIR-002, and PIR-003 jest checks, plus `tests/worldwide/results.test.tsx` and `tests/worldwide/search-scope.test.ts`, and the PIR-004 drift check. Record each exit code. Do not restart a supervisor.
- Must not: edit product source, commit, or restart `worldwide-legal-search-supervisor.service`
