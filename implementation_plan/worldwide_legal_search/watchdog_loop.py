#!/usr/bin/env python3
"""Observe a native campaign and dispatch bounded, idempotent recovery requests.

See WATCHDOG.md. This loop is not task/completion or code-promotion authority.
It needs the campaign adapter delivered by the first implementation milestone.
"""
from __future__ import annotations

import argparse
import contextlib
import errno
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
from typing import Any

HERE = Path(__file__).resolve().parent
EXTERNAL = {"credentials", "permission", "source_unavailable", "rights", "budget", "resource_quota"}
BINDINGS = {"task_source", "lifecycle_restart", "rescue_planner", "rescue_orchestrator", "route_policy", "independent_validation", "validated_promotion", "incident_deduplication", "meaningful_progress"}
NATIVE_REPAIR_BINDINGS = (BINDINGS - {"rescue_planner", "rescue_orchestrator"}) | {"repair_dispatch", "scoped_repair_admission", "exclusive_effect_ownership", "repair_canary_verified"}
ACTION_KINDS = {"reconcile", "recover", "diagnose", "repair"}
MAX_BYTES = 1_048_576


class ContractError(ValueError):
    pass


def digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def read_json(path: Path) -> dict[str, Any]:
    if path.stat().st_size > MAX_BYTES:
        raise ContractError("JSON input exceeds the size bound")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ContractError("JSON input must be an object")
    return value


def policy_check(policy: dict[str, Any]) -> None:
    if policy.get("schema") != "worldwide-legal-search.watchdog-policy@1" or not policy.get("policy_id"):
        raise ContractError("unsupported watchdog policy")
    for field in ("poll_seconds", "confirmation_count", "confirmation_interval_seconds", "startup_grace_seconds", "idle_seconds", "heartbeat_stale_seconds", "progress_stale_seconds", "max_stage_seconds", "cooldown_seconds", "max_backoff_seconds", "max_reconcile_attempts_per_incident", "max_recovery_attempts_per_incident", "max_repairs_per_incident", "max_campaign_repairs", "max_incidents", "max_campaign_actions", "adapter_timeout_seconds"):
        value = policy.get(field)
        if type(value) is not int or value < 1:
            raise ContractError("policy requires a positive integer: " + field)
    if policy["poll_seconds"] > 60 or policy["adapter_timeout_seconds"] > 60:
        raise ContractError("poll and adapter timeouts must not exceed 60 seconds")


def snapshot_check(value: dict[str, Any], now: float, policy: dict[str, Any]) -> None:
    if value.get("schema") != "wwl.watchdog.snapshot@1":
        raise ContractError("unsupported snapshot schema")
    for key in ("run_id", "authority_revision", "accepted_tree", "progress_token", "admitted_plan_revision"):
        if not isinstance(value.get(key), str) or not value[key] or len(value[key]) > 512:
            raise ContractError("missing or invalid snapshot field: " + key)
    for key in ("stage", "task_id", "failure_key", "reproducer_receipt", "completion_receipt"):
        if not isinstance(value.get(key), str) or len(value[key]) > 512:
            raise ContractError("invalid snapshot string: " + key)
    if not isinstance(value.get("active_attempt_id", ""), str) or len(value.get("active_attempt_id", "")) > 512:
        raise ContractError("invalid canonical active attempt identity")
    for key in ("hold", "completion_verified", "owner_alive", "owner_identity_verified", "dependency_running", "effects_unknown"):
        if type(value.get(key)) is not bool:
            raise ContractError("invalid snapshot boolean: " + key)
    for key in ("observed_at", "heartbeat_at", "stage_deadline_at"):
        if type(value.get(key)) not in (int, float) or not math.isfinite(value[key]) or value[key] < 0:
            raise ContractError("invalid snapshot timestamp: " + key)
    if value["observed_at"] > now + 30 or now - value["observed_at"] > max(120, policy["poll_seconds"] * 3):
        raise ContractError("snapshot is stale or from the future")
    if value["heartbeat_at"] > now + 30:
        raise ContractError("heartbeat is from the future")
    if value["stage_deadline_at"] > now + policy["max_stage_seconds"]:
        raise ContractError("stage deadline exceeds the admitted maximum")
    if type(value.get("runnable_count")) is not int or value["runnable_count"] < 0:
        raise ContractError("invalid runnable count")
    for key in ("required_task_ids", "verified_task_ids"):
        values = value.get(key)
        if not isinstance(values, list) or not all(isinstance(v, str) and v for v in values) or len(set(values)) != len(values):
            raise ContractError("invalid task set: " + key)
    if not value["required_task_ids"] or not set(value["verified_task_ids"]) <= set(value["required_task_ids"]):
        raise ContractError("task verification set is outside this campaign")
    if value.get("blocked_kind") not in EXTERNAL | {"none", "software_defect"}:
        raise ContractError("unknown blocker classification")
    if value["completion_verified"] and (set(value["verified_task_ids"]) != set(value["required_task_ids"]) or not value["completion_receipt"] or value["task_id"] or value["runnable_count"] or value["effects_unknown"]):
        raise ContractError("native completion evidence conflicts with unfinished work")
    observations = value.get("action_observations", [])
    if not isinstance(observations, list) or len(observations) > policy["max_campaign_actions"]:
        raise ContractError("invalid native action observations")
    seen = set()
    for item in observations:
        if not isinstance(item, dict) or item.get("schema") != "wwl.watchdog.action-observation@1" or not isinstance(item.get("action_id"), str) or not item["action_id"] or item["action_id"] in seen:
            raise ContractError("invalid or duplicate native action observation")
        seen.add(item["action_id"])
        if item.get("status") not in {"running", "succeeded", "failed", "blocked", "unknown"} or type(item.get("effects_verified")) is not bool or not isinstance(item.get("receipt"), str) or not item["receipt"]:
            raise ContractError("native action observation lacks status or evidence")
        if item["status"] in {"succeeded", "failed", "blocked"} and not item["effects_verified"]:
            raise ContractError("native terminal action outcome has unresolved effects")
        if item["status"] == "running" and (type(item.get("deadline_at")) not in (int, float) or not math.isfinite(item["deadline_at"]) or item["deadline_at"] < 0):
            raise ContractError("running native action lacks a bounded deadline")
        if item.get("requires_fenced_reload"):
            if item["status"] != "running" or item.get("candidate_promotion_verified") is not True or item.get("recovery_verified") is not False or not all(isinstance(item.get(key), str) and item[key] for key in ("expected_framework_revision", "original_failure_receipt")):
                raise ContractError("repair reload handoff lacks native promotion evidence")


