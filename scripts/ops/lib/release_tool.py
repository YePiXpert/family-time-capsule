#!/usr/bin/env python3
"""ftc 发布注册表工具（版本归一化，M0-V）。

用法：
  release_tool.py resolve --image <ref> [--version <v>] [--registry <path>]
  release_tool.py transition --from <v> --to <v> [--allow-nonstable-target] [--registry <path>]

规则（见仓库根 VERSIONING.md）：
  1. 版本只来自显式注册表或 --version 显式声明；绝不从镜像 ref 截取——
     digest 固定引用（image@sha256:...）在 sed 's/.*://' 下会产出伪版本。
  2. 发布顺序只比较注册表 sequence 字段，绝不用 sort -V：
     SemVer 优先级里 1.0.0 < 1.3.0-alpha.1，而正式主线要求探索版可升级到
     1.0.0，这是一次显式重新编号，不能用 SemVer 比较表达。
  3. 通道纪律：exploration→formal 允许（历史升级路径）；formal→exploration
     拒绝（探索期已结束）；formal 内部 sequence 不回退；stable→非 stable
     需要 --allow-nonstable-target 显式确认。

输出：单行 JSON 到 stdout（供 shell 读取），人类可读原因到 stderr。
退出码：0 成功；26 解析/迁移被拒绝；27 注册表文件损坏。
"""

import argparse
import json
import re
import sys

DEFAULT_REGISTRY = None  # 由 --registry 或环境变量 FTC_RELEASE_REGISTRY 提供

EXIT_OK = 0
EXIT_REFUSED = 26
EXIT_REGISTRY_BROKEN = 27

_SEMVER = re.compile(r"^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$")


def load_registry(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError) as exc:
        print(f"release registry unreadable: {exc}", file=sys.stderr)
        sys.exit(EXIT_REGISTRY_BROKEN)
    releases = data.get("releases")
    if not isinstance(releases, list):
        print("release registry missing 'releases' list", file=sys.stderr)
        sys.exit(EXIT_REGISTRY_BROKEN)
    return data


def find(registry: dict, version: str):
    for entry in registry["releases"]:
        if entry.get("version") == version:
            return entry
    return None


def ref_tag(image: str):
    """从镜像引用安全提取 tag。digest 引用返回 None（不能当版本用）。"""
    if "@" in image:
        return None
    # 最后一个路径段之后的冒号才是 tag 分隔符。
    last_segment = image.rsplit("/", 1)[-1]
    if ":" in last_segment:
        return last_segment.split(":", 1)[1]
    return None


def cmd_resolve(args) -> int:
    registry = load_registry(args.registry)
    source = None
    version = None
    if args.version:
        version = args.version
        source = "flag"
    else:
        tag = ref_tag(args.image or "")
        if tag is None:
            if not args.image:
                print("no image reference given", file=sys.stderr)
                return EXIT_REFUSED
            print(
                "digest-pinned image ref carries no version tag; pass --version explicitly",
                file=sys.stderr,
            )
            return EXIT_REFUSED
        version = tag
        source = "image-tag"
    if not _SEMVER.match(version or ""):
        print(f"not a semver string: {version!r}", file=sys.stderr)
        return EXIT_REFUSED
    entry = find(registry, version)
    if entry is None:
        print(
            f"release {version} is not in the registry (source whitelist); refusing",
            file=sys.stderr,
        )
        return EXIT_REFUSED
    print(
        json.dumps(
            {
                "ok": True,
                "version": entry["version"],
                "channel": entry["channel"],
                "era": entry["era"],
                "sequence": entry["sequence"],
                "source": source,
            },
            ensure_ascii=False,
        )
    )
    return EXIT_OK


def cmd_transition(args) -> int:
    registry = load_registry(args.registry)
    src = find(registry, args.src)
    dst = find(registry, args.dst)
    if src is None or dst is None:
        missing = args.src if src is None else args.dst
        print(f"version not registered: {missing}", file=sys.stderr)
        return EXIT_REFUSED
    allowed = True
    reason = ""
    if src["era"] == "exploration" and dst["era"] == "formal":
        reason = "探索期 → 当前维护主线（发布注册表显式允许的升级路径）"
    elif src["era"] == "formal" and dst["era"] == "exploration":
        allowed = False
        reason = "正式主线不能回退到探索期版本（探索期已结束）"
    elif dst["sequence"] < src["sequence"]:
        allowed = False
        reason = "目标版本 sequence 低于当前（版本回退）；数据回退请走 ftc rollback 的显式数据决策"
    elif src["channel"] == "stable" and dst["channel"] != "stable":
        if args.allow_nonstable_target:
            reason = "stable → 非 stable 已通过 --allow-nonstable-target 显式确认"
        else:
            allowed = False
            reason = "stable 安装只沿 stable 通道升级；确要离开请加 --allow-nonstable-target"
    else:
        reason = "同一纪元内的前进或一致性重装"
    print(
        json.dumps(
            {
                "ok": allowed,
                "from": {"version": src["version"], "channel": src["channel"], "era": src["era"], "sequence": src["sequence"]},
                "to": {"version": dst["version"], "channel": dst["channel"], "era": dst["era"], "sequence": dst["sequence"]},
                "reason": reason,
            },
            ensure_ascii=False,
        )
    )
    return EXIT_OK if allowed else EXIT_REFUSED


def main() -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("command", choices=("resolve", "transition"))
    parser.add_argument("--registry", default=DEFAULT_REGISTRY)
    parser.add_argument("--image", default="")
    parser.add_argument("--version", default="")
    parser.add_argument("--from", dest="src", default="")
    parser.add_argument("--to", dest="dst", default="")
    parser.add_argument("--allow-nonstable-target", action="store_true")
    args = parser.parse_args()
    if not args.registry:
        import os

        args.registry = os.environ.get(
            "FTC_RELEASE_REGISTRY",
            os.path.join(os.path.dirname(os.path.abspath(__file__)), "releases.json"),
        )
    if args.command == "resolve":
        return cmd_resolve(args)
    return cmd_transition(args)


if __name__ == "__main__":
    sys.exit(main())
