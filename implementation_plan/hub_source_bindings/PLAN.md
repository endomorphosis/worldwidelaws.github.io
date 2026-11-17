# Hub source bindings

Campaign `hub-source-bindings-v1` lives in this directory. It is not the worldwide-legal-search-v1 DuckDB board. Do not admit these ids there. Do not restart `worldwide-legal-search-supervisor.service`. Do not start `worldwide-legal-search-watchdog.service`. Do not retarget the LCM, IVS, or site-instrument watchdogs.

The default implementation model is Grok Build `grok-4.7`, chosen by `llm_router` `select_route`. Codex runs only when that route reports a Grok hard quota.

## Already landed

These are not tasks. Keep them.

- Versioned views and `selectInstrumentView` accept a claim only when the record already names an interface id and a source schema id. Site `325717b5ed4119f4cd36cbf3f081be68df194142` also marks the reader and research panel that way, and an index summary stores `interface_id` and `source_schema_id` only when the source document already has both.
- A Hugging Face dataset id is not that schema id. `court.test.ts` refuses `endomorphosis/world_courts` as a source schema. `caselaw.test.ts` refuses `endomorphosis/world_caselaw` and `justicedao/Caselaw_Access_Project_embeddings` as source schemas. The accepted caselaw and court schema id is `unversioned`.
- `CatalogSource` names `dataset_id` and does not carry an interface id. `SourcePage` publishes `worldwide-legal-search.source-page@1` and does not select an instrument view.
- Regulation schema ids are processor versions such as `cfr-annual-processor-v1`. They are not dataset ids.
- `endomorphosis/world_national_law` is the pipeline repo id. The law view accepts `country-laws-ir-graphrag/v1`, which that repo constant does not assign. Leave that repo unmarked.
- The Netherlands compatibility repos, including `justicedao/wetwijzer_netherlands_legal_corpus`, stay dataset ids. This campaign does not give them an instrument claim.

## Goal

A catalog source from `https://huggingface.co/endomorphosis` or `https://huggingface.co/justicedao` can show the interface id and source schema id that a landed local constant already assigns to that dataset id. The dataset id and the schema id stay different strings. No live Hub card is fetched. Moving dataset tips are not chased. Pins, closed routes, and ranking stay as they are.

## Out of scope

- Uploads, pin moves, `LEGAL_QUERY_NORMALIZED`, and national fills
- `executeProductionRetrieval`, fusion rank, `INSTRUMENT_KINDS`, `SCHEMA_VERSION`, `REQUIRED_LAW_COLUMNS`, and the municipal 19-column order
- Generating a country-repo list or stamping `CORPUS_SCHEMA_VERSION` onto every catalog row
- Query place, GEOIP, and caller IP
- `docs/worldwide/instrument-views.md` and `docs/worldwide/site-modules.md`
- `web/js/apps`, SwissKnife, `llm_router.py`, and the JevOps seal