def initial_state(policy: dict[str, Any], run_id: str, now: float) -> dict[str, Any]:
    return {"schema": "wwl.watchdog.state@1", "run_id": run_id, "policy_digest": digest(policy), "started_at": now,
            "last_progress_at": now, "progress_token": "", "required_task_ids": [], "admitted_plan_revision": "",
            "incidents": {}, "confirmation_incident_id": "", "actions": 0, "repairs": 0, "outbox": None,
            "inflight": {}, "uncertain_actions": {}, "settled_actions": {}}


def state_check(state: dict[str, Any], policy: dict[str, Any], run_id: str) -> None:
    if state.get("schema") != "wwl.watchdog.state@1" or state.get("run_id") != run_id or state.get("policy_digest") != digest(policy):
        raise ContractError("state run or policy changed; preserve old state and use native re-admission")
    if not isinstance(state.get("incidents"), dict) or len(state["incidents"]) > policy["max_incidents"]:
        raise ContractError("invalid incident state")
    for key in ("actions", "repairs"):
        if type(state.get(key)) is not int or state[key] < 0:
            raise ContractError("invalid durable budget counter")
    for key in ("started_at", "last_progress_at"):
        if type(state.get(key)) not in (int, float) or not math.isfinite(state[key]) or state[key] < 0:
            raise ContractError("invalid durable progress timestamp")
    if not isinstance(state.get("progress_token"), str):
        raise ContractError("invalid durable progress cursor")
    required = state.get("required_task_ids")
    if not isinstance(required, list) or not all(isinstance(v, str) and v for v in required) or len(set(required)) != len(required) or not isinstance(state.get("admitted_plan_revision"), str):
        raise ContractError("invalid durable admitted task set")
    if not isinstance(state.get("confirmation_incident_id"), str):
        raise ContractError("invalid confirmation streak identity")
    # Existing observation-only states have no uncertain operation records.
    state.setdefault("uncertain_actions", {})
    for field in ("inflight", "uncertain_actions", "settled_actions"):
        if not isinstance(state.get(field), dict) or len(state[field]) > policy["max_campaign_actions"]:
            raise ContractError("invalid durable action lifecycle state")
    for action_id, action in state["inflight"].items():
        if not isinstance(action, dict) or action.get("action_id") != action_id or action.get("run_id") != run_id or action.get("kind") not in ACTION_KINDS or not action.get("admission_receipt") or type(action.get("deadline_at")) not in (int, float) or not math.isfinite(action["deadline_at"]) or action["deadline_at"] < 0:
            raise ContractError("invalid durable admitted action")
    for action_id, action in state["uncertain_actions"].items():
        if not isinstance(action, dict) or action.get("schema") != "wwl.watchdog.action@1" or action.get("action_id") != action_id or action.get("run_id") != run_id or action.get("kind") not in ACTION_KINDS or type(action.get("issued_at")) not in (int, float) or not math.isfinite(action["issued_at"]):
            raise ContractError("invalid durable uncertain action")
    for incident in state["incidents"].values():
        if not isinstance(incident, dict):
            raise ContractError("invalid durable incident")
        incident.setdefault("diagnose", 0)
        for key in ("confirmations", "reconcile", "recover", "diagnose", "repair"):
            if type(incident.get(key)) is not int or incident[key] < 0:
                raise ContractError("invalid durable incident accounting")
        for key in ("last_confirmed_at", "next_action_at"):
            if type(incident.get(key)) not in (int, float) or not math.isfinite(incident[key]) or incident[key] < 0:
                raise ContractError("invalid durable incident time")
    outbox = state.get("outbox")
    if outbox is not None and (not isinstance(outbox, dict) or outbox.get("schema") != "wwl.watchdog.action@1" or outbox.get("run_id") != run_id or not outbox.get("action_id") or outbox.get("kind") not in ACTION_KINDS):
        raise ContractError("invalid durable action outbox")


