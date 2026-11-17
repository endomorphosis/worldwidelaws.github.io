# Caller-independent retrieval goals

Root, goals, and subgoals are planning records. Completion is not these status fields. This package is not admitted to a DuckDB board. `PLAN.md` is the contract. The default implementation model is Grok Build `grok-4.7`.

## PIR-G000 Query worldwide datasets without a suggestion place
- Status: planned
- Parent goal ids json: []
- Required task ids json: ["PIR-001", "PIR-002", "PIR-003", "PIR-004", "PIR-005"]
- Objective: Worldwide retrieval keeps an explicit place and drops a suggestion place. Caller IP stays unread.
- Acceptance: Every required task has an evidence file and a passing fixed check.
- Board namespace: place-independent-retrieval-v1
- Completion authority: not admitted

## PIR-G010 Jurisdiction filter helper
- Status: planned
- Parent goal ids json: ["PIR-G000"]
- Required task ids json: ["PIR-001"]
- Objective: One function decides which place ids may narrow worldwide jurisdictions.
- Acceptance: The PIR-001 evidence check exits 0.
- Board namespace: place-independent-retrieval-v1
- Completion authority: not admitted

## PIR-G010.S1 Explicit place only
- Status: planned
- Parent goal ids json: ["PIR-G010"]
- Required task ids json: ["PIR-001"]
- Objective: `url`, `manual`, and `saved` keep place ids. `suggestion`, `unselected`, `geoip`, and `device` do not.
- Acceptance: The PIR-001 evidence check exits 0.
- Board namespace: place-independent-retrieval-v1
- Completion authority: not admitted

## PIR-G020 Worldwide retrieval
- Status: planned
- Parent goal ids json: ["PIR-G000"]
- Required task ids json: ["PIR-002"]
- Objective: `executeProductionRetrieval` uses the helper for the worldwide jurisdiction filter.
- Acceptance: The PIR-002 evidence check exits 0.
- Board namespace: place-independent-retrieval-v1
- Completion authority: not admitted

## PIR-G020.S1 Leave rank and absent callers
- Status: planned
- Parent goal ids json: ["PIR-G020"]
- Required task ids json: ["PIR-002"]
- Objective: Absent origin and channel keep today's filter. Rank and the place-scoped plan stay.
- Acceptance: The PIR-002 evidence check exits 0.
- Board namespace: place-independent-retrieval-v1
- Completion authority: not admitted

## PIR-G030 Shell finding
- Status: planned
- Parent goal ids json: ["PIR-G000"]
- Required task ids json: ["PIR-003"]
- Objective: The shell does not gain a caller-location read or a new retrieval call.
- Acceptance: The PIR-003 evidence check exits 0.
- Board namespace: place-independent-retrieval-v1
- Completion authority: not admitted

## PIR-G030.S1 Do not mount retrieval
- Status: planned
- Parent goal ids json: ["PIR-G030"]
- Required task ids json: ["PIR-003"]
- Objective: If the shell does not call `executeProductionRetrieval`, leave it unchanged and write that finding.
- Acceptance: The PIR-003 evidence check exits 0.
- Board namespace: place-independent-retrieval-v1
- Completion authority: not admitted

## PIR-G040 Retrieval note
- Status: planned
- Parent goal ids json: ["PIR-G000"]
- Required task ids json: ["PIR-004"]
- Objective: Document the filter and the datasets it does not narrow by suggestion.
- Acceptance: The PIR-004 evidence check exits 0.
- Board namespace: place-independent-retrieval-v1
- Completion authority: not admitted

## PIR-G040.S1 Quote the schema
- Status: planned
- Parent goal ids json: ["PIR-G040"]
- Required task ids json: ["PIR-004"]
- Objective: Quote the landed schema id. Do not rewrite the hub or view notes.
- Acceptance: The PIR-004 evidence check exits 0.
- Board namespace: place-independent-retrieval-v1
- Completion authority: not admitted

## PIR-G050 Proof
- Status: planned
- Parent goal ids json: ["PIR-G000"]
- Required task ids json: ["PIR-005"]
- Objective: Re-run the fixed checks after the wave tasks land.
- Acceptance: The PIR-005 evidence check exits 0.
- Board namespace: place-independent-retrieval-v1
- Completion authority: not admitted

## PIR-G050.S1 Re-run the checks
- Status: planned
- Parent goal ids json: ["PIR-G050"]
- Required task ids json: ["PIR-005"]
- Objective: Record exit codes. Do not edit the modules again.
- Acceptance: The PIR-005 evidence check exits 0.
- Board namespace: place-independent-retrieval-v1
- Completion authority: not admitted
