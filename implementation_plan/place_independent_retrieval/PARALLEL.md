# Parallel waves

A wave starts when every task it depends on is `completed`. Inside a wave, tasks run together only when their write scopes do not share a path.

| Wave | Tasks | Wait for | What runs together |
| --- | --- | --- | --- |
| A | PIR-001, PIR-003 | nothing | The filter helper and the shell finding. Different files. |
| B | PIR-002, PIR-004 | PIR-001 | Worldwide retrieval calls the helper. The note quotes it. |
| C | PIR-005 | PIR-001, PIR-002, PIR-003, PIR-004 | One read-only proof. Writes only its evidence file. |

The supervisor launches at most two live workers. It asks `llm_router` once per launch. `work_complete` stays false.