def reset_confirmations(state: dict[str, Any]) -> None:
    state["confirmation_incident_id"] = ""
    for incident in state["incidents"].values():
        incident["confirmations"] = 0


def action_deadline(action: dict[str, Any], deadline: Any, policy: dict[str, Any], now: float) -> float:
    duration = policy["max_stage_seconds"] if action["kind"] == "repair" else policy["native_autonomous_unstall_policy"]["deadline_ms"] / 1000
    issued_at = action["issued_at"]
    if type(deadline) not in (int, float) or not math.isfinite(deadline) or deadline < 0 or deadline > issued_at + duration or deadline > now + duration:
        raise ContractError("native admitted action deadline exceeds its original bound")
    return float(deadline)


def unsettled_action_ids(state: dict[str, Any]) -> list[str]:
    pending = state.get("outbox")
    return list(dict.fromkeys([*state.get("uncertain_actions", {}), *state["inflight"], *([pending["action_id"]] if pending else [])]))


def reconcile_action_observations(snapshot: dict[str, Any], state: dict[str, Any], policy: dict[str, Any], now: float) -> None:
    for item in snapshot.get("action_observations", []):
        action_id = item["action_id"]
        pending = state.get("outbox")
        action = state["inflight"].get(action_id) or state["uncertain_actions"].get(action_id) or (pending if pending and pending["action_id"] == action_id else None)
        if not action:
            continue
        if item["status"] in {"succeeded", "failed", "blocked"}:
            state["settled_actions"][action_id] = {"status": item["status"], "receipt": item["receipt"]}
            if action["kind"] == "diagnose":
                # Keep the original issued context. A freeform failure string
                # cannot reassign a later repair to an old exhausted episode.
                state["settled_actions"][action_id].update({key: action[key] for key in
                    ("kind", "incident_id", "task_id", "active_attempt_id")})
            state["inflight"].pop(action_id, None)
            state["uncertain_actions"].pop(action_id, None)
            if pending and pending["action_id"] == action_id:
                state["outbox"] = None
            parent = action.get("reload_after_action_id")
            if item["status"] == "succeeded" and parent in state["inflight"]:
                state["inflight"][parent]["reload_complete"] = True
        elif item["status"] == "running":
            deadline = action_deadline(action, item["deadline_at"], policy, now)
            state["inflight"][action_id] = {**action, "admission_receipt": item["receipt"], "deadline_at": min(deadline, action.get("deadline_at", deadline)), "outcome_unknown": False}
            state["uncertain_actions"].pop(action_id, None)
            if item.get("requires_fenced_reload"):
                state["inflight"][action_id].update({key: item[key] for key in ("requires_fenced_reload", "candidate_promotion_verified", "recovery_verified", "expected_framework_revision", "original_failure_receipt")})
            if pending and pending["action_id"] == action_id:
                state["outbox"] = None
        elif action_id in state["inflight"]:
            state["inflight"][action_id]["outcome_unknown"] = True


