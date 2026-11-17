# Site instrument module goals

Root, goals, and subgoals are planning records. Completion is not these status fields. This package is not admitted to a DuckDB board. `PLAN.md` is the contract. The default implementation model is Grok Build `grok-4.7`.

## SIM-G000 Version the site surfaces that render a legal record
- Status: planned
- Parent goal ids json: []
- Required task ids json: ["SIM-001", "SIM-002", "SIM-004", "SIM-005", "SIM-006", "SIM-007"]
- Objective: Reader, research, search, and the index each keep a versioned schema and show an instrument view only for a claim the record already names.
- Acceptance: Every required task has an evidence file and a passing fixed check.
- Board namespace: site-instrument-modules-v1
- Completion authority: not admitted

## SIM-G010 Law reader marker
- Status: planned
- Parent goal ids json: ["SIM-G000"]
- Required task ids json: ["SIM-001"]
- Objective: LawReader keeps `worldwide-legal-search.law-reader@1` and sets `data-instrument-view` only for an accepted claim.
- Acceptance: The SIM-001 evidence check exits 0.
- Board namespace: site-instrument-modules-v1
- Completion authority: not admitted

## SIM-G010.S1 Optional reader claim
- Status: planned
- Parent goal ids json: ["SIM-G010"]
- Required task ids json: ["SIM-001"]
- Objective: One optional instrument prop on the existing reader.
- Acceptance: The SIM-001 evidence check exits 0.
- Board namespace: site-instrument-modules-v1
- Completion authority: not admitted

## SIM-G020 Research passage marker
- Status: planned
- Parent goal ids json: ["SIM-G000"]
- Required task ids json: ["SIM-002"]
- Objective: ResearchPanel keeps `worldwide-legal-search.research-panel@1` and marks a passage only when that passage already names an accepted pair.
- Acceptance: The SIM-002 evidence check exits 0.
- Board namespace: site-instrument-modules-v1
- Completion authority: not admitted

## SIM-G020.S1 Passage claim
- Status: planned
- Parent goal ids json: ["SIM-G020"]
- Required task ids json: ["SIM-002"]
- Objective: Optional claim fields on a research passage.
- Acceptance: The SIM-002 evidence check exits 0.
- Board namespace: site-instrument-modules-v1
- Completion authority: not admitted

## SIM-G040 Current module note
- Status: planned
- Parent goal ids json: ["SIM-G000"]
- Required task ids json: ["SIM-004"]
- Objective: One note quotes the schema ids the site publishes today.
- Acceptance: The SIM-004 evidence check exits 0.
- Board namespace: site-instrument-modules-v1
- Completion authority: not admitted

## SIM-G040.S1 Quote the landed schemas
- Status: planned
- Parent goal ids json: ["SIM-G040"]
- Required task ids json: ["SIM-004"]
- Objective: `docs/worldwide/site-modules.md` names the page schemas and the six view ids.
- Acceptance: The SIM-004 evidence check exits 0.
- Board namespace: site-instrument-modules-v1
- Completion authority: not admitted

## SIM-G050 Index claim preservation
- Status: planned
- Parent goal ids json: ["SIM-G000"]
- Required task ids json: ["SIM-006"]
- Objective: A compact summary copies an interface id and a source schema id only when the source document already has both.
- Acceptance: The SIM-006 evidence check exits 0.
- Board namespace: site-instrument-modules-v1
- Completion authority: not admitted

## SIM-G050.S1 Optional summary fields
- Status: planned
- Parent goal ids json: ["SIM-G050"]
- Required task ids json: ["SIM-006"]
- Objective: The index schema stays closed and the new fields stay optional.
- Acceptance: The SIM-006 evidence check exits 0.
- Board namespace: site-instrument-modules-v1
- Completion authority: not admitted

## SIM-G060 Shell forward
- Status: planned
- Parent goal ids json: ["SIM-G000"]
- Required task ids json: ["SIM-005"]
- Objective: The app forwards a claim that a loaded record already carries. It does not invent one.
- Acceptance: The SIM-005 evidence check exits 0.
- Board namespace: site-instrument-modules-v1
- Completion authority: not admitted

## SIM-G060.S1 Forward an existing pair
- Status: planned
- Parent goal ids json: ["SIM-G060"]
- Required task ids json: ["SIM-005"]
- Objective: Wire the reader and research props only from fields already on the loaded record.
- Acceptance: The SIM-005 evidence check exits 0.
- Board namespace: site-instrument-modules-v1
- Completion authority: not admitted

## SIM-G070 Proof
- Status: planned
- Parent goal ids json: ["SIM-G000"]
- Required task ids json: ["SIM-007"]
- Objective: Re-run the fixed checks after the wave tasks land.
- Acceptance: The SIM-007 evidence check exits 0.
- Board namespace: site-instrument-modules-v1
- Completion authority: not admitted

## SIM-G070.S1 Re-run the checks
- Status: planned
- Parent goal ids json: ["SIM-G070"]
- Required task ids json: ["SIM-007"]
- Objective: Record exit codes. Do not edit the modules again.
- Acceptance: The SIM-007 evidence check exits 0.
- Board namespace: site-instrument-modules-v1
- Completion authority: not admitted
