# Hub source binding tasks

Bootstrap status is `todo`. That is not live progress. Do not copy these ids into the worldwide-legal-search-v1 DuckDB board. `PLAN.md` wins when a task and this file disagree. `PARALLEL.md` says which tasks may run together.

The supervisor, not the worker, changes a status line. A worker writes its evidence file and, when the acceptance is still false, the source paths in its write scope.

## HFB-001 Optional catalog claim
- Status: completed
- Parent goal: HFB-G010
- Subgoal: HFB-G010.S1
- Track: catalog
- Depends on: none
- Write scope: /home/barberb/worldwidelaws.github.io/src/lib/worldwide/data/catalog.ts, /home/barberb/worldwidelaws.github.io/tests/worldwide/catalog-claim.test.ts, /home/barberb/worldwidelaws.github.io/implementation_plan/hub_source_bindings/evidence/HFB-001.md
- Authorization: edit only the write scope
- Acceptance: `CATALOG_SCHEMA` stays `worldwide-legal-search.catalog@1`. `CatalogSource` may carry `interface_id` and `source_schema_id`. `publishCatalog` copies both only when the inventory row already has both non-empty strings. One field alone omits both. Neither field leaves both absent. The fixture dataset `endomorphosis/ipfs_fixture_laws` stays unmarked. Do not stamp `country-laws-ir-graphrag/v1`. Do not import the binding table. No fetch is added. If this is already true, keep the files and write the evidence file. Fixed check: `/home/barberb/worldwidelaws.github.io/node_modules/.bin/jest --runTestsByPath tests/worldwide/catalog-claim.test.ts --watchAll=false --forceExit` with cwd `/home/barberb/worldwidelaws.github.io` and `NODE_OPTIONS=--experimental-vm-modules`.
- Must not: edit SourcePage, hub-bindings, the planner, or fusion

## HFB-002 Dataset id binding table
- Status: completed
- Parent goal: HFB-G020
- Subgoal: HFB-G020.S1
- Track: bindings
- Depends on: none
- Write scope: /home/barberb/worldwidelaws.github.io/src/lib/worldwide/data/hub-bindings.ts, /home/barberb/worldwidelaws.github.io/tests/worldwide/hub-bindings.test.ts, /home/barberb/worldwidelaws.github.io/implementation_plan/hub_source_bindings/evidence/HFB-002.md
- Authorization: edit only the write scope
- Acceptance: Export a lookup from `src/lib/worldwide/data/hub-bindings.ts`. A hit returns `interfaceId` and `sourceSchemaId` only for a dataset id a landed constant already names, and the schema id is the one that constant's module assigns. Include these when the constants still assign them: `endomorphosis/world_courts` to `legal-corpus.court@1` and `unversioned`; `endomorphosis/world_caselaw` to `legal-corpus.caselaw@1` and `unversioned`; `justicedao/Caselaw_Access_Project_embeddings` to `legal-corpus.caselaw@1` and `unversioned`; `endomorphosis/world_municipal_law` to `legal-corpus.municipal-instrument@1` and `world_municipal/schema.py`. The schema id must not equal the dataset id. `endomorphosis/world_national_law` returns null. `justicedao/wetwijzer_netherlands_legal_corpus` returns null. A regulation processor id is not a key. If a named constant no longer assigns that string, omit that row and say so in the evidence file. No network call. Fixed check: `/home/barberb/worldwidelaws.github.io/node_modules/.bin/jest --runTestsByPath tests/worldwide/hub-bindings.test.ts --watchAll=false --forceExit` with cwd `/home/barberb/worldwidelaws.github.io` and `NODE_OPTIONS=--experimental-vm-modules`.
- Must not: edit catalog.ts, SourcePage, or a datasets Python module

## HFB-003 Source page schema marker
- Status: completed
- Parent goal: HFB-G030
- Subgoal: HFB-G030.S1
- Track: source-page
- Depends on: HFB-001, HFB-002
- Write scope: /home/barberb/worldwidelaws.github.io/src/components/worldwide/SourcePage.tsx, /home/barberb/worldwidelaws.github.io/tests/worldwide/coverage-ui.test.tsx, /home/barberb/worldwidelaws.github.io/implementation_plan/hub_source_bindings/evidence/HFB-003.md
- Authorization: edit only the write scope
- Acceptance: `SOURCE_PAGE_SCHEMA` stays `worldwide-legal-search.source-page@1` on `data-schema`. For a catalog source whose dataset id the binding lookup accepts, set `data-interface-id` and `data-source-schema` from that pair. Do not set `data-instrument-view`. Do not import `selectInstrumentView`. A fixture source and `endomorphosis/world_national_law` leave both attributes unset. Existing source routes still render. No fetch is added. Fixed check: `/home/barberb/worldwidelaws.github.io/node_modules/.bin/jest --runTestsByPath tests/worldwide/coverage-ui.test.tsx --watchAll=false --forceExit` with cwd `/home/barberb/worldwidelaws.github.io` and `NODE_OPTIONS=--experimental-vm-modules`.
- Must not: edit catalog.ts, hub-bindings.ts, or the planner

## HFB-004 Binding note
- Status: completed
- Parent goal: HFB-G040
- Subgoal: HFB-G040.S1
- Track: docs
- Depends on: HFB-002
- Write scope: /home/barberb/worldwidelaws.github.io/docs/worldwide/hub-source-schemas.md, /home/barberb/worldwidelaws.github.io/implementation_plan/hub_source_bindings/evidence/HFB-004.md
- Authorization: edit only the write scope
- Acceptance: Create `docs/worldwide/hub-source-schemas.md`. Say the package is in this tree. Quote `worldwide-legal-search.source-page@1`, `legal-corpus.court@1`, `legal-corpus.caselaw@1`, `legal-corpus.municipal-instrument@1`, `unversioned`, and `world_municipal/schema.py` in backticks. Say a Hugging Face dataset id is not a source schema id. Say `endomorphosis/world_courts` and `endomorphosis/world_caselaw` keep schema id `unversioned`. Say `endomorphosis/world_national_law` is not bound to `country-laws-ir-graphrag/v1`. Say `justicedao/wetwijzer_netherlands_legal_corpus` receives no instrument claim from this table. Do not say a view is untracked. Do not edit `docs/worldwide/instrument-views.md` or `docs/worldwide/site-modules.md`. Fixed check: `/home/barberb/lift_coding/external/ipfs_datasets/.venv/bin/python -m ipfs_datasets_py.processors.legal_scrapers.legal_corpus.check_doc_drift` with cwd `/home/barberb/lift_coding/external/ipfs_datasets` and `PYTHONPATH=/home/barberb/lift_coding/external/ipfs_datasets`.
- Must not: edit a TypeScript module

## HFB-005 Prove the binding wave
- Status: completed
- Parent goal: HFB-G050
- Subgoal: HFB-G050.S1
- Track: proof
- Depends on: HFB-001, HFB-002, HFB-003, HFB-004
- Write scope: /home/barberb/worldwidelaws.github.io/implementation_plan/hub_source_bindings/evidence/HFB-005.md
- Authorization: read-only against source; write only the evidence file
- Acceptance: Re-run the HFB-001, HFB-002, and HFB-003 jest checks, plus `src/lib/worldwide/views/select.test.ts` and `tests/worldwide/results.test.tsx`, and the HFB-004 drift check. Record each exit code. Do not restart a supervisor.
- Must not: edit product source, commit, or restart `worldwide-legal-search-supervisor.service`
