import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type * as NavigationCore from "@react-navigation/core";
import { expect, it } from "vitest";
import { HOME_CAPTURE_ACTIONS } from "../src/navigation/intents";

// Load the installed navigation implementation and its real dependencies.
// Importing the package entry also loads RN host views, unnecessary for URL handling.
const core = dirname(createRequire(import.meta.url).resolve("@react-navigation/core/package.json"));
const { getPathFromState } = await import(
  pathToFileURL(join(core, "lib/module/getPathFromState.js")).href
) as Pick<typeof NavigationCore, "getPathFromState">;
const { getStateFromPath } = await import(
  pathToFileURL(join(core, "lib/module/getStateFromPath.js")).href
) as Pick<typeof NavigationCore, "getStateFromPath">;

it.each(HOME_CAPTURE_ACTIONS)("serializes the real home $intent route and consumes its intent", ({ intent }) => {
  const params: { intent?: string; requestKey?: number } = { intent, requestKey: 1788610000000 };
  const state = { routes: [{ name: "MainTabs", state: { routes: [{ name: "Capture", params }] } }] };
  // BottomTabBar builds this href on native platforms too, before Capture can mount.
  expect(getPathFromState(state)).toBe(`/MainTabs/Capture?intent=${intent}&requestKey=1788610000000`);
  params.intent = undefined;
  params.requestKey = undefined;
  expect(getPathFromState(state)).toBe("/MainTabs/Capture");
});

it("roundtrips encoded parameters through the installed navigation parser", () => {
  const params = { id: "记忆 / ? &", intent: "text" };
  const config = { screens: { Capture: "capture" } };
  const path = getPathFromState({ routes: [{ name: "Capture", params }] }, config);
  expect(getStateFromPath(path, config)?.routes[0]?.params).toEqual(params);
});
