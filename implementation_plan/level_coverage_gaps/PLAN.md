# Level, coverage, and gap lists

Campaign `level-coverage-gaps-v1` lives in this directory. It is not the worldwide-legal-search-v1 DuckDB board. Do not admit these ids there. Do not restart `worldwide-legal-search-supervisor.service`. Do not start `worldwide-legal-search-watchdog.service`. Do not retarget the LCM, IVS, site-instrument, hub-source, or place-independent watchdogs.

The default implementation model is Grok Build `grok-4.7`, chosen by `llm_router` `select_route`. Codex runs only when that route reports a Grok hard quota.

## Already landed

Site `main` is `c7080b15`. Instrument views, hub bindings, and caller-independent worldwide retrieval are published. `worldwideJurisdictionIds` stays the jurisdiction allow-list. A dataset id is not a source schema id.

`bandForLevel` in `src/lib/worldwide/jurisdiction/authority.ts` already maps `province` and `state` to `regional`, and `municipality`, `city`, and `neighborhood` to `local`. `bandForLevel('national')` returns `special`. The filter vocabulary `national` is not that function. Do not edit `bandForLevel` or `AUTHORITY_BANDS`.

`executeProductionRetrieval` already searches a place stack and, for a worldwide scope, applies `worldwideJurisdictionIds`. A municipal or local filter keeps national and regional candidates. It does not become a local-only band list. Rank stays reciprocal-rank fusion.

`ipfs_datasets_py.processors.legal_scrapers.country_laws_ir` assigns `SCHEMA_VERSION` `country-laws-ir-graphrag/v1`, `ENTRY_IDENTITY_SCHEMA` `country-laws-entry/v1`, and `LAW_IDENTITY_SCHEMA` `country-laws-law/v1`. `query.py` searches a local release with `Release.bm25` and `document_shard_paths`. The site does not import that package at runtime.

Coverage cells already use `known`, `partial`, `missing`, `unknown`, and `unavailable`. A coverage gap is not a finding that no law exists.

## Goal

A person can ask for national, province, state, municipality, city, or neighborhood law, from anywhere, without a caller IP. An explicit place still narrows. The page lists a geography gap when a requested level has no place, and a corpus gap when a place has no searched collection. A TypeScript reader accepts a country-laws IR row only when that row already names `country-laws-ir-graphrag/v1`. The Python package is the field guide. It is not ported.

## Out of scope

- Uploads, pin moves, closed national routes, and GraphRAG rebuilds
- `bandForLevel`, `AUTHORITY_BANDS`, fusion rank, `planPlaceSearch`, `INSTRUMENT_KINDS`, `SCHEMA_VERSION`, `REQUIRED_LAW_COLUMNS`, and the municipal 19-column order
- `src/lib/worldwide/search/bm25.ts`, `fusion.ts`, `caller-independent.ts`, `catalog.ts`, and `hub-bindings.ts`
- Importing `geoip.ts` or reading a caller IP
- Fetching Hugging Face, or stamping `country-laws-ir-graphrag/v1` onto a row that does not already carry it
- `docs/worldwide/instrument-views.md`, `docs/worldwide/site-modules.md`, `docs/worldwide/hub-source-schemas.md`, and `docs/worldwide/caller-independent-retrieval.md`
- `web/js/apps`, SwissKnife, `llm_router.py`, and the JevOps seal
