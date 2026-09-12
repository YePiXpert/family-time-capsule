#!/usr/bin/env python3
"""Compare measurements; CI simulator timing is evidence, not a device SLA."""
import json
from pathlib import Path
import sys

before, after = [json.loads(Path(path).read_text()) for path in sys.argv[1:3]]
for key in ("runtime", "device", "host", "architecture"):
    assert before[key] == after[key], f"Profile environments differ: {key}"
assert before["success"] and after["success"]
print(f"Baseline `{before['gitSha']}` → delivered `{after['gitSha']}`")
print(f"\nSame runner, {after['device']}, {after['runtime']}; 400 synthetic records, five iterations.")
print("\n| XCTest metric | Before | After | Change |")
print("| --- | ---: | ---: | ---: |")
baseline = {metric["name"]: metric["average"] for metric in before["scrollMetrics"]}
for metric in after["scrollMetrics"]:
    name, current = metric["name"], metric["average"]
    if name not in baseline:
        continue
    previous = baseline[name]
    change = f"{(current / previous - 1) * 100:+.1f}%" if previous else f"{current - previous:+.3f}"
    print(f"| {name} | {previous:.3f} | {current:.3f} | {change} |")
print("\nSimulator results include automation/host overhead. Inspect the raw samples and native screenshots; physical-device smoothness remains a separate check.")
