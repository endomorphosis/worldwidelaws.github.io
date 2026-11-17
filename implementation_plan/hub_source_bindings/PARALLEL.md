# Parallel waves

A wave starts when every task it depends on is `completed`. Inside a wave, tasks run together only when their write scopes do not share a path.

| Wave | Tasks | Wait for | What runs together |
| --- | --- | --- | --- |
| A | HFB-001, HFB-002 | nothing | Catalog fields and the local binding table. Different files. |
| B | HFB-003, HFB-004 | HFB-001 and HFB-002 for the page; HFB-002 for the note | The source page reads the table. The note quotes it. |
| C | HFB-005 | HFB-001, HFB-002, HFB-003, HFB-004 | One read-only proof. Writes only its evidence file. |

The supervisor launches at most two live workers. It asks `llm_router` once per launch. It does not rank providers a second time. `work_complete` stays false.
