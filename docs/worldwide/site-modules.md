# Site modules

The package is in this tree. Page modules are `src/components/worldwide/LawReader.tsx`, `src/components/worldwide/ResearchPanel.tsx`, and `src/components/worldwide/SourcePage.tsx`. View modules are `src/lib/worldwide/views/law.ts`, `src/lib/worldwide/views/caselaw.ts`, `src/lib/worldwide/views/regulation.ts`, `src/lib/worldwide/views/legislative-act.ts`, `src/lib/worldwide/views/court.ts`, and `src/lib/worldwide/views/municipal-instrument.ts`. `selectInstrumentView` in `src/lib/worldwide/views/select.ts` chooses a view.

## Page schemas

`LawReader` publishes `READER_SCHEMA` `worldwide-legal-search.law-reader@1` on `data-schema`.

`ResearchPanel` publishes `RESEARCH_SCHEMA` `worldwide-legal-search.research-panel@1` on `data-schema`.

`SourcePage` publishes `SOURCE_PAGE_SCHEMA` `worldwide-legal-search.source-page@1`. `SourcePage` renders a catalog source and does not select an instrument view.

## View ids

`law.ts` pins `LAW_VIEW_SOURCE_SCHEMA` to `worldwide-legal-search.law-source@1`. That string is `LAW_SOURCE_SCHEMA` in `src/lib/worldwide/data/schema.ts`.

`caselaw.ts` pins `CASELAW_VIEW_SCHEMA` to `worldwide-legal-search.caselaw-view@1`.

`regulation.ts` pins `REGULATION_VIEW_SCHEMA` to `worldwide-legal-search.regulation-view@1`.

`legislative-act.ts` pins `LEGISLATIVE_ACT_VIEW_SCHEMA` to `worldwide-legal-search.legislative-act-view@1`.

`court.ts` pins `COURT_VIEW_SCHEMA` to `worldwide-legal-search.court-view@1`.

`municipal-instrument.ts` pins `MUNICIPAL_INSTRUMENT_VIEW_SCHEMA` to `worldwide-legal-search.municipal-instrument-view@1`. That module is in this tree.

## Search rows

A search row receives `data-instrument-view` only when the hit already names an accepted pair. `ResultList` passes `interfaceId` and `sourceSchemaId` into `ResultItem` only when that hit already has both. `ResultItem` calls `selectInstrumentView`. A filter token leaves the attribute unset.

## Index compatibility

`country_ir_schema` is file-level compatibility, not a per-hit claim. `data/worldwide/index-format.schema.json` places that string on the index file's `compatibility` object.
