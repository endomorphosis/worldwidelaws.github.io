# Site instrument modules

Campaign `site-instrument-modules-v1` lives in this directory. It is not the worldwide-legal-search-v1 DuckDB board. Do not admit these ids there. Do not restart `worldwide-legal-search-supervisor.service`. Do not start `worldwide-legal-search-watchdog.service`.

The default implementation model is Grok Build `grok-4.7`, chosen by `llm_router` `select_route`. Codex runs only when that route reports a Grok hard quota.

## Already landed

These are not tasks. Keep them.

- View modules under `src/lib/worldwide/views/` for law, caselaw, regulation, legislative act, court, and municipal instrument, plus `select.ts`.
- `ResultItem` sets `data-instrument-view` only when `selectInstrumentView` accepts a claim. Site commit `26f685cfcb17ddd65ac8d234fc1cb801f54278dc` copies `interfaceId` and `sourceSchemaId` through fusion when the hit already has both. A disagreement clears the claim. `instrumentKind` stays the filter vocabulary.
- `LawReader` publishes `worldwide-legal-search.law-reader@1` on `data-schema`.
- `ResearchPanel` publishes `worldwide-legal-search.research-panel@1`.
- `SourcePage` publishes `worldwide-legal-search.source-page@1`. It renders a catalog source, not an instrument row.
- Published index summaries in `data/worldwide/index-format.schema.json` set `additionalProperties: false` and do not require a per-hit interface id. `country_ir_schema` is one string on the index file's `compatibility` object.

## Goal

Each site surface that renders a legal record keeps its current page schema and also exposes `data-instrument-view` when that record already names an interface id and a source schema id that `selectInstrumentView` accepts.

A missing id, a crossed pair, and the filter tokens `constitution`, `statute`, `code`, `regulation`, `ordinance`, `treaty`, `decision`, `notice`, `amendment`, `consolidation`, and `unknown` leave `data-instrument-view` unset. Do not stamp `CORPUS_SCHEMA_VERSION`, `GRAPH_NODE_SCHEMA`, or `worldwide-legal-search.law-source@1` onto a record that did not already carry that claim.

## Acceptance pairs

The selector already implements these. Tasks call it. They do not add a second table.

- `legal-corpus.law@1` plus `country-laws-ir-graphrag/v1`, with a row that has `id`, `title`, and `text`, selects `worldwide-legal-search.law-source@1`
- `legal-corpus.caselaw@1` plus `unversioned`, with a row, selects `worldwide-legal-search.caselaw-view@1`
- `legal-corpus.regulation@1` plus one of `cfr-annual-processor-v1`, `live-cfr-source-processor-v1`, `ecfr-crosscheck-processor-v1`, `federal-register-change-processor-v1`, `federal-register-sparse-graphrag-release-schema-v2`
- `legal-corpus.legislative-act@1` plus `public-law-change-processor-v1` or `public-law-change-fixture-v1`
- `legal-corpus.court@1` plus `unversioned`, with `court_id` and no opinion body
- `legal-corpus.municipal-instrument@1` plus the municipal schema file, with no null column

## Out of scope

- `executeProductionRetrieval` ranking, the planner, `INSTRUMENT_KINDS`, numeric `SCHEMA_VERSION`, `REQUIRED_LAW_COLUMNS`, and the municipal 19-column order
- Query place. It stays an argument. No GEOIP and no caller address.
- Closed routes: Belgium, Portugal, Lithuania, and Ghana national; Egypt governorates, South Africa provinces, Wallis and Futuna
- `LEGAL_QUERY_NORMALIZED`, searchable pins, `collect_legi`, `collect_gii`
- `web/js/apps`, SwissKnife, `llm_router.py`, and the JevOps seal
- PlacePicker, CoveragePage, ComparePlaces, and the jurisdiction stack, except where a task only quotes their existing schema ids in the new module note
