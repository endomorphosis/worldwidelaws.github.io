# Level coverage gap tasks

Bootstrap status is `todo`. That is not live progress. Do not copy these ids into the worldwide-legal-search-v1 DuckDB board. `PLAN.md` wins when a task and this file disagree. `PARALLEL.md` says which tasks may run together.

The supervisor, not the worker, changes a status line. A worker writes its evidence file and, when the acceptance is still false, the source paths in its write scope.

## LCG-001 Government level names
- Status: completed
- Parent goal: LCG-G010
- Subgoal: LCG-G010.S1
- Track: levels
- Depends on: none
- Write scope: /home/barberb/worldwidelaws.github.io/src/lib/worldwide/levels/government.ts, /home/barberb/worldwidelaws.github.io/tests/worldwide/government-level.test.ts, /home/barberb/worldwidelaws.github.io/implementation_plan/level_coverage_gaps/evidence/LCG-001.md
- Authorization: edit only the write scope
- Acceptance: Export `GOVERNMENT_LEVEL_SCHEMA` as `worldwide-legal-search.government-level@1` and `GOVERNMENT_LEVELS` containing `national`, `province`, `state`, `municipality`, `city`, and `neighborhood`. `governmentBand` returns `national` for `national`, `regional` for `province` and `state`, and `local` for `municipality`, `city`, and `neighborhood`. Any other string returns null. Do not edit `bandForLevel` or `AUTHORITY_BANDS`. Do not import `geoip.ts`. Do not fetch. A test covers all six levels and one unknown string. Fixed check: `/home/barberb/worldwidelaws.github.io/node_modules/.bin/jest --runTestsByPath tests/worldwide/government-level.test.ts --watchAll=false --forceExit` with cwd `/home/barberb/worldwidelaws.github.io` and `NODE_OPTIONS=--experimental-vm-modules`.
- Must not: edit authority.ts, SearchResults, or SearchFilters

## LCG-002 Geography and corpus gaps
- Status: completed
- Parent goal: LCG-G020
- Subgoal: LCG-G020.S1
- Track: gaps
- Depends on: none
- Write scope: /home/barberb/worldwidelaws.github.io/src/lib/worldwide/coverage/gaps.ts, /home/barberb/worldwidelaws.github.io/tests/worldwide/coverage-gaps.test.ts, /home/barberb/worldwidelaws.github.io/implementation_plan/level_coverage_gaps/evidence/LCG-002.md
- Authorization: edit only the write scope
- Acceptance: Export `COVERAGE_GAP_SCHEMA` as `worldwide-legal-search.coverage-gap-list@1`. `gapsFromCoverageCells(cells, requestedLevels)` returns `geography` and `corpus` arrays. A requested level with no cell is one geography gap. A cell whose state is `missing`, `unknown`, or `unavailable` is one corpus gap. `known`, `partial`, and `searched` are not corpus gaps. Each gap has `kind`, `level`, `placeId`, and `sentence`. The sentence contains `coverage gap` and `not a finding that no law exists`. Do not invent a place id. Do not fetch. Do not import `geoip.ts`. A test shows one geography gap and one corpus gap, and shows that `partial` is not a corpus gap. Fixed check: `/home/barberb/worldwidelaws.github.io/node_modules/.bin/jest --runTestsByPath tests/worldwide/coverage-gaps.test.ts --watchAll=false --forceExit` with cwd `/home/barberb/worldwidelaws.github.io` and `NODE_OPTIONS=--experimental-vm-modules`.
- Must not: edit CoveragePage, the catalog, or the planner

