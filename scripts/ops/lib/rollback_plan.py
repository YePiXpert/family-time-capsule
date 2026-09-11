#!/usr/bin/env python3
"""Persist rollback provenance without ever executing restored configuration."""
import argparse
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import time

from snapshot import hash_file, require, reset_recovery_capabilities, verify_database, SnapshotError


def config(path):
    return dict(line.split("=", 1) for line in path.read_text(encoding="utf-8").splitlines() if "=" in line and not line.startswith("#"))


def write_json(path, value):
    fd, staging = tempfile.mkstemp(prefix=".rollback-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            json.dump(value, output, ensure_ascii=False, indent=2)
            output.flush()
            os.fsync(output.fileno())
        os.replace(staging, path)
        fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    finally:
        if os.path.exists(staging): os.unlink(staging)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=["prepare", "field", "check", "approve"])
    parser.add_argument("plan", type=Path)
    parser.add_argument("values", nargs="*")
    args = parser.parse_args()
    if args.operation == "prepare":
        env_file, current_id, target_file, restore_dir, current_snapshot = args.values
        target = config(Path(target_file))
        restored = Path(restore_dir)
        report = json.loads((restored / "restore-report.json").read_text())
        require(report.get("snapshotAppVersion") == target.get("version"), "snapshot_version_does_not_match_deployment")
        require(report.get("snapshotImage") == target.get("image"), "snapshot_image_does_not_match_deployment")
        image = report.get("snapshotImageReference") or target["image"]
        require(isinstance(image, str) and re.fullmatch(r"(?:[A-Za-z0-9][A-Za-z0-9._/:-]*@)?sha256:[0-9a-f]{64}", image), "snapshot_has_no_immutable_image")
        original_env = config(restored / "config/env.snapshot")
        live_env = config(Path(env_file))
        require(original_env.get("AUTH_SECRET") == live_env.get("AUTH_SECRET"), "original_auth_secret_required")
        write_json(args.plan, {
            "version": 1, "sourceDeployment": current_id, "sourceConfigSha256": hash_file(Path(env_file)),
            "sourceVolume": live_env["FTC_DATA_VOLUME"], "sourceImage": live_env["FTC_IMAGE"],
            "targetVersion": target["version"], "targetImage": image,
            "restoreDirectory": str(restored.resolve()), "snapshotSha256": report["snapshotSha256"],
            "currentSnapshot": current_snapshot, "preparedAt": int(time.time()),
        })
        return
    plan = json.loads(args.plan.read_text())
    require(plan.get("version") == 1, "invalid_rollback_plan")
    if args.operation == "field":
        value = plan[args.values[0]]
        require(isinstance(value, (str, int)) and "\n" not in str(value), "invalid_plan_field")
        print(value)
    elif args.operation == "check":
        env_file, current_id = args.values
        require(plan["sourceDeployment"] == current_id and plan["sourceConfigSha256"] == hash_file(Path(env_file)), "deployment_changed_since_prepare")
    else:
        restored = Path(plan["restoreDirectory"])
        report = json.loads((restored / "restore-report.json").read_text())
        require(report["snapshotSha256"] == plan["snapshotSha256"], "restore_provenance_changed")
        # Operator reconciles post-snapshot access/deletions before this step.
        # Any login/link made during isolated review must also be invalidated.
        report.update(reset_recovery_capabilities(restored / "data"))
        report.update(verify_database(restored / "data"))
        report.update({"postSnapshotRevocationsReconciled": True,
                       "reconciliationMethod": "operator-attestation", "reviewedAt": int(time.time())})
        write_json(restored / "restore-report.json", report)


if __name__ == "__main__":
    try:
        main()
    except (SnapshotError, OSError, ValueError, KeyError) as error:
        print(f"rollback plan rejected: {error}", file=sys.stderr)
        sys.exit(1)
