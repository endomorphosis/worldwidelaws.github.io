# Hub source binding goals

Root, goals, and subgoals are planning records. Completion is not these status fields. This package is not admitted to a DuckDB board. `PLAN.md` is the contract. The default implementation model is Grok Build `grok-4.7`.

## HFB-G000 Bind a dataset id to the schema a local module already names
- Status: planned
- Parent goal ids json: []
- Required task ids json: ["HFB-001", "HFB-002", "HFB-003", "HFB-004", "HFB-005"]
- Objective: Catalog and source page keep their versioned schemas and show a source schema only for a dataset id a landed constant already binds.
- Acceptance: Every required task has an evidence file and a passing fixed check.
- Board namespace: hub-source-bindings-v1
- Completion authority: not admitted

## HFB-G010 Catalog claim fields
- Status: planned
- Parent goal ids json: ["HFB-G000"]
- Required task ids json: ["HFB-001"]
- Objective: `CatalogSource` can carry an interface id and a source schema id when the inventory row already has both.
- Acceptance: The HFB-001 evidence check exits 0.
- Board namespace: hub-source-bindings-v1
- Completion authority: not admitted

## HFB-G010.S1 Optional inventory pair
- Status: planned
- Parent goal ids json: ["HFB-G010"]
- Required task ids json: ["HFB-001"]
- Objective: One field alone copies neither. Fixture rows stay unmarked.
- Acceptance: The HFB-001 evidence check exits 0.
- Board namespace: hub-source-bindings-v1
- Completion authority: not admitted

## HFB-G020 Local dataset binding table
- Status: planned
- Parent goal ids json: ["HFB-G000"]
- Required task ids json: ["HFB-002"]
- Objective: Map a dataset id to the interface and schema a landed constant already assigns.
- Acceptance: The HFB-002 evidence check exits 0.
- Board namespace: hub-source-bindings-v1
- Completion authority: not admitted

## HFB-G020.S1 Repo id is not a schema id
- Status: planned
- Parent goal ids json: ["HFB-G020"]
- Required task ids json: ["HFB-002"]
- Objective: The returned schema id is never the dataset id.
- Acceptance: The HFB-002 evidence check exits 0.
- Board namespace: hub-source-bindings-v1
- Completion authority: not admitted

## HFB-G030 Source page marker
- Status: planned
- Parent goal ids json: ["HFB-G000"]
- Required task ids json: ["HFB-003"]
- Objective: `SourcePage` keeps `worldwide-legal-search.source-page@1` and shows the binding without selecting an instrument view.
- Acceptance: The HFB-003 evidence check exits 0.
- Board namespace: hub-source-bindings-v1
- Completion authority: not admitted

## HFB-G030.S1 Attributes from the table
- Status: planned
- Parent goal ids json: ["HFB-G030"]
- Required task ids json: ["HFB-003"]
- Objective: Set `data-source-schema` and `data-interface-id` only from a lookup hit.
- Acceptance: The HFB-003 evidence check exits 0.
- Board namespace: hub-source-bindings-v1
- Completion authority: not admitted

## HFB-G040 Current binding note
- Status: planned
- Parent goal ids json: ["HFB-G000"]
- Required task ids json: ["HFB-004"]
- Objective: Document the landed bindings and the repos that stay unmarked.
- Acceptance: The HFB-004 evidence check exits 0.
- Board namespace: hub-source-bindings-v1
- Completion authority: not admitted

## HFB-G040.S1 Quote the landed ids
- Status: planned
- Parent goal ids json: ["HFB-G040"]
- Required task ids json: ["HFB-004"]
- Objective: Quote schema strings in backticks. Do not rewrite the older view notes.
- Acceptance: The HFB-004 evidence check exits 0.
- Board namespace: hub-source-bindings-v1
- Completion authority: not admitted

## HFB-G050 Proof
- Status: planned
- Parent goal ids json: ["HFB-G000"]
- Required task ids json: ["HFB-005"]
- Objective: Re-run the fixed checks after the wave tasks land.
- Acceptance: The HFB-005 evidence check exits 0.
- Board namespace: hub-source-bindings-v1
- Completion authority: not admitted

## HFB-G050.S1 Re-run the checks
- Status: planned
- Parent goal ids json: ["HFB-G050"]
- Required task ids json: ["HFB-005"]
- Objective: Record exit codes. Do not edit the modules again.
- Acceptance: The HFB-005 evidence check exits 0.
- Board namespace: hub-source-bindings-v1
- Completion authority: not admitted