## LCG-003 Retrieval at each level
- Status: completed
- Parent goal: LCG-G010
- Subgoal: LCG-G010.S2
- Track: retrieval
- Depends on: LCG-001
- Write scope: /home/barberb/worldwidelaws.github.io/src/components/worldwide/SearchResults.tsx, /home/barberb/worldwidelaws.github.io/src/components/worldwide/SearchFilters.tsx, /home/barberb/worldwidelaws.github.io/tests/worldwide/government-retrieval.test.ts, /home/barberb/worldwidelaws.github.io/implementation_plan/level_coverage_gaps/evidence/LCG-003.md
- Authorization: edit only the write scope
- Acceptance: Add `province`, `state`, `municipality`, `city`, and `neighborhood` to the `DisplayFilters` level union, to the `normalizeDisplayFilters` allowed set, and as select options beside the existing `national`, `regional`, `municipal`, and `other` options. Set `data-schema` `worldwide-legal-search.level-filter@1` on that select. In `toProductionFilters`, `province` and `state` set `bands` to `['regional']`. `municipality`, `city`, and `neighborhood` use the same branch as `municipal` and `local`, including the city-only place expansion, and do not set a local-only band list. Keep today's `national`, `regional`, `municipal`, `local`, and `other` behavior. Keep the `worldwideJurisdictionIds` call. Do not change `planPlaceSearch` or the rank sort. A test shows `province` yields regional bands and `city` stays on the municipal path. No fetch is added. Fixed check: `/home/barberb/worldwidelaws.github.io/node_modules/.bin/jest --runTestsByPath tests/worldwide/government-retrieval.test.ts --watchAll=false --forceExit` with cwd `/home/barberb/worldwidelaws.github.io` and `NODE_OPTIONS=--experimental-vm-modules`.
- Must not: edit authority.ts, fusion.ts, planner.ts, bm25.ts, or caller-independent.ts

## LCG-004 Versioned gap list
- Status: completed
- Parent goal: LCG-G020
- Subgoal: LCG-G020.S2
- Track: view
- Depends on: LCG-002
- Write scope: /home/barberb/worldwidelaws.github.io/src/components/worldwide/GapList.tsx, /home/barberb/worldwidelaws.github.io/tests/worldwide/gap-list.test.tsx, /home/barberb/worldwidelaws.github.io/src/components/worldwide/CoveragePage.tsx, /home/barberb/worldwidelaws.github.io/implementation_plan/level_coverage_gaps/evidence/LCG-004.md
- Authorization: edit only the write scope
- Acceptance: `GapList` renders `geography` and `corpus` rows and sets `data-schema` to `worldwide-legal-search.gap-list@1`. Each row shows its level, place id, and sentence. `CoveragePage` imports `GapList` and `gapsFromCoverageCells` and renders one `GapList`. Do not rewrite `CoverageMatrix`, `municipalCopy`, or `textImpliesNoLaw`. A test renders one geography row and one corpus row and expects the schema id. No fetch is added. Fixed check: `/home/barberb/worldwidelaws.github.io/node_modules/.bin/jest --runTestsByPath tests/worldwide/gap-list.test.tsx --watchAll=false --forceExit` with cwd `/home/barberb/worldwidelaws.github.io` and `NODE_OPTIONS=--experimental-vm-modules`.
- Must not: edit the catalog module or SearchResults

