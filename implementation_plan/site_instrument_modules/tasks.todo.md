# Site instrument module tasks

Bootstrap status is `todo`. That is not live progress. Do not copy these ids into the worldwide-legal-search-v1 DuckDB board. `PLAN.md` wins when a task and this file disagree. `PARALLEL.md` says which tasks may run together.

The supervisor, not the worker, changes a status line. A worker writes its evidence file and, when the acceptance is still false, the source paths in its write scope.

## SIM-001 Law reader marker
- Status: completed
- Parent goal: SIM-G010
- Subgoal: SIM-G010.S1
- Track: reader
- Depends on: none
- Write scope: /home/barberb/worldwidelaws.github.io/src/components/worldwide/LawReader.tsx, /home/barberb/worldwidelaws.github.io/tests/worldwide/reader.test.tsx, /home/barberb/worldwidelaws.github.io/implementation_plan/site_instrument_modules/evidence/SIM-001.md
- Authorization: edit only the write scope
- Acceptance: `READER_SCHEMA` stays `worldwide-legal-search.law-reader@1` on `data-schema`. A reader opened with no instrument claim has no `data-instrument-view`. A reader given an accepted caselaw claim sets `data-instrument-view` to `worldwide-legal-search.caselaw-view@1` and does not change `data-schema` to `law-source@1`. A claim whose interface id is the filter token `decision` or `regulation` leaves the attribute unset. Section title text stays. No fetch is added. Call `selectInstrumentView`. Do not add a second pair table. If this is already true, keep the files and write the evidence file. Fixed check: `/home/barberb/worldwidelaws.github.io/node_modules/.bin/jest --runTestsByPath tests/worldwide/reader.test.tsx --watchAll=false --forceExit` with cwd `/home/barberb/worldwidelaws.github.io` and `NODE_OPTIONS=--experimental-vm-modules`.
- Must not: commit, push, edit fusion, edit `SearchResults.tsx`, or admit this id to DuckDB

## SIM-002 Research passage marker
- Status: completed
- Parent goal: SIM-G020
- Subgoal: SIM-G020.S1
- Track: research
- Depends on: none
- Write scope: /home/barberb/worldwidelaws.github.io/src/components/worldwide/ResearchPanel.tsx, /home/barberb/worldwidelaws.github.io/tests/worldwide/evidence.test.tsx, /home/barberb/worldwidelaws.github.io/implementation_plan/site_instrument_modules/evidence/SIM-002.md
- Authorization: edit only the write scope
- Acceptance: `RESEARCH_SCHEMA` stays `worldwide-legal-search.research-panel@1` on `data-schema`. A passage with no interface id keeps today's markup and has no `data-instrument-view`. A passage that already has `interfaceId` `legal-corpus.caselaw@1`, `sourceSchemaId` `unversioned`, and a row sets `data-instrument-view` to `worldwide-legal-search.caselaw-view@1` on that passage. The panel schema attribute stays the research schema. A filter token does not select a view. Applicability stays `not-asserted`. If this is already true, keep the files and write the evidence file. Fixed check: `/home/barberb/worldwidelaws.github.io/node_modules/.bin/jest --runTestsByPath tests/worldwide/evidence.test.tsx --watchAll=false --forceExit` with cwd `/home/barberb/worldwidelaws.github.io` and `NODE_OPTIONS=--experimental-vm-modules`.
- Must not: commit, push, edit the reader, or add a network call

## SIM-004 Current module note
- Status: completed
- Parent goal: SIM-G040
- Subgoal: SIM-G040.S1
- Track: docs
- Depends on: none
- Write scope: /home/barberb/worldwidelaws.github.io/docs/worldwide/site-modules.md, /home/barberb/worldwidelaws.github.io/implementation_plan/site_instrument_modules/evidence/SIM-004.md
- Authorization: edit only the write scope
- Acceptance: `docs/worldwide/site-modules.md` says the package is in this tree and quotes `worldwide-legal-search.law-reader@1`, `worldwide-legal-search.research-panel@1`, `worldwide-legal-search.source-page@1`, `worldwide-legal-search.law-source@1`, `worldwide-legal-search.caselaw-view@1`, `worldwide-legal-search.regulation-view@1`, `worldwide-legal-search.legislative-act-view@1`, `worldwide-legal-search.court-view@1`, and `worldwide-legal-search.municipal-instrument-view@1`. It says `SourcePage` renders a catalog source and does not select an instrument view. It says a search row receives `data-instrument-view` only when the hit already names an accepted pair. It says `country_ir_schema` is file-level compatibility, not a per-hit claim. It does not say the municipal view is untracked. Do not edit `docs/worldwide/instrument-views.md`. Fixed check: `/home/barberb/lift_coding/external/ipfs_datasets/.venv/bin/python -m ipfs_datasets_py.processors.legal_scrapers.legal_corpus.check_doc_drift` with cwd `/home/barberb/lift_coding/external/ipfs_datasets` and `PYTHONPATH` set to that directory.
- Must not: edit view modules, edit `instrument-views.md`, or rewrite historical reports

