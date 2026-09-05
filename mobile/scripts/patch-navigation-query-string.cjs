const fs = require("node:fs");
const path = require("node:path");

// query-string 9.5.1 fixes GHSA-vcc3-ghjq-m6fr but exposes only a default
// export. React Navigation 7's namespace import targets query-string 7 and
// crashes BottomTabBar when a route has params, including native home shortcuts.
// Patch both Metro source and the published JS; keep the security override.
const manifest = require.resolve("@react-navigation/core/package.json");
const core = JSON.parse(fs.readFileSync(manifest, "utf8"));
if (core.version !== "7.21.13") {
  throw new Error(`Review the query-string compatibility patch for @react-navigation/core ${core.version}`);
}
const original = "import * as queryString from 'query-string';";
const replacement = "import queryString from 'query-string';";
const files = [
  "src/getPathFromState.tsx",
  "src/getStateFromPath.tsx",
  "lib/module/getPathFromState.js",
  "lib/module/getStateFromPath.js",
];
const patches = files.map((relative) => {
  const file = path.join(path.dirname(manifest), relative);
  const source = fs.readFileSync(file, "utf8");
  if (source.includes(replacement) && !source.includes(original)) return null;
  if (source.split(original).length !== 2 || source.includes(replacement)) {
    throw new Error(`Unexpected navigation import in ${relative}; review compatibility before building`);
  }
  return { file, source: source.replace(original, replacement) };
});
for (const patch of patches) {
  if (patch) fs.writeFileSync(patch.file, patch.source);
}
console.log("React Navigation query-string default imports verified (source and compiled JS).");
