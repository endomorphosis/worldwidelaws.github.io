# Website baseline and migration record

WWL-000 records the existing WetWijzer website and leaves application code, corpus samples, reference checkouts, and unrelated dirty paths unchanged.

Site revision: `ba6390a65a210e493e122c1c7bae9bd2ba920c0d`
Site tree: `d3e9b09e10407e93d141a0e779d755b96f109b00`
Recorded at: 2026-10-27T01:25:52Z

## Source revisions

| Role | Path | Head | Planning inspection | Matches planning pin |
| --- | --- | --- | --- | --- |
| product_primary_checkout | `/home/barberb/worldwidelaws.github.io` | `ba6390a65a210e493e122c1c7bae9bd2ba920c0d` | `0793a9efefbee25e3ccaa08f5723556b33389350` | False |
| native_supervisor_reference | `/home/barberb/ipfs_accelerate_py` | `4852f419e93f620963708a0b327951d64f5de66f` | `e6c05aeccf73f1d9bf6f7d0a1a44931ad5fa0bd5` | False |
| primary_datasets_reference | `/home/barberb/lift_coding/external/ipfs_datasets` | `7ba681c2eea75ced6592254bf1125d10464b2c2b` | `7ba681c2eea75ced6592254bf1125d10464b2c2b` | True |
| secondary_datasets_reference | `/home/barberb/ipfs_datasets_py` | `a2cf0577d8712424b1213b72f32cc3a93055b1ec` | `a2cf0577d8712424b1213b72f32cc3a93055b1ec` | True |
| operational_framework_worktree | `/home/barberb/.local/state/ipfs_accelerate_py/worldwide-legal-search-v1/framework` | `2e060d3c1b96d87c42783c1e9589f80654e4ba5c` | `` | None |

The product worktree used to write this record is the same commit as the canonical checkout and is a separate branch. Its subject is Wait through resource pressure and gate watchdog actions by capability.

## Unrelated dirty paths

These paths were dirty at record time. WWL-000 did not edit, stage, revert, or delete them.

| Repository | Status | Path | Kind |
| --- | --- | --- | --- |
| native_supervisor_reference | ` M` | `docs/fastmcp` | gitlink |
| native_supervisor_reference | ` M` | `ipfs_kit_py` | gitlink |
| native_supervisor_reference | ` M` | `ipfs_model_manager_py` | gitlink |
| native_supervisor_reference | ` M` | `test/doc-builder` | gitlink |
| native_supervisor_reference | ` M` | `test/huggingface_doc_builder` | gitlink |
| native_supervisor_reference | ` M` | `test/huggingface_transformers` | gitlink |
| primary_datasets_reference | ` M` | `ipfs_accelerate_py` | gitlink |
| primary_datasets_reference | ` M` | `ipfs_datasets_py/vector_stores/duckdb_store.py` | file |
| primary_datasets_reference | ` M` | `ipfs_datasets_py/vector_stores/management_engine.py` | file |
| primary_datasets_reference | `??` | `tests/unit/vector_stores/test_matched_document_payloads.py` | file |
| secondary_datasets_reference | ` M` | `ipfs_datasets_py/mcp_server/tools/web_archive_tools/archive_check_submit.py` | file |
| secondary_datasets_reference | ` M` | `ipfs_datasets_py/mcp_server/tools/web_archive_tools/archive_is_integration.py` | file |
| secondary_datasets_reference | ` M` | `ipfs_datasets_py/mcp_server/tools/web_archive_tools/wayback_machine_search.py` | file |
| prior_wwl_000_attempt | `??` | `docs/worldwide/baseline.json` | file |

## Active lanes

The scheduler profile admits one lane. This attempt is the only site writer for these outputs.

- `site-implementation`: The single site writer for this attempt. (ba6390a65a210e493e122c1c7bae9bd2ba920c0d)
- `site-primary-checkout`: Canonical checkout named by config/worldwide_supervisor_host.json site_root. Not the writer for these outputs. (ba6390a65a210e493e122c1c7bae9bd2ba920c0d)
- `prior-attempt-worktree`: Earlier WWL-000 attempt. Its untracked baseline stays in that worktree. (3e9c3be95b09039cb7f0c1894dfc24e85e77cd30)
- `campaign-observation`: Native campaign snapshot observed while this record was written. It is not a second writer. (provider)
- `worldwide-legal-search-supervisor.service`: Observed user service. This task did not start, stop, or restart it. (active)
- `worldwide-legal-search-watchdog.service`: Observed user service. This task did not start, stop, or restart it. (active)
- `operational-framework`: Separate operational worktree. It is not a website writer for WWL-000. (2e060d3c1b96d87c42783c1e9589f80654e4ba5c)

## Reachable application imports