## LCG-005 IR row reader
- Status: completed
- Parent goal: LCG-G030
- Subgoal: LCG-G030.S1
- Track: parser
- Depends on: none
- Write scope: /home/barberb/worldwidelaws.github.io/src/lib/worldwide/search/ir-row.ts, /home/barberb/worldwidelaws.github.io/tests/worldwide/ir-row.test.ts, /home/barberb/worldwidelaws.github.io/implementation_plan/level_coverage_gaps/evidence/LCG-005.md
- Authorization: edit only the write scope
- Acceptance: Export `IR_ROW_SCHEMA` as `worldwide-legal-search.ir-row@1`, `IR_SCHEMA_VERSION` as `country-laws-ir-graphrag/v1`, `ENTRY_IDENTITY_SCHEMA` as `country-laws-entry/v1`, and `LAW_IDENTITY_SCHEMA` as `country-laws-law/v1`. Say in a comment that the guide is `ipfs_datasets_py/processors/legal_scrapers/country_laws_ir/__init__.py` and that `query.py` `Release.bm25` and `document_shard_paths` stay in Python. Export `IR_SEARCH_GUIDE` with `k1` 1.2, `b` 0.75, `titleWeight` 5, and `bodyWeight` 1. `readIrRow` returns the instrument id and title only when `schema_version` is already `country-laws-ir-graphrag/v1`, `instrument_id` and `title` are non-empty strings, and a present `entry_identity_schema_version` equals `country-laws-entry/v1`. A missing schema version returns null. Do not stamp the schema onto a row. Do not fetch. Do not edit `bm25.ts`. A test shows a matching row is kept and a row without `schema_version` returns null. Fixed check: `/home/barberb/worldwidelaws.github.io/node_modules/.bin/jest --runTestsByPath tests/worldwide/ir-row.test.ts --watchAll=false --forceExit` with cwd `/home/barberb/worldwidelaws.github.io` and `NODE_OPTIONS=--experimental-vm-modules`.
- Must not: port Release.bm25, edit bm25.ts, or fetch a dataset

## LCG-006 Level and gap note
- Status: completed
- Parent goal: LCG-G040
- Subgoal: LCG-G040.S1
- Track: docs
- Depends on: LCG-001, LCG-002, LCG-003, LCG-004, LCG-005
- Write scope: /home/barberb/worldwidelaws.github.io/docs/worldwide/level-coverage-gaps.md, /home/barberb/worldwidelaws.github.io/implementation_plan/level_coverage_gaps/evidence/LCG-006.md
- Authorization: edit only the write scope
- Acceptance: Create `docs/worldwide/level-coverage-gaps.md`. Say the package is in this tree. Quote `worldwide-legal-search.government-level@1`, `worldwide-legal-search.coverage-gap-list@1`, `worldwide-legal-search.gap-list@1`, `worldwide-legal-search.level-filter@1`, and `worldwide-legal-search.ir-row@1`. Name `national`, `province`, `state`, `municipality`, `city`, and `neighborhood`. Say a geography gap and a corpus gap are different, and that a coverage gap is not a finding that no law exists. Say caller IP is not a retrieval input. Say `country-laws-ir-graphrag/v1` is read only when the row already names it, and that `Release.bm25` stays in `ipfs_datasets_py`. Do not say a view is untracked. Do not edit `docs/worldwide/instrument-views.md`, `docs/worldwide/site-modules.md`, `docs/worldwide/hub-source-schemas.md`, or `docs/worldwide/caller-independent-retrieval.md`. Fixed check: `/home/barberb/lift_coding/external/ipfs_datasets/.venv/bin/python -m ipfs_datasets_py.processors.legal_scrapers.legal_corpus.check_doc_drift` with cwd `/home/barberb/lift_coding/external/ipfs_datasets` and `PYTHONPATH=/home/barberb/lift_coding/external/ipfs_datasets`.
- Must not: edit a TypeScript module

## LCG-007 Prove the level and gap wave
- Status: completed
- Parent goal: LCG-G050
- Subgoal: LCG-G050.S1
- Track: proof
- Depends on: LCG-006
- Write scope: /home/barberb/worldwidelaws.github.io/implementation_plan/level_coverage_gaps/evidence/LCG-007.md
- Authorization: read-only against source; write only the evidence file
- Acceptance: Re-run the LCG-001, LCG-002, LCG-003, LCG-004, and LCG-005 jest checks, plus `tests/worldwide/results.test.tsx`, `tests/worldwide/caller-independent.test.ts`, and `tests/worldwide/worldwide-place-filter.test.ts`, and the doc drift check. Record each exit code. Do not restart a supervisor.
- Must not: edit product source, commit, or restart `worldwide-legal-search-supervisor.service`
