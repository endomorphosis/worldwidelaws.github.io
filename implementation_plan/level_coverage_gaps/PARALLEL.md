# Parallel waves

A wave starts when every task it depends on is `completed`. Inside a wave, tasks run together only when their write scopes do not share a path.

| Wave | Tasks | Wait for | What runs together |
| --- | --- | --- | --- |
| A | LCG-001, LCG-002, LCG-005 | nothing | Level names, gap lists, and the IR row reader. Different files. |
| B | LCG-003, LCG-004 | LCG-001 for LCG-003; LCG-002 for LCG-004 | Retrieval accepts the six levels. The gap list is a versioned view. |
| C | LCG-006 | LCG-001, LCG-002, LCG-003, LCG-004, LCG-005 | One note that quotes the landed schema ids. |
| D | LCG-007 | LCG-006 | One read-only proof. Writes only its evidence file. |

The supervisor launches at most two live workers. It asks `llm_router` once per launch. `work_complete` stays false.