Static walk from `index.html` through `src/main.tsx` reaches 259 local files.
Static external packages: @duckdb/duckdb-wasm, https://plausible.io/js/script.js, react, react-dom, react-toastify, uplot.
Counts by root: `{"api": 0, "convex": 0, "disabled_components": 0, "disabled_hooks": 0, "disabled_services": 0, "disabled_tests": 0, "src/components": 2, "src/editor": 0, "src/hooks": 0, "src/lib": 254, "src/lib/logic": 244, "src/workers": 0}`. The `src/lib` count includes the `src/lib/logic` subset.
The static shell is `src/AppStatic.tsx`, `src/components/StaticDataProvider.tsx`, and `src/components/WetWijzerLegalResearchApp.tsx`. `src/App.tsx`, `api/`, `convex/`, the editor, and the disabled trees are not on that static path.
Worker URL edges: [{"from": "src/lib/clientEmbeddingWorkerService.ts", "target": "src/workers/embeddingWorker.ts", "locality": "local"}, {"from": "src/lib/clientLLMWorkerService.ts", "target": "src/workers/clientLLMWorker.ts", "locality": "local"}].
Dynamic external packages reached after following dynamic imports and workers: @huggingface/transformers.

## Current build and test results

Commands ran with PATH limited to `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin` and a private HOME. `node_modules` is absent, so `tsc` and `jest` are absent. Dependencies were not installed.

| Command | Exit | Evidence SHA-256 | Result |
| --- | --- | --- | --- |
| `/usr/bin/python3.12 --version` | 0 | `5b3e43dc38ca01e3f5a7854ba50d4330864b0c1e0f646650b2c78cf072acc366` | Python 3.12 on the sealed PATH. |
| `/usr/bin/node --version` | 0 | `de9740f54a0a5f57119f0e1aadf93712af9c6f5fdea2b8048d9775f8ee38c681` | Node on the sealed PATH. |
| `/usr/bin/npm --version` | 0 | `b90f6efb804599bb0ba84fec754b8c7807381dabfcdc1ffe3437ff37f18fb0f5` | npm on the sealed PATH. |
| `/usr/bin/npm --offline run build` | 127 | `03bab61eb9dbc0217c8454f77b9fecaed1a263f928c74e867fca384b0e8d2b4c` | Package build. node_modules is absent, so tsc is not installed. |
| `/usr/bin/npm --offline test -- --runTestsByPath src/lib/netherlandsLogic.test.ts --watchAll=false` | 127 | `ecea585cae3d03bbdca02e2b638f611d491baaca27106dcd951dbf5ef18d81f2` | Netherlands logic Jest file. jest is absent because node_modules is not installed. |
| `/usr/bin/node scripts/prepare-netherlands-corpus.mjs --validate-only --no-extract` | 0 | `0451f782d177c7c67e4ee4937734d4c8c09eb57b25abd6f404e2e09affceb949` | Read-only validation of the bundled WetWijzer sample. |
| `/usr/bin/python3.12 -B scripts/worldwide_supervisor_host.py status` | 1 | `bf6601cd6fa98475c49a96c53600eae188dbd34ea044dbe1ad34c3f7d5126de1` | Host status from the implementation worktree. |
| `/usr/bin/python3.12 -B scripts/worldwide_supervisor_host.py status` | 0 | `6fa19f2ca17eca7b50e713576604b7f464b2b755a604db0d2a8413531b6a6856` | Host status from the canonical site checkout. |
| `/usr/bin/systemctl --user show worldwide-legal-search-supervisor.service worldwide-legal-search-watchdog.service --property=Id,ActiveState,SubState,MainPID,Result,NRestarts` | 0 | `896f1999b14ebcf9b1c6774130c698518f2fa6bf0399b09c68ce0cc73fe9762c` | User service state for the campaign supervisor and watchdog. |
| `/usr/bin/node --experimental-transform-types /home/barberb/.local/state/ipfs_accelerate_py/worldwide-legal-search-v1/campaign/native/wwl_database_portal_attempts/f73607787f39860dd8a47ab0/implementation_checkpoints/wwl-000-46f8ba332279/netherlands-behavior-probe.mjs` | 0 | `4e9143c7b1a01fcf378a0827599ae615af8616d2457f30c52b68974eecf7ca25` | Executed src/lib/netherlandsCorpus.ts. Remote fetch was refused 103 times before any network call. Load returned 3 sections with provider static-sample. |
## Netherlands behavior

With remote fetch refused (103 refusals, no network call), `loadWetWijzerCorpus()` returned provider `static-sample` and 3 bundled articles. The manifest still names dataset `justicedao/wetwijzer_netherlands_legal_corpus`.
The bundled sample is three labelled articles. The manifest's published partial corpus counts are 4999 laws, 89737 articles, 94736 CID rows, and 261720 relationship rows. The sample is not that corpus.
Logic norm fields below are copied from `logic-proof-summaries.json`. `netherlandsLogic.ts` was not executed.

