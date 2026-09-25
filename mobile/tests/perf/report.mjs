// 汇总 perf-results/*.json 成 Markdown 表：node tests/perf/report.mjs [dir]
import * as fs from "node:fs";
import * as path from "node:path";

const dir = process.argv[2] ?? path.resolve(process.env.TMPDIR ?? "/var/tmp", "anan-perf-results");
const rows = new Map();
const sizes = new Set();
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  const mode = file.includes(".jitless.") ? "jitless" : "jit";
  for (const r of JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"))) {
    const key = `${r.group}|${r.op}`;
    if (!rows.has(key)) rows.set(key, { group: r.group, op: r.op, cells: {}, notes: {} });
    const row = rows.get(key);
    row.cells[`${mode}:${r.size}`] = r.median;
    if (r.note) row.notes[r.size] = r.note;
    sizes.add(String(r.size));
  }
}
const order = [...sizes].sort((a, b) => (Number(a) || 0) - (Number(b) || 0));
const fmt = (v) => (v === undefined ? "–" : v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));
const head = ["group", "operation", ...order.map((s) => `${s} jit`), ...order.map((s) => `${s} jitless`), "notes (largest size)"];
console.log(`| ${head.join(" | ")} |`);
console.log(`| ${head.map(() => "---").join(" | ")} |`);
for (const row of rows.values()) {
  const cells = [...order.map((s) => fmt(row.cells[`jit:${s}`])), ...order.map((s) => fmt(row.cells[`jitless:${s}`]))];
  const lastNote = Object.values(row.notes).at(-1) ?? "";
  console.log(`| ${row.group} | ${row.op} | ${cells.join(" | ")} | ${lastNote} |`);
}
