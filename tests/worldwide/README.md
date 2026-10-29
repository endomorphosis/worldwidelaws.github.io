# Worldwide fixture conventions

This directory holds the production fixtures and browser specs for the worldwide legal search campaign. The checkers in `scripts/worldwide/check-contracts.mjs` and `scripts/worldwide/audit.mjs` reject invalid inputs. A path, an `exists` flag, or a file listing is not evidence.

## Purpose

Fixtures fix observable behavior: inputs, expected values, cited sources, and explicit uncertainty. They do not stand in for a legal holding. Adversarial fixtures are synthetic and must say so. Reference fixtures that claim to be real must cite a source and must not fabricate a conclusion.

## Layout

- `tests/worldwide/*.test.ts` and `*.test.tsx` are Jest unit and component tests. Playwright does not collect them.
- `tests/worldwide/*.spec.ts` are Playwright browser specs. Jest does not collect them.
- `tests/worldwide/fixtures/*.json` is data. Neither runner executes JSON.
- Audit documents that are not fixtures live under `data/worldwide/` and `docs/worldwide/` and are checked by `node scripts/worldwide/audit.mjs <mode>`.

## Fixture schema

Every fixture object uses `worldwide-legal-search.fixture@1`.

Required fields are `fixture_id`, `kind`, `purpose`, `source`, `inputs`, `expected`, `uncertainty`, and `adversarial`. `fixture_id` is a lowercase slug. `kind` is one of `jurisdiction-case`, `retrieval-judgment`, `parity`, `adversarial`, `transport`, `geography`, `normalization`, or `citation`. `source.citation` names a real instrument, or the exact label `synthetic-adversarial` when `adversarial` is true. `source.url` is `null` or an `https` URL. `source.revision` is a pinned hex revision or `null`. `source.license` is stated even when it is `unknown`. `expected.legal_conclusion` stays `not_claimed` unless `source.quotation` quotes the source or the fixture is adversarial. `uncertainty` is a non-empty list of unknowns. Repository paths are relative and cannot contain `..`.

## Valid fixture

```json valid-fixture
{
  "schema": "worldwide-legal-search.fixture@1",
  "fixture_id": "nl-wetboek-van-strafrecht-artikel-1",
  "kind": "jurisdiction-case",
  "purpose": "Cited Dutch national article used as a jurisdiction fixture without a legal holding.",
  "source": {
    "citation": "Wetboek van Strafrecht artikel 1",
    "url": "https://wetten.overheid.nl/BWBR0001854",
    "revision": null,
    "license": "unknown",
    "fabricated_legal_conclusion": false,
    "quotation": null
  },
  "inputs": {
    "coverage_class": "nl",
    "country": "NL",
    "place": "Netherlands",
    "as_of": "2026-10-26"
  },
  "expected": {
    "legal_conclusion": "not_claimed",
    "jurisdiction_level": "national",
    "source_url": "https://wetten.overheid.nl/BWBR0001854"
  },
  "uncertainty": [
    "This fixture does not decide applicability to a person or dispute."
  ],
  "adversarial": false
}
```

## Invalid fixtures

```json invalid-fixture existence_only
{
  "schema": "worldwide-legal-search.fixture@1",
  "exists": true,
  "path": "tests/worldwide/fixtures/example.json"
}
```

```json invalid-fixture unsafe_path
{
  "schema": "worldwide-legal-search.fixture@1",
  "fixture_id": "nl-wetboek-van-strafrecht-artikel-1",
  "kind": "jurisdiction-case",
  "purpose": "Cited Dutch national article used as a jurisdiction fixture without a legal holding.",
  "source": {
    "citation": "Wetboek van Strafrecht artikel 1",
    "url": "https://wetten.overheid.nl/BWBR0001854",
    "revision": null,
    "license": "unknown",
    "fabricated_legal_conclusion": false,
    "quotation": null
  },
  "inputs": {
    "coverage_class": "nl",
    "country": "NL",
    "place": "Netherlands",
    "as_of": "2026-10-26",
    "path": "../secrets.env"
  },
  "expected": {
    "legal_conclusion": "not_claimed",
    "jurisdiction_level": "national"
  },
  "uncertainty": [
    "This fixture does not decide applicability to a person or dispute."
  ],
  "adversarial": false
}
```

```json invalid-fixture fabricated_conclusion
{
  "schema": "worldwide-legal-search.fixture@1",
  "fixture_id": "nl-wetboek-van-strafrecht-artikel-1",
  "kind": "jurisdiction-case",
  "purpose": "Cited Dutch national article used as a jurisdiction fixture without a legal holding.",
  "source": {
    "citation": "Wetboek van Strafrecht artikel 1",
    "url": "https://wetten.overheid.nl/BWBR0001854",
    "revision": null,
    "license": "unknown",
    "fabricated_legal_conclusion": true,
    "quotation": null
  },
  "inputs": {
    "coverage_class": "nl",
    "country": "NL",
    "place": "Netherlands",
    "as_of": "2026-10-26"
  },
  "expected": {
    "legal_conclusion": "not_claimed",
    "jurisdiction_level": "national"
  },
  "uncertainty": [
    "This fixture does not decide applicability to a person or dispute."
  ],
  "adversarial": false
}
```

