# Level coverage gap goals

Root, goals, and subgoals are planning records. Completion is not these status fields. This package is not admitted to a DuckDB board. `PLAN.md` is the contract. The default implementation model is Grok Build `grok-4.7`.

## LCG-G000 Retrieve every government level and name the gaps
- Status: planned
- Parent goal ids json: []
- Required task ids json: ["LCG-001", "LCG-002", "LCG-003", "LCG-004", "LCG-005", "LCG-006", "LCG-007"]
- Objective: National through neighborhood retrieval stays caller-independent, and missing geography is listed apart from a missing corpus.
- Acceptance: Every required task has an evidence file and a passing fixed check.
- Board namespace: level-coverage-gaps-v1
- Completion authority: not admitted

## LCG-G010 Government levels
- Status: planned
- Parent goal ids json: ["LCG-G000"]
- Required task ids json: ["LCG-001", "LCG-003"]
- Objective: The six levels name a band without editing `bandForLevel`.
- Acceptance: The LCG-001 and LCG-003 evidence checks exit 0.
- Board namespace: level-coverage-gaps-v1
- Completion authority: not admitted

## LCG-G010.S1 Name the six levels
- Status: planned
- Parent goal ids json: ["LCG-G010"]
- Required task ids json: ["LCG-001"]
- Objective: `national`, `province`, `state`, `municipality`, `city`, and `neighborhood` map to `national`, `regional`, or `local`.
- Acceptance: The LCG-001 evidence check exits 0.
- Board namespace: level-coverage-gaps-v1
- Completion authority: not admitted

## LCG-G010.S2 Retrieval accepts those levels
- Status: planned
- Parent goal ids json: ["LCG-G010"]
- Required task ids json: ["LCG-003"]
- Objective: A province or state filter is regional. A city, municipality, or neighborhood filter stays on the municipal path.
- Acceptance: The LCG-003 evidence check exits 0.
- Board namespace: level-coverage-gaps-v1
- Completion authority: not admitted

## LCG-G020 Gap lists
- Status: planned
- Parent goal ids json: ["LCG-G000"]
- Required task ids json: ["LCG-002", "LCG-004"]
- Objective: A missing place and a missing collection are different gap rows.
- Acceptance: The LCG-002 and LCG-004 evidence checks exit 0.
- Board namespace: level-coverage-gaps-v1
- Completion authority: not admitted

## LCG-G020.S1 Separate geography from corpus
- Status: planned
- Parent goal ids json: ["LCG-G020"]
- Required task ids json: ["LCG-002"]
- Objective: Geography gaps name a level with no place. Corpus gaps name a place whose collection was not searched.
- Acceptance: The LCG-002 evidence check exits 0.
- Board namespace: level-coverage-gaps-v1
- Completion authority: not admitted

## LCG-G020.S2 Version the gap view
- Status: planned
- Parent goal ids json: ["LCG-G020"]
- Required task ids json: ["LCG-004"]
- Objective: The coverage page shows the gap list under `worldwide-legal-search.gap-list@1`.
- Acceptance: The LCG-004 evidence check exits 0.
- Board namespace: level-coverage-gaps-v1
- Completion authority: not admitted

## LCG-G030 IR row reader
- Status: planned
- Parent goal ids json: ["LCG-G000"]
- Required task ids json: ["LCG-005"]
- Objective: TypeScript accepts a country-laws IR row only when the row already names the Python schema.
- Acceptance: The LCG-005 evidence check exits 0.
- Board namespace: level-coverage-gaps-v1
- Completion authority: not admitted

## LCG-G030.S1 Follow the Python field guide
- Status: planned
- Parent goal ids json: ["LCG-G030"]
- Required task ids json: ["LCG-005"]
- Objective: Quote `country-laws-ir-graphrag/v1` and the entry and law identity schemas. Do not port `Release.bm25`.
- Acceptance: The LCG-005 evidence check exits 0.
- Board namespace: level-coverage-gaps-v1
- Completion authority: not admitted

## LCG-G040 Documentation
- Status: planned
- Parent goal ids json: ["LCG-G000"]
- Required task ids json: ["LCG-006"]
- Objective: One note quotes the schema ids that this campaign landed.
- Acceptance: The LCG-006 evidence check exits 0.
- Board namespace: level-coverage-gaps-v1
- Completion authority: not admitted

## LCG-G040.S1 Quote the landed ids
- Status: planned
- Parent goal ids json: ["LCG-G040"]
- Required task ids json: ["LCG-006"]
- Objective: The note says the package is in this tree and names both gap kinds.
- Acceptance: The LCG-006 evidence check exits 0.
- Board namespace: level-coverage-gaps-v1
- Completion authority: not admitted

## LCG-G050 Proof
- Status: planned
- Parent goal ids json: ["LCG-G000"]
- Required task ids json: ["LCG-007"]
- Objective: Re-run the new tests, the retrieval regressions, and doc drift.
- Acceptance: The LCG-007 evidence check exits 0.
- Board namespace: level-coverage-gaps-v1
- Completion authority: not admitted

## LCG-G050.S1 Record the exit codes
- Status: planned
- Parent goal ids json: ["LCG-G050"]
- Required task ids json: ["LCG-007"]
- Objective: The evidence file records each command's exit code. No product file changes.
- Acceptance: The LCG-007 evidence check exits 0.
- Board namespace: level-coverage-gaps-v1
- Completion authority: not admitted
