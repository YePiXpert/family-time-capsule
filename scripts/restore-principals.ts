#!/usr/bin/env tsx
import { closeDatabase } from "@/db";
import { bindRestoredPrincipal, listRestoredPrincipals } from "@/lib/restore/principals";
try {
  const args = process.argv.slice(2), values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    if (!["--family", "--bind", "--to", "--operator"].includes(args[i]) || values.has(args[i]) || !args[i+1] || args[i+1].startsWith("--")) throw new Error("用法：restore-principals --family ID [--bind 归档身份ID --to 当前账号ID --operator 维护者账号ID]");
    values.set(args[i], args[i+1]);
  }
  const familyId = values.get("--family");
  if (!familyId) throw new Error("必须指定 --family");
  if (values.size > 1) {
    if (values.size !== 4) throw new Error("绑定须同时提供 --bind、--to、--operator");
    console.log(JSON.stringify(bindRestoredPrincipal(familyId, values.get("--bind")!, values.get("--to")!, values.get("--operator")!)));
  } else console.log(JSON.stringify(listRestoredPrincipals(familyId), null, 2));
} catch (error) { console.error(error instanceof Error ? error.message : "归档身份操作失败"); process.exitCode = 1; }
finally { closeDatabase(); }