def diagnosed_incident(snapshot: dict[str, Any], state: dict[str, Any]) -> str:
    """Bind a reproduced failure to an actually issued, settled diagnosis."""
    proof = snapshot.get("native_diagnosis")
    if not isinstance(proof, dict) or proof.get("schema") != "wwl.native-diagnosis@1" or proof.get("status") != "reproduced_software_defect":
        return ""
    if not all(isinstance(proof.get(key), str) and 0 < len(proof[key]) <= 512 for key in
               ("action_id", "incident_id", "task_id", "active_attempt_id", "receipt_id", "failure_receipt")):
        return ""
    expected = "sha256:" + hashlib.sha256(json.dumps({k: v for k, v in proof.items() if k != "receipt_id"},
        sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")).hexdigest()
    if proof["receipt_id"] != expected:
        return ""
    action = state["settled_actions"].get(proof["action_id"], {})
    if (action.get("kind") != "diagnose" or action.get("status") != "succeeded"
            or not proof.get("receipt_id") or action.get("receipt") != proof["receipt_id"]
            or proof.get("failure_receipt") != snapshot.get("reproducer_receipt")
            or not proof.get("failure_receipt") or not snapshot.get("failure_key")
            or not all(action.get(key) == proof.get(key) == snapshot.get(key) for key in ("task_id", "active_attempt_id"))
            or action.get("incident_id") != proof.get("incident_id")
            or proof.get("incident_id") not in state["incidents"]):
        return ""
    return proof["incident_id"]


def decide(snapshot: dict[str, Any], state: dict[str, Any], policy: dict[str, Any], now: float) -> dict[str, Any]:
    """Update bounded observation state and return at most one native request."""
    snapshot_check(snapshot, now, policy)
    state_check(state, policy, snapshot["run_id"])
    if not set(state["required_task_ids"]) <= set(snapshot["required_task_ids"]):
        raise ContractError("native task set pruned previously admitted work, including across restart")
    state["required_task_ids"] = list(snapshot["required_task_ids"])
    state["admitted_plan_revision"] = snapshot["admitted_plan_revision"]
    if now < state["last_progress_at"] or now < state["started_at"]:
        raise ContractError("clock moved backwards; reconcile through native authority")

    def report(status: str, reason: str, **fields: Any) -> dict[str, Any]:
        return {"schema": "wwl.watchdog.report@1", "run_id": snapshot["run_id"], "status": status, "reason": reason, "completion_authority": False, **fields}

    def passive(status: str, reason: str, **fields: Any) -> dict[str, Any]:
        reset_confirmations(state)
        return report(status, reason, **fields)

    if snapshot["hold"]:
        return passive("held", "native_pause_or_hold")
    if snapshot["blocked_kind"] == "resource_quota":
        return passive("blocked", "external_resource_quota", resource_pressure=snapshot.get("resource_pressure", {}))
    reconcile_action_observations(snapshot, state, policy, now)
    pending = state.get("outbox")
    inflight = state["inflight"]
    uncertain = state["uncertain_actions"]
    reload_parent = next((action for action in inflight.values() if action["kind"] == "repair" and action.get("requires_fenced_reload") and not action.get("reload_complete") and not any(child.get("reload_after_action_id") == action["action_id"] for child in inflight.values())), None)
    if snapshot["completion_verified"] and not pending and not inflight and not uncertain:
        return passive("complete", "native_current_tree_completion_verified", receipt=snapshot["completion_receipt"])
    if snapshot["progress_token"] != state["progress_token"]:
        state["progress_token"] = snapshot["progress_token"]
        state["last_progress_at"] = now
        # A resolved episode needs fresh confirming observations. Its attempt
        # counters remain durable if the same defect returns later.
        reset_confirmations(state)

    reason, kind = "", ""
    if (pending or uncertain or snapshot["effects_unknown"]) and any(action["kind"] in {"reconcile", "recover"} and not action.get("outcome_unknown") and now < action["deadline_at"] for action in inflight.values()):
        return passive("waiting", "native_reconciliation_or_recovery_in_progress", action_ids=unsettled_action_ids(state))
    if pending or uncertain or snapshot["effects_unknown"]:
        reason, kind = "unknown_effects", "reconcile"
    elif reload_parent is not None:
        reason, kind = "validated_repair_requires_fenced_reload", "recover"
    elif any(not action.get("outcome_unknown") and now < action["deadline_at"] for action in inflight.values()):
        return passive("waiting", "native_action_in_progress", action_ids=list(inflight))
    elif inflight:
        reason, kind = "native_action_unsettled_or_expired", "reconcile"
    elif snapshot["blocked_kind"] in EXTERNAL and snapshot["runnable_count"] == 0:
        return passive("blocked", "external_" + snapshot["blocked_kind"])
    elif snapshot["blocked_kind"] == "software_defect":
        if not snapshot["failure_key"] or not snapshot["reproducer_receipt"]:
            reason, kind = "defect_needs_reproduction", "reconcile"
        else:
            reason, kind = "reproduced_supervisor_defect", "repair"
    elif now - state["started_at"] < policy["startup_grace_seconds"]:
        return passive("observing", "startup_grace")
    elif snapshot["dependency_running"] and snapshot["runnable_count"] == 0 and not snapshot["task_id"]:
        return passive("waiting", "dependency_work_in_progress")
    elif not snapshot["owner_alive"] and (snapshot["task_id"] or snapshot["runnable_count"]):
        reason, kind = "owner_absent", "recover"
    elif snapshot["owner_alive"] and not snapshot["owner_identity_verified"]:
        reason, kind = "owner_identity_unverified", "reconcile"
    elif snapshot["task_id"] and snapshot["stage_deadline_at"] and now >= snapshot["stage_deadline_at"]:
        reason, kind = "stage_deadline_expired", "reconcile"
    elif snapshot["task_id"] and now - snapshot["heartbeat_at"] >= policy["heartbeat_stale_seconds"]:
        reason, kind = "heartbeat_stale", "reconcile"
    elif snapshot["task_id"] and now - state["last_progress_at"] >= policy["progress_stale_seconds"]:
        reason, kind = "meaningful_progress_stalled", "reconcile"
    elif snapshot["runnable_count"] and not snapshot["task_id"] and now - state["last_progress_at"] >= policy["idle_seconds"]:
        reason, kind = "runnable_work_idle", "recover"
    elif not snapshot["task_id"] and not snapshot["runnable_count"] and set(snapshot["verified_task_ids"]) == set(snapshot["required_task_ids"]):
        reason, kind = "completion_needs_native_verification", "reconcile"
    elif not snapshot["task_id"] and not snapshot["runnable_count"]:
        reason, kind = "unfinished_work_has_no_runnable_frontier", "reconcile"
    else:
        return passive("healthy", "bounded_work_in_progress")

    unsettled = pending or reload_parent or next(iter(uncertain.values()), None) or next(iter(inflight.values()), None)
    if unsettled:
        # A lost ACK keeps the ORIGINAL incident, so restart or changing
        # observe revisions cannot reset the unknown-effect recovery bound.
        incident_id = unsettled["incident_id"]
    elif kind == "repair" and diagnosed_incident(snapshot, state):
        incident_id = diagnosed_incident(snapshot, state)
    else:
        identity_fields = [snapshot["run_id"], snapshot["task_id"], snapshot["stage"], snapshot["failure_key"], reason]
        if snapshot.get("active_attempt_id"):
            # A new canonical attempt owns a new bounded episode. Process
            # restarts, observed roots and progress strings cannot mint one.
            identity_fields.append({"active_attempt_id": snapshot["active_attempt_id"]})
        incident_id = digest(identity_fields)
        if snapshot.get("active_attempt_id") and not snapshot["failure_key"]:
            # Classifying the same attempt more accurately (for example,
            # discovering unknown provider effects) cannot buy new restarts.
            # Recognize prior v1 identities rather than resetting old state.
            stall_reasons = {"unknown_effects", "native_action_unsettled_or_expired", "stage_deadline_expired",
                "heartbeat_stale", "meaningful_progress_stalled", "owner_identity_unverified", "owner_absent", "runnable_work_idle"}
            if reason in stall_reasons:
                candidates = [digest([snapshot["run_id"], snapshot["task_id"], snapshot["stage"], "", cause,
                    {"active_attempt_id": snapshot["active_attempt_id"]}]) for cause in sorted(stall_reasons)]
                existing = [key for key in candidates if key in state["incidents"]]
                if existing:
                    incident_id = max(existing, key=lambda key: sum(state["incidents"][key].get(k, 0)
                        for k in ("reconcile", "recover", "diagnose", "repair")))
    incidents = state["incidents"]
    if incident_id not in incidents:
        if len(incidents) >= policy["max_incidents"]:
            return report("blocked", "campaign_incident_budget_exhausted")
        incidents[incident_id] = {"confirmations": 0, "last_confirmed_at": 0, "next_action_at": 0, "reconcile": 0, "recover": 0, "diagnose": 0, "repair": 0}
    incident = incidents[incident_id]
    if state["confirmation_incident_id"] != incident_id:
        reset_confirmations(state)
        state["confirmation_incident_id"] = incident_id
    if incident["confirmations"] == 0 or now - incident["last_confirmed_at"] >= policy["confirmation_interval_seconds"]:
        incident["confirmations"] += 1
        incident["last_confirmed_at"] = now
    if incident["confirmations"] < policy["confirmation_count"]:
        return report("suspect", reason, incident_id=incident_id, confirmations=incident["confirmations"])
    if now < incident["next_action_at"]:
        return report("cooldown", reason, incident_id=incident_id, until=incident["next_action_at"])
    host = snapshot.get("registered_host_lifecycle", {})
    registered_fence = (isinstance(host, dict) and host.get("registered") is True
        and host.get("unit") == "worldwide-legal-search-supervisor.service" and host.get("owner_identity_verified") is True)
    recovery_seconds = policy["native_autonomous_unstall_policy"]["deadline_ms"] / 1000
    prior_actions = [*inflight.values(), *uncertain.values(), *([pending] if pending else [])]
    expired_reconciliation = any(action["kind"] == "reconcile" and (action.get("outcome_unknown") or now >= action.get("deadline_at", action["issued_at"] + recovery_seconds)) for action in prior_actions)
    can_escalate = reason in {"unknown_effects", "native_action_unsettled_or_expired", "stage_deadline_expired", "heartbeat_stale", "meaningful_progress_stalled", "owner_identity_unverified"}
    if kind == "reconcile" and registered_fence and can_escalate and (expired_reconciliation or incident["reconcile"] >= policy["max_reconcile_attempts_per_incident"]):
        # A hung execution thread cannot consume its own reconcile queue.
        # Keep the incident and uncertainty, but use the separately bounded
        # registered host fence so a new owner can perform native recovery.
        kind, reason = "recover", "reconciliation_requires_registered_host_fence"
    stalled_reason = reason
    if (kind == "recover" and incident["recover"] >= policy["max_recovery_attempts_per_incident"]
            and can_escalate and registered_fence and snapshot.get("native_diagnostic_available") is True
            and snapshot.get("task_id") and snapshot.get("active_attempt_id")
            and not pending and not uncertain and not inflight):
        # Exhausted restarts are evidence that more restarting is unhelpful,
        # not proof of a code defect. Ask the native owner to diagnose using
        # its own sealed evidence before any paid repair can be admitted.
        # This read-only operation can observe unknown provider effects; it
        # cannot settle them or authorize a new writer.
        kind, reason = "diagnose", "recovery_exhausted_requires_native_diagnosis"
    limit_key = {"reconcile": "max_reconcile_attempts_per_incident", "recover": "max_recovery_attempts_per_incident",
                 "diagnose": "max_reconcile_attempts_per_incident", "repair": "max_repairs_per_incident"}[kind]
    if incident[kind] >= policy[limit_key]:
        return report("blocked", kind + "_incident_budget_exhausted", incident_id=incident_id)
    if state["actions"] >= policy["max_campaign_actions"] or (kind == "repair" and state["repairs"] >= policy["max_campaign_repairs"]):
        return report("blocked", "campaign_action_budget_exhausted", incident_id=incident_id)
    incident[kind] += 1
    state["actions"] += 1
    state["repairs"] += int(kind == "repair")
    incident["next_action_at"] = now + min(policy["max_backoff_seconds"], policy["cooldown_seconds"] * 2 ** (incident[kind] - 1))
    action = {"schema": "wwl.watchdog.action@1", "run_id": snapshot["run_id"], "policy_id": policy["policy_id"], "incident_id": incident_id,
              "action_id": digest([snapshot["run_id"], incident_id, state["actions"]]), "kind": kind, "reason": reason,
              "task_id": snapshot["task_id"], "stage": snapshot["stage"], "authority_revision": snapshot["authority_revision"],
              "accepted_tree": snapshot["accepted_tree"], "reproducer_receipt": snapshot["reproducer_receipt"],
              "issued_at": now, "unsettled_action_ids": unsettled_action_ids(state),
              "previous_unacknowledged_action": pending["action_id"] if pending else ""}
    if kind == "diagnose":
        action.update(stalled_reason=stalled_reason, exhausted_reconcile_count=incident["reconcile"],
                      exhausted_recovery_count=incident["recover"])
    if reload_parent is not None and reason == "validated_repair_requires_fenced_reload":
        action.update(reload_after_action_id=reload_parent["action_id"], expected_framework_revision=reload_parent["expected_framework_revision"], original_failure_receipt=reload_parent["original_failure_receipt"])
    if snapshot.get("active_attempt_id"):
        action["active_attempt_id"] = snapshot["active_attempt_id"]
    if pending:
        # Lost acknowledgements are not negative acknowledgements. Preserve
        # every superseded request until a native terminal observation settles
        # it; a second reconciliation cannot erase the original operation.
        uncertain[pending["action_id"]] = pending
    state["outbox"] = action
    return report("action_requested", reason, action=action)


def atomic_save(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=".wwl-watchdog-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(state, stream, sort_keys=True, allow_nan=False)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(name):
            os.unlink(name)


@contextlib.contextmanager
def owner_lock(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+", encoding="utf-8") as stream:
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise ContractError("a watchdog already owns this state") from exc
        yield


@contextlib.contextmanager
def adapter_output_files():
    # A full persistent filesystem must not prevent the resource observation
    # that explains why work cannot be admitted. Anonymous files remain private.
    directories = [None]
    if sys.platform == "linux" and Path("/dev/shm").is_dir():
        directories.append("/dev/shm")
    output = errors = None
    for directory in directories:
        try:
            output = tempfile.TemporaryFile(dir=directory)
            errors = tempfile.TemporaryFile(dir=directory)
            break
        except OSError as error:
            if output is not None:
                output.close()
            output = errors = None
            if directory is not None or len(directories) == 1 or error.errno not in {errno.ENOSPC, errno.EDQUOT, errno.ENOENT}:
                raise
    try:
        yield output, errors
    finally:
        errors.close()
        output.close()


def call_adapter(argv: list[str], operation: str, request: dict[str, Any], timeout: int) -> dict[str, Any]:
    with adapter_output_files() as (output, errors):
        result = subprocess.run([*argv, operation], input=json.dumps(request).encode(), stdout=output, stderr=errors, timeout=timeout, check=False)
        if result.returncode != 0:
            raise ContractError(f"native adapter {operation} failed with exit {result.returncode}; inspect native host logs")
        if output.tell() > MAX_BYTES:
            raise ContractError("native adapter output exceeds its bound")
        output.seek(0)
        value = json.loads(output.read().decode("utf-8"))
    if not isinstance(value, dict):
        raise ContractError("native adapter returned a non-object")
    return value


def ready_check(ready: dict[str, Any], plan: dict[str, Any], policy: dict[str, Any], *, require_execution: bool = True) -> str:
    if ready.get("schema") != "wwl.watchdog.ready@1" or ready.get("policy_id") != policy["policy_id"]:
        raise ContractError("native adapter policy handshake failed")
    for key in ("run_id", "native_revision", "readiness_receipt"):
        if not isinstance(ready.get(key), str) or not ready[key]:
            raise ContractError("native adapter readiness missing: " + key)
    if ready.get("repository") != plan["product"]["repository"]:
        raise ContractError("native adapter repository differs from campaign")
    required = ready.get("required_task_ids")
    core = {t["id"] for t in plan["tasks"]}
    if not isinstance(required, list) or not all(isinstance(v, str) for v in required) or len(set(required)) != len(required) or not core <= set(required):
        raise ContractError("native adapter required task set omits core tasks")
    expanded = set(required) - core
    if expanded and (not all(re.fullmatch(plan["source_expansion"]["id_pattern"], v) for v in expanded) or not ready.get("expansion_receipt")):
        raise ContractError("expanded source tasks lack the native admitted expansion receipt")
    if not isinstance(ready.get("admitted_plan_revision"), str) or not ready["admitted_plan_revision"]:
        raise ContractError("native admitted plan revision is missing")
    bindings = ready.get("bindings")
    use_native_repair = require_execution and isinstance(bindings, dict) and not all(bindings.get(k) is True for k in BINDINGS)
    required_bindings = (NATIVE_REPAIR_BINDINGS if use_native_repair else BINDINGS) if require_execution else {"task_source", "meaningful_progress", "independent_validation"}
    if not isinstance(bindings, dict) or any(bindings.get(k) is not True for k in required_bindings):
        raise ContractError("native lifecycle, progress or validated repair binding is missing; complete WWL-004/005/102")
    if use_native_repair:
        pipeline = ready.get("repair_pipeline")
        if not isinstance(pipeline, dict) or pipeline.get("schema") != "worldwide-legal-search.repair-pipeline@1" or pipeline.get("policy_id") != policy["policy_id"] or not pipeline.get("native_canary_receipt") or not pipeline.get("receipt_id"):
            raise ContractError("native repair dispatcher pipeline lacks its verified canary receipt")
    return ready["run_id"]


def acknowledge(state: dict[str, Any], result: dict[str, Any], policy: dict[str, Any], now: float) -> None:
    action = state["outbox"]
    if not action or result.get("schema") != "wwl.watchdog.action-result@1" or result.get("action_id") != action["action_id"] or result.get("status") not in {"accepted", "blocked", "unknown"} or not isinstance(result.get("receipt"), str) or not result["receipt"]:
        raise ContractError("dispatch acknowledgement is missing or mismatched; effects remain unknown")
    if result["status"] == "accepted":
        deadline = action_deadline(action, result.get("deadline_at"), policy, now)
        if deadline <= now:
            raise ContractError("native action admission already expired; effects remain unknown")
        state["inflight"][action["action_id"]] = {**action, "deadline_at": deadline, "admission_receipt": result["receipt"], "outcome_unknown": False}
        state["outbox"] = None
    elif result["status"] == "blocked":
        # The native refusal receipt establishes no admitted operation.
        state["settled_actions"][action["action_id"]] = {"status": "blocked", "receipt": result["receipt"]}
        state["outbox"] = None


def _run_main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--policy", type=Path, default=HERE / "watchdog.policy.json")
    parser.add_argument("--plan", type=Path, default=HERE / "plan.json")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--snapshot", type=Path, help="Fixture observation; never dispatches live recovery")
    source.add_argument("--adapter-argv-json", help="Registered native adapter argv; never executed through a shell")
    parser.add_argument("--state", type=Path, default=HERE / ".runtime/watchdog.json")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--execute", action="store_true", help="Persist state and request native recovery; requires the ready adapter")
    args = parser.parse_args(argv)
    try:
        if args.snapshot and args.execute:
            raise ContractError("a fixture cannot authorize live recovery")
        if args.snapshot and not args.once:
            raise ContractError("snapshot fixtures require --once; use the native adapter for a live loop")
        policy, plan = read_json(args.policy), read_json(args.plan)
        policy_check(policy)
        command = json.loads(args.adapter_argv_json) if args.adapter_argv_json else []
        if args.adapter_argv_json and (not isinstance(command, list) or not command or not all(isinstance(v, str) and v and "\0" not in v for v in command)):
            raise ContractError("adapter argv must be a nonempty JSON string array")
        request = {"schema": "wwl.watchdog.request@1", "operation": "ready", "policy_id": policy["policy_id"], "required_task_ids": [t["id"] for t in plan["tasks"]], "execution_requested": args.execute}
        run_id = ""
        if command:
            ready = call_adapter(command, "ready", request, policy["adapter_timeout_seconds"])
            run_id = ready_check(ready, plan, policy, require_execution=False)
            if isinstance(ready.get("resource_pressure"), dict) and ready["resource_pressure"].get("blocked") is True:
                print(json.dumps({"schema": "wwl.watchdog.report@1", "status": "blocked", "reason": "external_resource_quota", "resource_pressure": ready["resource_pressure"], "completion_authority": False}), flush=True)
                return 0 if args.once else 75
            request["required_task_ids"] = ready["required_task_ids"]
            request["admitted_plan_revision"] = ready["admitted_plan_revision"]
        # Observation-only operation holds no write lock and writes no state.
        lock = owner_lock(args.state.with_suffix(args.state.suffix + ".lock")) if args.execute else contextlib.nullcontext()
        with lock:
            state = read_json(args.state) if args.execute and args.state.exists() else None
            if state is not None:
                state_check(state, policy, run_id)
                if not set(state["required_task_ids"]) <= set(request["required_task_ids"]):
                    raise ContractError("native readiness pruned required tasks recorded before restart")
            refresh_readiness = False
            while True:
                if command and refresh_readiness:
                    refreshed = call_adapter(command, "ready", {**request, "operation": "ready"}, policy["adapter_timeout_seconds"])
                    if ready_check(refreshed, plan, policy, require_execution=False) != run_id or not set(request["required_task_ids"]) <= set(refreshed["required_task_ids"]):
                        raise ContractError("native readiness changed run identity or pruned admitted work")
                    ready = refreshed
                    if isinstance(ready.get("resource_pressure"), dict) and ready["resource_pressure"].get("blocked") is True:
                        print(json.dumps({"schema": "wwl.watchdog.report@1", "run_id": run_id, "status": "blocked", "reason": "external_resource_quota", "resource_pressure": ready["resource_pressure"], "completion_authority": False}), flush=True)
                        return 0 if args.once else 75
                execution_ready, capability_reason = True, ""
                if command and args.execute:
                    try:
                        ready_check(ready, plan, policy, require_execution=True)
                    except ContractError as error:
                        execution_ready, capability_reason = False, str(error)
                request.update(operation="observe", run_id=run_id)
                request["action_ids"] = unsettled_action_ids(state) if state else []
                snapshot = call_adapter(command, "observe", request, policy["adapter_timeout_seconds"]) if command else read_json(args.snapshot)
                # Fixture-only observations use their recorded clock. They
                # cannot authorize dispatch, and are deliberately single-pass.
                now = time.time() if command else snapshot["observed_at"]
                if run_id and snapshot.get("run_id") != run_id:
                    raise ContractError("native observation changed run identity")
                if command and (snapshot.get("required_task_ids") != request["required_task_ids"] or snapshot.get("admitted_plan_revision") != request["admitted_plan_revision"]):
                    refreshed = call_adapter(command, "ready", request, policy["adapter_timeout_seconds"])
                    if ready_check(refreshed, plan, policy, require_execution=False) != run_id or not set(request["required_task_ids"]) <= set(refreshed["required_task_ids"]) or snapshot.get("required_task_ids") != refreshed["required_task_ids"] or snapshot.get("admitted_plan_revision") != refreshed["admitted_plan_revision"]:
                        raise ContractError("native source expansion changed run identity, pruned work or lacks current evidence")
                    request["required_task_ids"] = refreshed["required_task_ids"]
                    request["admitted_plan_revision"] = refreshed["admitted_plan_revision"]
                    ready = refreshed
                    if args.execute:
                        try:
                            ready_check(ready, plan, policy, require_execution=True)
                            execution_ready, capability_reason = True, ""
                        except ContractError as error:
                            execution_ready, capability_reason = False, str(error)
                state = state if state is not None else initial_state(policy, snapshot["run_id"], now)
                before = json.loads(json.dumps(state))
                report = decide(snapshot, state, policy, now)
                capability_wait = False
                if args.execute and command and report.get("action"):
                    kind = report["action"]["kind"]
                    bound = (kind != "diagnose" and execution_ready) or (kind != "repair" and ready["bindings"].get({"reconcile": "reconcile", "recover": "lifecycle_restart", "diagnose": "diagnose"}[kind]) is True)
                    if not bound:
                        # Observation and already-authorized lifecycle work
                        # remain possible while an asynchronous repair canary
                        # refreshes. Do not charge a new unavailable operation.
                        state, capability_wait = before, True
                        report = {"schema": "wwl.watchdog.report@1", "run_id": run_id, "status": "waiting", "reason": "native_execution_capabilities_pending", "requested_kind": kind, "capability_reason": capability_reason, "completion_authority": False}
                elif args.execute and command and not execution_ready and report["status"] not in {"blocked", "held", "complete"}:
                    report.update(status="waiting", native_observation_reason=report["reason"], reason="native_execution_capabilities_pending", capability_reason=capability_reason)
                if args.execute and not capability_wait:
                    # Write-ahead persistence includes charged action budgets.
                    try:
                        atomic_save(args.state, state)
                    except OSError as error:
                        if error.errno not in {errno.ENOSPC, errno.EDQUOT}:
                            raise
                        state = before
                        report = {"schema": "wwl.watchdog.report@1", "run_id": snapshot["run_id"], "status": "blocked", "reason": "external_resource_quota", "error_errno": error.errno, "state_preserved": True, "completion_authority": False}
                    else:
                        persisted = json.loads(json.dumps(state))
                    if report.get("action"):
                        try:
                            result = call_adapter(command, "dispatch", report["action"], policy["adapter_timeout_seconds"])
                            acknowledge(state, result, policy, time.time())
                            report["dispatch_status"] = result["status"]
                        except (OSError, ValueError, subprocess.TimeoutExpired) as exc:
                            report["dispatch_status"] = "unknown"
                            report["dispatch_error_class"] = type(exc).__name__
                        try:
                            atomic_save(args.state, state)
                        except OSError as error:
                            if error.errno not in {errno.ENOSPC, errno.EDQUOT}:
                                raise
                            # The write-ahead outbox is already durable. Keep
                            # it uncertain until native observation, rather
                            # than repeating an effect or refunding its budget.
                            state = persisted
                            report = {"schema": "wwl.watchdog.report@1", "run_id": snapshot["run_id"], "status": "blocked", "reason": "external_resource_quota", "error_errno": error.errno, "state_preserved": True, "effects_unknown": True, "completion_authority": False}
                elif not args.execute:
                    report["observation_only"] = True
                    report["fixture"] = bool(args.snapshot)
                    if report.get("action"):
                        # A preview must not pretend an effect was attempted.
                        state = before
                        report["status"] = "would_request_action"
                if report["status"] == "blocked" and report["reason"].endswith("budget_exhausted"):
                    report.update(monitoring_continues=not args.once, unsettled_action_ids=unsettled_action_ids(state))
                print(json.dumps(report, sort_keys=True), flush=True)
                if report["status"] == "complete":
                    return 0
                if args.once:
                    return 3 if report["status"] == "blocked" and report["reason"] != "external_resource_quota" else 0
                time.sleep(policy["poll_seconds"])
                refresh_readiness = True
    except (OSError, ValueError, KeyError, subprocess.TimeoutExpired) as exc:
        if isinstance(exc, OSError) and exc.errno in {errno.ENOSPC, errno.EDQUOT}:
            print(json.dumps({"schema": "wwl.watchdog.report@1", "status": "blocked", "reason": "external_resource_quota", "error_errno": exc.errno, "state_preserved": True, "completion_authority": False}), flush=True)
            return 0 if args.once else 75
        print(json.dumps({"schema": "wwl.watchdog.error@1", "error": str(exc), "completion_authority": False}), file=sys.stderr)
        return 2


def main(argv: list[str] | None = None) -> int:
    while True:
        result = _run_main(argv)
        if result != 75:
            return result
        # Resource pressure may prevent even creating an owner lock. Stay in
        # this process and retry admission without consuming service restarts.
        time.sleep(30)


if __name__ == "__main__":
    raise SystemExit(main())