| Article | Law | Source | Status | Norm |
| --- | --- | --- | --- | --- |
| Wetboek van Strafrecht - Artikel 1 | `BWBR0001854` | https://wetten.overheid.nl/BWBR0001854 | current | O obligation |
| Burgerlijk Wetboek Boek 1 - Artikel 1 | `BWBR0002656` | https://wetten.overheid.nl/BWBR0002656 | current | P permission |
| Wetboek van Burgerlijke Rechtsvordering - Artikel 1 | `BWBR0001827` | https://wetten.overheid.nl/BWBR0001827 | current | F prohibition |

Executed fallback searches:

- `keyword` `Wetboek van Strafrecht artikel 1`: 3 result(s); BWBR0001854 (1.46651306219146), BWBR0001827 (0.5569356301483368), BWBR0002656 (0.4849521052776313).
- `hybrid` `Wetboek van Strafrecht artikel 1`: 3 result(s); BWBR0001854 (1.46651306219146), BWBR0001827 (0.5569356301483368), BWBR0002656 (0.4849521052776313).
- `keyword` `Burgerlijk Wetboek`: 3 result(s); BWBR0002656 (4.138239802328455), BWBR0001827 (0.13494691975481787), BWBR0001854 (0.12945755352750327).
- `hybrid` `Burgerlijk Wetboek`: 3 result(s); BWBR0002656 (4.138239802328455), BWBR0001827 (0.13494691975481787), BWBR0001854 (0.12945755352750327).
- `keyword` `legaliteitsbeginsel`: 0 result(s); no hits.
- `hybrid` `legaliteitsbeginsel`: 0 result(s); no hits.
- `keyword` `rechtsvordering`: 1 result(s); BWBR0001827 (3.9912267362592004).
- `hybrid` `rechtsvordering`: 1 result(s); BWBR0001827 (3.9912267362592004).
- `keyword` `BWBR0001854`: 1 result(s); BWBR0001854 (2.9509056486825553).
- `hybrid` `BWBR0001854`: 1 result(s); BWBR0001854 (2.9509056486825553).
- `keyword` `strafbaar`: 1 result(s); BWBR0001854 (0.9509056486825552).
- `hybrid` `strafbaar`: 1 result(s); BWBR0001854 (0.9509056486825552).
- `keyword` `Artikel 1`: 3 result(s); BWBR0002656 (3.2121665460589637), BWBR0001827 (3.2109943551967595), BWBR0001854 (3.206432315084397).
- `hybrid` `Artikel 1`: 3 result(s); BWBR0002656 (3.2121665460589637), BWBR0001827 (3.2109943551967595), BWBR0001854 (3.206432315084397).

## Route migration table

The current application has no hash router. The table preserves today's surfaces and names the later worldwide routes from the campaign plan. WWL-000 does not add those routes.

| Current surface | Observed identity | Preservation rule | Later route, not built here |
| --- | --- | --- | --- |
| `https://wetwijzer.github.io/` and `index.html` | title `WetWijzer, Nederlandse wetzoeker`, language `nl-NL` | Keep the static shell working until a later UI task switches it | `/#/search` |
| React state, not the URL | initial query `Wetboek van Strafrecht artikel 1` | Keep the example available | `/#/search?q=Wetboek+van+Strafrecht+artikel+1&place=netherlands` |
| Example buttons | Wetboek van Strafrecht artikel 1, Burgerlijk Wetboek, legaliteitsbeginsel, rechtsvordering | Keep these as labelled examples | search suggestions |
| Result link `section.source_url` | `https://wetten.overheid.nl/<BWB-id>`, new tab, `rel=noreferrer` | Publisher link, not an application route | remain beside `/#/law/<record-id>?revision=<source-revision>` |
| Sample CID `bafywetwijzer…001` through `003` | provider `static-sample` | Label the three-article sample; do not present it as the published partial corpus | coverage state `partial` |
| Dataset ids in `artifacts.manifest.json` | unified `justicedao/wetwijzer_netherlands_legal_corpus` plus legacy base, vector, BM25, and graph repos | Preserve the source ids and version metadata | revision-pinned catalog |
| `api/` and `convex/` | not on the static entry path | Worldwide search must keep working when those services are unavailable | unchanged by this record |

## What this record does not change

- No application, corpus, package, or protected plan file was edited.
- `node_modules` was not installed.
- The prior attempt worktree and its untracked baseline were left in place.
- Reference repository dirty gitlinks and files were left in place.
- Native merge admission and campaign completion are not claimed.
