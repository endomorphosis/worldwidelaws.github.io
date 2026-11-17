# Caller-independent worldwide retrieval

Campaign `place-independent-retrieval-v1` lives in this directory. It is not the worldwide-legal-search-v1 DuckDB board. Do not admit these ids there. Do not restart `worldwide-legal-search-supervisor.service`. Do not start `worldwide-legal-search-watchdog.service`. Do not retarget the LCM, IVS, site-instrument, or hub-source watchdogs.

The default implementation model is Grok Build `grok-4.7`, chosen by `llm_router` `select_route`. Codex runs only when that route reports a Grok hard quota.

## Already landed

Hub dataset bindings are on the local tree, campaign `hub-source-bindings-v1`, health `frontier_clear`. Those files are uncommitted. Do not edit them in this campaign. A dataset id from `https://huggingface.co/endomorphosis` or `https://huggingface.co/justicedao` is still not a source schema id.

`executeProductionRetrieval` can search the worldwide index. For that scope it copies place ids into `jurisdictions` unless the place is city-only. The place-scoped plan still resolves an authority stack before it selects sources. Rank stays reciprocal-rank fusion.

`src/lib/worldwide/location/geoip.ts` says Pages cannot see the visitor IP. A country code from the suggestion provider is not a place id. Views do not carry `geoip` or a caller IP. `SearchResults` is not mounted by `WorldwideLegalSearchApp`.

## Goal

A person can query the worldwide index of those datasets without their suggestion place narrowing the jurisdictions. A place they chose in the URL, by hand, or from a saved selection still narrows. No caller IP is read. Closed routes and pins stay closed.

## Out of scope

- Uploads, pin moves, `LEGAL_QUERY_NORMALIZED`, and national fills
- Fusion rank, the planner's place stack, `INSTRUMENT_KINDS`, `SCHEMA_VERSION`, `REQUIRED_LAW_COLUMNS`, and the municipal 19-column order
- Mounting `SearchResults` on a new route
- Importing `geoip.ts` into the retrieval helper
- The uncommitted hub-source files, `docs/worldwide/instrument-views.md`, `docs/worldwide/site-modules.md`, and `docs/worldwide/hub-source-schemas.md`
- `web/js/apps`, SwissKnife, `llm_router.py`, and the JevOps seal
