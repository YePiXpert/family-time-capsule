import { defineConfig } from "eslint/config";
import expoConfig from "eslint-config-expo/flat.js";

export default defineConfig([
  ...expoConfig,
  {
    ignores: ["android/**", "ios/**", "dist/**", "dist-*/**", "build/**", "test-results/**", "cloud-artifacts/**", "modules/*/android/build/**"],
  },
]);
