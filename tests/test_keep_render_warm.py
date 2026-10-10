import importlib.util
import io
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import MagicMock, patch
from urllib.error import URLError

spec = importlib.util.spec_from_file_location(
    "keep_render_warm", Path(__file__).parents[1] / "scripts/keep_render_warm.py"
)
monitor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(monitor)


class HealthMonitorTests(unittest.TestCase):
    def test_health_checks_response_and_uses_a_cold_start_timeout(self):
        response = MagicMock(status=200)
        response.read.return_value = b'{"status":"ok","service":"mint-api"}'
        with patch.object(monitor, "urlopen") as open_url:
            open_url.return_value.__enter__.return_value = response
            monitor.check_health()
            request = open_url.call_args.args[0]
            self.assertEqual(request.full_url, monitor.HEALTH_URL)
            self.assertEqual(open_url.call_args.kwargs["timeout"], 75)
            for body in [b'<html>Starting server</html>', b'[]', b'{"status":"error","service":"mint-api"}', b'{"status":"ok","service":"other"}']:
                response.read.return_value = body
                with self.assertRaises(ValueError):
                    monitor.check_health()

    def test_network_failure_does_not_stop_the_next_check(self):
        with patch("sys.argv", ["keep_render_warm.py"]), patch.object(
            monitor, "check_health", side_effect=[URLError("offline"), None]
        ) as check, patch.object(monitor.time, "monotonic", side_effect=[0, 2, 30, 31]), patch.object(
            monitor.time, "sleep", side_effect=[None, KeyboardInterrupt]
        ) as sleep, redirect_stdout(io.StringIO()) as output:
            with self.assertRaises(KeyboardInterrupt):
                monitor.main()
            self.assertEqual(check.call_count, 2)
            self.assertEqual(sleep.call_args_list[0].args, (28,))
            self.assertEqual(sleep.call_args_list[1].args, (29,))
            self.assertIn("FAILED", output.getvalue())
            self.assertIn("OK", output.getvalue())

    def test_single_check_exit_status(self):
        for error, expected in [(None, 0), (URLError("offline"), 1)]:
            with patch("sys.argv", ["keep_render_warm.py", "--once"]), patch.object(
                monitor, "check_health", side_effect=error
            ), redirect_stdout(io.StringIO()):
                self.assertEqual(monitor.main(), expected)


if __name__ == "__main__":
    unittest.main()
