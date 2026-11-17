# Hub source schemas

The package is in this tree. `src/lib/worldwide/data/hub-bindings.ts` records a dataset id together with the interface id and source schema id a landed constant already assigns. A Hugging Face dataset id is not a source schema id. `SourcePage` publishes `worldwide-legal-search.source-page@1`.

## Bound rows

| Dataset id | Interface id | Source schema id |
| --- | --- | --- |
| `endomorphosis/world_courts` | `legal-corpus.court@1` | `unversioned` |
| `endomorphosis/world_caselaw` | `legal-corpus.caselaw@1` | `unversioned` |
| `justicedao/Caselaw_Access_Project_embeddings` | `legal-corpus.caselaw@1` | `unversioned` |
| `endomorphosis/world_municipal_law` | `legal-corpus.municipal-instrument@1` | `world_municipal/schema.py` |

`endomorphosis/world_courts` and `endomorphosis/world_caselaw` keep schema id `unversioned`. `justicedao/Caselaw_Access_Project_embeddings` keeps schema id `unversioned`. `endomorphosis/world_municipal_law` keeps source schema id `world_municipal/schema.py`. Each source schema id differs from its dataset id.

## Unmarked rows

`endomorphosis/world_national_law` is not bound to `country-laws-ir-graphrag/v1`. `justicedao/wetwijzer_netherlands_legal_corpus` receives no instrument claim from this table. A regulation processor id is not a key in this table.
