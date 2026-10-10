#!/usr/bin/env python3
"""Check MINT's Render health every 30 seconds while this computer is online."""

import argparse
import json
import time
from datetime import datetime
from urllib.request import Request, urlopen

HEALTH_URL = "https://mint-api-nlqd.onrender.com/api/health"
INTERVAL_SECONDS = 30
TIMEOUT_SECONDS = 75  # Allow the first request to wake a sleeping free instance.


def check_health():
    request = Request(
        HEALTH_URL,
        headers={"Accept": "application/json", "User-Agent": "MINT-health-monitor/1.0"},
    )
    with urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        data = json.loads(response.read(8192))
        if response.status != 200 or not isinstance(data, dict):
            raise ValueError("Unexpected health response")
        if data.get("status") != "ok" or data.get("service") != "mint-api":
            raise ValueError("MINT did not report healthy")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true", help="Check once and exit")
    args = parser.parse_args()
    while True:
        started = time.monotonic()
        healthy = True
        try:
            check_health()
            message = "OK"
        except (OSError, ValueError) as error:
            healthy = False
            message = f"FAILED: {error}"
        elapsed = time.monotonic() - started
        if healthy and elapsed > 5:
            message = "SLOW: healthy, but took more than 5 seconds"
        print(f"{datetime.now().astimezone().isoformat(timespec='seconds')} {message} ({elapsed:.2f}s)", flush=True)
        if args.once:
            return 0 if healthy else 1
        time.sleep(max(0, INTERVAL_SECONDS - elapsed))


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("MINT health monitor stopped.", flush=True)