## Validation commands

The board runs these production commands. They forward extra arguments and do not swallow failures.

- `node scripts/worldwide/audit.mjs harness`
- `node scripts/worldwide/audit.mjs <mode>`
- `npm test -- --runInBand --runTestsByPath <test>`
- `npm run test:playwright -- <spec>`
- `npm run worldwide:audit -- <mode>`
- `npm run worldwide:harness`
- `npm run worldwide:check-contracts`
- `npm run test:worldwide`

`npm test` stays the Jest entry the board appends to. `test:worldwide` runs the worldwide Jest tests once (`--runInBand --watchAll=false`). Playwright keeps `tests/**/*.spec.ts` and ignores Jest tests and `fixtures/`.

## Campaign worktree

Website tasks run in a linked git worktree. The durable campaign branch is `agent/worldwide-legal-search-v1`. An attempt branch matches `implementation/wwl-` plus the task id, revision, attempt, and timestamp, for example `implementation/wwl-001-…`. `harness` checks that the current checkout is that branch or the durable campaign branch, that `HEAD` is a commit, and that `git worktree list` registers the directory. An `implementation/wwl-` branch must be a linked worktree, not a second copy of an unrelated checkout.

## Rejection rules

The checkers reject invalid inputs. They do not pass because a file is present.

- Existence-only objects (`exists`, `file_exists`, `path`, or a schema with no behavior) fail.
- Unsafe paths, null bytes, and non-https source URLs fail.
- Fabricated legal conclusions and unquoted holdings fail on non-adversarial fixtures.
- Organization membership never counts as a redistribution license.
- A complete source inventory must exhaust pagination for `justicedao` and `endomorphosis`. A partial inventory must say why.
- Code-only releases cannot be included as law text.
- Collection counts and legal completeness stay separate. A catalog cannot treat a count as `complete`.
- Performance ceilings are the PLAN.md mid-range mobile figures: 350 KiB gzip shell, 1 MiB catalog, 10 MiB first place search, 1s warm p95, 5s cold p95, 4 concurrent requests, and 256 MiB heap. Looser targets fail.
- CI and deploy workflows fail when a required gate sets `continue-on-error: true`.
- WWL-114 closure keeps `own_receipt` pending. The checker does not look for that future receipt.
- Source-job ids embed the first 16 hex characters of SHA-256 over `JSON.stringify` of `dataset_id, resolved_revision, config, split, jurisdiction_id, shard_id, phase`.

## Audit documents

Each board mode reads the evidence below and runs the production checker. Missing or invalid evidence exits non-zero.

| Mode | Evidence |
| --- | --- |
| harness | workspace commands, configs, this document, campaign worktree, and adversarial CLI probes |
| source-inventory | `data/worldwide/source-inventory.json` |
| source-dispositions | `data/worldwide/source-dispositions.json` |
| rights | `data/worldwide/rights.json` |
| catalog | `data/worldwide/catalog.schema.json` |
| inventory-closure | `data/worldwide/ingestion-ledger.json` and `docs/worldwide/coverage-audit.json` |
| geography | `data/worldwide/geography-manifest.json` |
| jurisdiction-fixtures | `tests/worldwide/fixtures/jurisdiction-cases.json` |
| retrieval-evaluation | `tests/worldwide/fixtures/retrieval-evaluation.json` |
| ux-contract | `docs/worldwide/interaction-states.json` and `docs/worldwide/design.md` |
| performance | `docs/worldwide/performance.json` |
| ci-contract | `.github/workflows/worldwide-checks.yml` and `docs/worldwide/regression-selection.json` |
| product-acceptance | `docs/worldwide/product-acceptance.json` |
| maintenance | `docs/worldwide/maintenance.md` and `scripts/worldwide/refresh.ts` |
| release-candidate | `docs/worldwide/release-candidate.json` and `.github/workflows/deploy.yml` |
| deployment | `docs/worldwide/deployment.json` |
| public-smoke | `docs/worldwide/public-smoke.json` |
| campaign-closure | `docs/worldwide/campaign-closure.json` and `docs/worldwide/future-coverage.json` |
| source-job | `artifacts/worldwide-legal-search/sources/<source>/<shard>/<phase>.manifest.json` |

Jurisdiction bundles must include the classes `nl`, `federal`, `multilingual`, `rtl-or-non-latin`, `special-or-overlapping`, and `absent-municipal`. Retrieval judgments must cover national, regional, and municipal records plus a non-Latin query, and unsupported coverage stays explicit. Product acceptance is an independent actor and covers place, date, citation, coverage, rtl, mobile, and no-backend. Public smoke covers place search, source reading, manual override, deep links, no-backend mode, and coverage, and it keeps a distinct prior release digest.
