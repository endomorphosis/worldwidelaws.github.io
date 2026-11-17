# Parallel waves

A wave starts when every task it depends on is `completed`. Inside a wave, tasks run together only when their write scopes do not share a path.

| Wave | Tasks | Wait for | What runs together |
| --- | --- | --- | --- |
| A | SIM-001, SIM-002, SIM-004, SIM-006 | nothing | Reader, research panel, the module note, and the index summary. Four different files. |
| B | SIM-005 | SIM-001, SIM-002 | The shell forwards a claim only after the child components accept one. |
| C | SIM-007 | SIM-001, SIM-002, SIM-004, SIM-005, SIM-006 | One read-only proof. Writes only its evidence file. |

The supervisor launches at most two live workers. It asks `llm_router` once per launch. It does not rank providers a second time. `work_complete` stays false.
