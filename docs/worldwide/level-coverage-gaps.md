# Level coverage gaps

The package is in this tree. `src/lib/worldwide/levels/government.ts` exports `GOVERNMENT_LEVEL_SCHEMA` `worldwide-legal-search.government-level@1`. `src/lib/worldwide/coverage/gaps.ts` exports `COVERAGE_GAP_SCHEMA` `worldwide-legal-search.coverage-gap-list@1`. `src/components/worldwide/GapList.tsx` publishes `GAP_LIST_SCHEMA` `worldwide-legal-search.gap-list@1` on `data-schema`. The level select in `src/components/worldwide/SearchFilters.tsx` publishes `worldwide-legal-search.level-filter@1`. `src/lib/worldwide/search/ir-row.ts` exports `IR_ROW_SCHEMA` `worldwide-legal-search.ir-row@1`.

## Government levels

`GOVERNMENT_LEVELS` names `national`, `province`, `state`, `municipality`, `city`, and `neighborhood`. `governmentBand` returns `national` for `national`, `regional` for `province` and `state`, and `local` for `municipality`, `city`, and `neighborhood`. Any other string returns null.

## Geography and corpus

A geography gap and a corpus gap are different. A requested level with no coverage cell is one geography gap. A cell whose state is `missing`, `unknown`, or `unavailable` is one corpus gap. `known`, `partial`, and `searched` are not corpus gaps. A coverage gap is not a finding that no law exists. `GapList` renders the `geography` and `corpus` rows. Each row shows its level, place id, and sentence.

Caller IP is not a retrieval input.

## IR rows

`country-laws-ir-graphrag/v1` is read only when the row already names it. A missing `schema_version` returns null. `readIrRow` does not stamp that schema onto a row. `Release.bm25` stays in `ipfs_datasets_py`.