## SIM-006 Optional index summary fields
- Status: completed
- Parent goal: SIM-G050
- Subgoal: SIM-G050.S1
- Track: index
- Depends on: none
- Write scope: /home/barberb/worldwidelaws.github.io/scripts/worldwide/build-index.ts, /home/barberb/worldwidelaws.github.io/data/worldwide/index-format.schema.json, /home/barberb/worldwidelaws.github.io/tests/worldwide/index-format.test.ts, /home/barberb/worldwidelaws.github.io/implementation_plan/site_instrument_modules/evidence/SIM-006.md
- Authorization: edit only the write scope
- Acceptance: A document summary may include `interface_id` and `source_schema_id` only when that source document already has both non-empty strings. A document with neither field produces a summary that does not add those keys. A document with only one of the two omits both. `country_ir_schema` stays on the index `compatibility` object and is not copied onto each summary. The summary schema keeps `additionalProperties: false` and does not add the new names to `required`. Existing summaries without the fields still validate. Do not map `record_type` or `instrumentKind` onto an interface id. Fixed check: `/home/barberb/worldwidelaws.github.io/node_modules/.bin/jest --runTestsByPath tests/worldwide/index-format.test.ts --watchAll=false --forceExit` with cwd `/home/barberb/worldwidelaws.github.io` and `NODE_OPTIONS=--experimental-vm-modules`.
- Must not: change BM25 weights, tokenizer ids, shard byte caps, or the required summary fields

## SIM-005 Forward an existing claim from the shell
- Status: completed
- Parent goal: SIM-G060
- Subgoal: SIM-G060.S1
- Track: shell
- Depends on: SIM-001, SIM-002
- Write scope: /home/barberb/worldwidelaws.github.io/src/components/worldwide/WorldwideLegalSearchApp.tsx, /home/barberb/worldwidelaws.github.io/tests/worldwide/shell.test.tsx, /home/barberb/worldwidelaws.github.io/implementation_plan/site_instrument_modules/evidence/SIM-005.md
- Authorization: edit only the write scope
- Acceptance: The shell passes an instrument claim into the reader or the research panel only when the loaded record already has both an interface id and a source schema id. A record without those fields is rendered as it is today. The shell does not import `INSTRUMENT_KINDS` to choose a view and does not read caller IP. Existing shell routes still render. If no loaded record type carries the pair, leave the shell unchanged and write that finding in the evidence file. Fixed check: `/home/barberb/worldwidelaws.github.io/node_modules/.bin/jest --runTestsByPath tests/worldwide/shell.test.tsx --watchAll=false --forceExit` with cwd `/home/barberb/worldwidelaws.github.io` and `NODE_OPTIONS=--experimental-vm-modules`.
- Must not: edit LawReader, ResearchPanel, the planner, or fusion

## SIM-007 Prove the site module wave
- Status: completed
- Parent goal: SIM-G070
- Subgoal: SIM-G070.S1
- Track: proof
- Depends on: SIM-001, SIM-002, SIM-004, SIM-005, SIM-006
- Write scope: /home/barberb/worldwidelaws.github.io/implementation_plan/site_instrument_modules/evidence/SIM-007.md
- Authorization: read-only against source; write only the evidence file
- Acceptance: Re-run the SIM-001, SIM-002, SIM-005, and SIM-006 jest checks, plus `src/lib/worldwide/views/select.test.ts` and `tests/worldwide/results.test.tsx` with the same Jest environment, and the SIM-004 drift check. Record each exit code. Do not restart a supervisor.
- Must not: edit product source, commit, or restart `worldwide-legal-search-supervisor.service`
