# Landed display versions

View schema ids below are copied from `src/lib/worldwide/views/`. Place is explicit. GEOIP is absent from the contract fields. This note does not edit `docs/worldwide/supervisor-operations.md`. It does not claim that GitHub Pages is deployed. `tsc`, Jest, and Playwright were not run for this note.

Site `HEAD` is `b96737a90e6de9b55c711e7e33cbd8fc8928f8b6`. These view files are tracked at that revision: `contract.ts`, `law.ts`, `caselaw.ts`, `regulation.ts`, `legislative-act.ts`, and `court.ts`, with their tests. `municipal-instrument.ts` and `municipal-instrument.test.ts` are untracked. The strings below were read from those files.

## Place

`contract.ts` sets `QUERY_PLACE` to `argument`. Its file comment says the query place is an argument, not caller IP, that the module does not read caller IP, and that it does not define a geoip field. `CONTRACT_FIELD_NAMES` is `applicability`, `instrument`, `queryPlace`, `schema`, `views`. That list has no geoip name. `JURISDICTION_APPLICABILITY` is pinned to `not-asserted`, which is `APPLICABILITY` in `src/lib/worldwide/jurisdiction/schema.ts`.

## Contract

`contract.ts` exports `INSTRUMENT_VIEW_CONTRACT_ID` `worldwide-legal-search.instrument-view-contract@1` and `INSTRUMENT_INTERFACE_ID` `legal-corpus.instrument@1`. `instrumentViewContract.schema` is the contract id. `KIND_VERSIONS` in that file is:

| Kind | Version |
| --- | --- |
| `law` | `legal-corpus.law@1` |
| `regulation` | `legal-corpus.regulation@1` |
| `legislative_act` | `legal-corpus.legislative-act@1` |
| `caselaw` | `legal-corpus.caselaw@1` |
| `court` | `legal-corpus.court@1` |
| `municipal_instrument` | `legal-corpus.municipal-instrument@1` |

The statute binding in `VIEW_BINDINGS` also names section schema `worldwide-legal-search.law-section@1`, source schema `country-laws-ir-graphrag/v1`, and verify schema `country-laws-normalize-verify/v1`. Those three strings are the pins in `contract.ts`. `LAW_SOURCE_SCHEMA` in `src/lib/worldwide/data/schema.ts` is `worldwide-legal-search.law-source@1`. `LAW_SECTION_SCHEMA` in that file is `worldwide-legal-search.law-section@1`. `CORPUS_SCHEMA_VERSION` in `src/lib/worldwide/data/identity.ts` is `country-laws-ir-graphrag/v1`. `SCHEMA_VERSION` in `data/schema.ts` is `1`.

## Law

`law.ts` pins `LAW_VIEW_SOURCE_SCHEMA` to `worldwide-legal-search.law-source@1` and `LAW_VIEW_SECTION_SCHEMA` to `worldwide-legal-search.law-section@1`. `LAW_KIND_VERSION` is `legal-corpus.law@1`. `LAW_SOURCE_SCHEMA_VERSION` is `country-laws-ir-graphrag/v1`. `lawView.refuses` is `legal-corpus.caselaw@1`. The file requires `SCHEMA_VERSION` to be `1` and `REQUIRED_LAW_COLUMNS` to be `id`, `title`, `text`.

## Caselaw

`caselaw.ts` pins `CASELAW_VIEW_SCHEMA` to `worldwide-legal-search.caselaw-view@1` and `CASELAW_KIND_VERSION` to `legal-corpus.caselaw@1`. `CASELAW_SOURCE_SCHEMA_ID` is `unversioned`. `caselawView.refuses` is `worldwide-legal-search.law-source@1` and `legal-corpus.law@1`. The file comment says this module does not add a query route and does not read caller IP.

## Regulation

`regulation.ts` pins `REGULATION_VIEW_SCHEMA` to `worldwide-legal-search.regulation-view@1` and `REGULATION_KIND_VERSION` to `legal-corpus.regulation@1`. `REGULATION_SOURCE_SCHEMA_IDS` is:

- `cfr-annual-processor-v1`
- `live-cfr-source-processor-v1`
- `ecfr-crosscheck-processor-v1`
- `federal-register-change-processor-v1`
- `federal-register-sparse-graphrag-release-schema-v2`

`regulationView.refuses` is `country-laws-ir-graphrag/v1`, `worldwide-legal-search.law-source@1`, and `legal-corpus.law@1`.

## Legislative act

`legislative-act.ts` pins `LEGISLATIVE_ACT_VIEW_SCHEMA` to `worldwide-legal-search.legislative-act-view@1` and `LEGISLATIVE_ACT_KIND_VERSION` to `legal-corpus.legislative-act@1`. `ACT_SOURCE_SCHEMA_IDS` is `public-law-change-processor-v1` and `public-law-change-fixture-v1`. `legislativeActView.refuses` is `legal-corpus.law@1` plus `USCODE_LAW_SCHEMA_IDS`:

- `uscode-release-processor-v1`
- `uscode-release-fixture-v1`
- `uscode-sparse-graphrag-release-schema-v2`
- `publicus-ir-graphrag/v2`

The file also pins `REFUSED_LAW_SOURCE_SCHEMA` to `worldwide-legal-search.law-source@1`. That constant is not an entry in `legislativeActView.refuses`.

## Court

`court.ts` pins `COURT_VIEW_SCHEMA` to `worldwide-legal-search.court-view@1` and `COURT_KIND_VERSION` to `legal-corpus.court@1`. `COURT_SOURCE_SCHEMA_ID` is `unversioned`. `WORLD_COURTS_REPO` is `endomorphosis/world_courts`. The file comment says that repo id is not the schema id. `courtView.refuses` is `legal-corpus.caselaw@1`, `country-laws-ir-graphrag/v1`, `endomorphosis/world_courts`, `worldwide-legal-search.law-source@1`, and `legal-corpus.law@1`. `OPINION_BODY_FIELDS` is `text`, `opinion_text`, and `case_text`. The file comment says those keys are not view fields and that the view model has no opinion body field.

## Municipal instrument

`municipal-instrument.ts` is untracked. It pins `MUNICIPAL_INSTRUMENT_VIEW_SCHEMA` to `worldwide-legal-search.municipal-instrument-view@1` and `MUNICIPAL_KIND_VERSION` to `legal-corpus.municipal-instrument@1`. `MUNICIPAL_SOURCE_SCHEMA_FILE` is `world_municipal/schema.py`. The file says that path assigns no `SCHEMA_VERSION`. `MUNICIPAL_COLUMNS` is these 19 names, in this order: `cid`, `jurisdiction_id`, `jurisdiction_name`, `country`, `doc_id`, `regeling_id`, `regeling_work_id`, `doc_order`, `title`, `structural_path`, `node_label`, `html_title`, `html`, `text`, `source_url`, `xml_url`, `date_effective`, `date_modified`, `retrieved`. `municipalInstrumentView.refuses` is `legal-corpus.law@1`, `worldwide-legal-search.law-source@1`, and `country-laws-ir-graphrag/v1`.
