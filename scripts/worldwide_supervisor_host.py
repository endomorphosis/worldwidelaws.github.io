#!/usr/bin/env python3
"""Install and inspect only the worldwide legal search supervisor host units."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "config/worldwide_supervisor_host.json"
UNITS = {"supervisor": "worldwide-legal-search-supervisor.service", "watchdog": "worldwide-legal-search-watchdog.service"}
MANAGED = "# Managed by worldwide_supervisor_host.py"


def require(value, reason):
    if not value:
        raise ValueError(reason)


def load_config(path):
    value = json.loads(path.read_text())
    require(value.get("schema") == "worldwide-legal-search.host@1", "Unsupported host configuration")
    for key in ("site_root", "framework_root", "state_root", "python_executable"):
        require(isinstance(value.get(key), str) and Path(value[key]).is_absolute(), "Expected absolute " + key)
    require(Path(value["site_root"]).resolve() == ROOT.resolve(), "Host configuration belongs to another site")
    require(Path(value["python_executable"]).is_file(), "Configured interpreter is absent")
    require((Path(value["framework_root"]) / "ipfs_accelerate_py").is_dir(), "Configured native framework is absent")
    require(type(value.get("watchdog_execute")) is bool, "Explicit watchdog execution mode is required")
    for key in ("runtime_argv", "adapter_argv"):
        require(isinstance(value.get(key), list) and value[key] and all(isinstance(v, str) and v and "\0" not in v and "\n" not in v for v in value[key]), "Expected explicit argv for " + key)
        require(Path(value[key][0]).resolve() == Path(value["python_executable"]).resolve(), "Unit interpreter differs from configured Python")
    return value


def atomically(path, content, mode=0o600):
    path.parent.mkdir(parents=True, exist_ok=True)
    require(not path.is_symlink(), "Refuse symlink unit/config target")
    fd, temporary = tempfile.mkstemp(prefix=".worldwide-host-", dir=path.parent)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, "w") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def arg(value):
    require(not any(ord(c) < 32 for c in str(value)), "Unit arguments cannot contain controls")
    return json.dumps(str(value).replace("%", "%%").replace("$", "$$"))


def render(config):
    state = Path(config["state_root"])
    watchdog = [config["python_executable"], "-B", str(ROOT / "implementation_plan/worldwide_legal_search/watchdog_loop.py"), "--adapter-argv-json", json.dumps(config["adapter_argv"]), "--state", str(state / "watchdog/state.json")]
    if config["watchdog_execute"]:
        watchdog.append("--execute")
    commands = {"supervisor": config["runtime_argv"], "watchdog": watchdog}
    units = {}
    for role, name in UNITS.items():
        lines = [MANAGED, "[Unit]", "Description=Worldwide legal search " + role,
                 "StartLimitIntervalSec=600", "StartLimitBurst=5", "", "[Service]", "Type=simple",
                 "WorkingDirectory=" + str(ROOT).replace("%", "%%"), "UMask=0077",
                 "Environment=" + arg("PYTHONPATH=" + config["framework_root"]),
                 "Environment=PYTHONDONTWRITEBYTECODE=1", "Environment=PYTHONUNBUFFERED=1",
                 "Environment=" + arg("IPFS_ACCELERATE_AGENT_ORCHESTRATION_DIR=" + str(Path.home() / ".ipfs_accelerate/agent_supervisor/orchestration")),
                 "Environment=" + arg("PATH=" + str(Path(config["python_executable"]).parent) + ":" + str(Path.home() / ".local/bin") + ":/usr/local/bin:/usr/bin:/bin"),
                 "ExecCondition=/usr/bin/test ! -e " + arg(state / "HOLD"),
                 "ExecStart=" + " ".join(arg(v) for v in commands[role]),
                 "Restart=on-failure", "RestartSec=15s", "RestartPreventExitStatus=3 78",
                 "KillMode=control-group", "TimeoutStopSec=90s", "CPUAccounting=yes", "MemoryAccounting=yes",
                 "StandardOutput=journal", "StandardError=journal", "SyslogIdentifier=" + name[:-8],
                 "", "[Install]", "WantedBy=default.target", ""]
        units[name] = "\n".join(lines)
    return units


def systemctl(*args, allowed=(0,)):
    result = subprocess.run(["systemctl", "--user", *args], capture_output=True, text=True, timeout=30, check=False)
    require(result.returncode in allowed, "systemctl failed: " + result.stderr[-1000:])
    return result


def install(config, directory=None):
    directory = directory or Path.home() / ".config/systemd/user"
    paths = []
    for name, content in render(config).items():
        path = directory / name
        if path.exists():
            require(path.read_text().startswith(MANAGED + "\n"), "Refuse to replace an unmanaged service: " + name)
        atomically(path, content, 0o644)
        paths.append(str(path))
    return paths


def status(config, full=False):
    result = {"schema": "worldwide-legal-search.host-status@1", "recorded_at": datetime.now(timezone.utc).isoformat(), "watchdog_execution_requested": config["watchdog_execute"], "services": {}}
    for role, unit in UNITS.items():
        shown = systemctl("show", unit, "--property=ActiveState,SubState,MainPID,Result,NRestarts,ExecMainStatus", allowed=(0, 1, 3, 4))
        result["services"][role] = dict(line.split("=", 1) for line in shown.stdout.splitlines() if "=" in line)
    for name in ("campaign-status", "campaign-readiness"):
        path = Path(config["state_root"]) / (name + ".json")
        if path.is_file():
            require(path.stat().st_size < 4 * 1024 * 1024, "Status projection exceeds its bound")
            value = json.loads(path.read_text())
            if full:
                result[name] = value
            elif name == "campaign-status":
                result["campaign"] = {key: value.get(key) for key in ("run_id", "task_id", "stage", "heartbeat_at", "meaningful_progress_at_ms", "ready_task_ids", "native_error", "completion_verified")}
                result["campaign"].update(required_tasks=len(value.get("required_task_ids", [])), verified_tasks=len(value.get("verified_task_ids", [])))
            else:
                result["readiness"] = {key: value.get(key) for key in ("native_revision", "bindings", "control_canary_verified", "bootstrap_only")}
    result["hold"] = (Path(config["state_root"]) / "HOLD").exists()
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("render", "install", "start", "stop", "status"))
    parser.add_argument("--config", type=Path, default=CONFIG)
    parser.add_argument("--full", action="store_true", help="Include complete canonical projections")
    args = parser.parse_args(argv)
    try:
        config = load_config(args.config)
        if args.operation == "render":
            result = render(config)
        elif args.operation == "install":
            result = {"unit_paths": install(config)}
            systemctl("daemon-reload")
            systemctl("enable", *UNITS.values())
        elif args.operation == "start":
            require(not (Path(config["state_root"]) / "HOLD").exists(), "The campaign is held; inspect its stop reason before explicit resumption")
            systemctl("start", *UNITS.values())
            result = status(config, full=args.full)
        elif args.operation == "stop":
            atomically(Path(config["state_root"]) / "HOLD", "Stopped through worldwide_supervisor_host.py at " + datetime.now(timezone.utc).isoformat() + "\n")
            systemctl("stop", *UNITS.values())
            result = status(config, full=args.full)
        else:
            result = status(config, full=args.full)
        print(json.dumps(result, indent=2))
        return 0
    except (OSError, ValueError, subprocess.TimeoutExpired) as exc:
        print(json.dumps({"valid": False, "error": str(exc)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
