import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const available = spawnSync("docker", ["compose", "version"], { encoding: "utf8" }).status === 0;

describe.skipIf(!available && process.env.FTC_REQUIRE_COMPOSE !== "1")("real Docker Compose templates (no daemon required)", () => {
  it.each(["docker-compose.yml", "scripts/ops/templates/compose.loopback.yml", "scripts/ops/templates/compose.caddy.yml"])("passes WebDAV configuration to the app in %s", (file) => {
    const backupEnv = {
      WEBDAV_URL: "https://backup.example/dav",
      WEBDAV_USERNAME: "synthetic-user",
      WEBDAV_PASSWORD: "synthetic-password",
      WEBDAV_DIRECTORY: "/family-archive",
      WEBDAV_REQUEST_TIMEOUT_MS: "3600000",
    };
    const result = spawnSync("docker", ["compose", "-f", path.resolve(file), "config", "--format", "json"], {
      encoding: "utf8",
      env: {
        ...process.env, ...backupEnv,
        FTC_PROJECT_NAME: "ftc-config-test", FTC_IMAGE: "example.invalid/capsule:test",
        FTC_DATA_VOLUME: "family-custom-data", FTC_DOMAIN: "capsule.example.com",
        FTC_LOOPBACK_PORT: "3002", AUTH_SECRET: "test-only-compose-placeholder",
        BETTER_AUTH_URL: "https://capsule.example.com",
      },
    });
    expect(result.status, result.stderr).toBe(0);
    const config = JSON.parse(result.stdout);
    expect(config.services.app.environment).toMatchObject(backupEnv);
    expect(config.services.worker.environment.WEBDAV_PASSWORD).toBeUndefined();
  });

  it.each(["loopback", "caddy"])("resolves %s with a custom external volume", (mode) => {
    const result = spawnSync("docker", [
      "compose", "-f", path.resolve(`scripts/ops/templates/compose.${mode}.yml`), "config", "--format", "json",
    ], {
      encoding: "utf8",
      env: {
        ...process.env,
        FTC_PROJECT_NAME: "ftc-config-test",
        FTC_IMAGE: "example.invalid/capsule:1.3.0-alpha.1",
        FTC_DATA_VOLUME: "family-custom-data",
        FTC_DOMAIN: "capsule.example.com",
        FTC_LOOPBACK_PORT: "3002",
        AUTH_SECRET: "test-only-compose-placeholder",
        BETTER_AUTH_URL: "https://capsule.example.com",
      },
    });
    expect(result.status, result.stderr).toBe(0);
    const config = JSON.parse(result.stdout);
    expect(config.volumes["capsule-data"]).toMatchObject({ name: "family-custom-data", external: true });
    for (const service of [config.services.app, config.services.worker]) {
      expect(service.volumes).toContainEqual(expect.objectContaining({ source: "capsule-data", target: "/data" }));
      expect(service.labels["com.centurylinklabs.watchtower.enable"]).toBe("false");
    }
    if (mode === "loopback") {
      expect(config.services.app.ports).toEqual([
        expect.objectContaining({ host_ip: "127.0.0.1", published: "3002", target: 3000 }),
      ]);
    } else {
      expect(config.services.app.ports).toBeUndefined();
      expect(config.services.proxy.environment.FTC_DOMAIN).toBe("capsule.example.com");
    }
  });
});
