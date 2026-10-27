from __future__ import annotations

import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("worldwide_host", ROOT / "scripts/worldwide_supervisor_host.py")
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)


class HostOwnershipTests(unittest.TestCase):
    def config(self, state):
        return {"site_root": str(ROOT), "framework_root": "/framework", "state_root": str(state),
                "python_executable": "/usr/bin/python3", "runtime_argv": ["/usr/bin/python3", "-m", "native_runtime", "run"],
                "adapter_argv": ["/usr/bin/python3", "-m", "native_adapter"], "watchdog_execute": False}

    def test_install_does_not_overwrite_an_unmanaged_unit(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            foreign = path / host.UNITS["supervisor"]
            foreign.write_text("[Service]\nExecStart=/bin/false\n")
            with self.assertRaises(ValueError):
                host.install(self.config(path / "state"), directory=path)
            self.assertEqual(foreign.read_text(), "[Service]\nExecStart=/bin/false\n")

    def test_units_are_scoped_hold_aware_and_restart_bounded(self):
        with tempfile.TemporaryDirectory() as directory:
            units = host.render(self.config(Path(directory)))
            self.assertEqual(set(units), set(host.UNITS.values()))
            for text in units.values():
                self.assertIn("ExecCondition=/usr/bin/test ! -e", text)
                self.assertIn("StartLimitBurst=5", text)
                self.assertIn("RestartPreventExitStatus=3 78", text)
                self.assertIn("KillMode=control-group", text)
                self.assertIn("IPFS_ACCELERATE_AGENT_ORCHESTRATION_DIR=", text)
                self.assertNotIn("Restart=always", text)
            self.assertNotIn('"--execute"', units[host.UNITS["watchdog"]])

    def test_execute_mode_is_an_explicit_service_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            config = self.config(Path(directory))
            config["watchdog_execute"] = True
            unit = host.render(config)[host.UNITS["watchdog"]]
            self.assertIn('"--execute"', unit)


if __name__ == "__main__":
    unittest.main()
