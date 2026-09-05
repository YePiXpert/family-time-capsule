/** Explicit fictional-only smoke against isolated containers/volumes; never a deployed family. */
import { chromium, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import JSZip from "jszip";
const image = "ftc-12-final:local",
  volume = "ftc-12-upgrade-smoke",
  restoreVolume = "ftc-12-restore-smoke",
  restoreApp = "ftc-12-restore-app";
function docker(args: string[], okay = true) {
  const r = spawnSync("sudo", ["-n", "docker", ...args], {
    encoding: "utf8",
    timeout: 240000,
  });
  if (okay) expect(r.status, r.stdout + r.stderr).toBe(0);
  return r;
}
async function main() {
  const report = JSON.parse(
      readFileSync(
        process.env.FTC_UPGRADE_REPORT ?? "/tmp/ftc-m8-upgrade-report.json",
        "utf8",
      ),
    ),
    expected = JSON.parse(
      readFileSync(report.fixtures + "/expected.json", "utf8"),
    ),
    browser = await chromium.launch();
  try {
    const page = await browser.newPage({ baseURL: "http://localhost:3198" });
    await page.goto("/login");
    await page.getByLabel("邮箱").fill("legacy11@example.test");
    await page.getByLabel("密码").fill("fictional-legacy11-password");
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(
      page.getByRole("navigation", { name: "一级导航" }),
    ).toBeVisible();
    for (const a of expected.assets) {
      const r = await page.request.get("/api/media/" + a.id);
      expect(r.status()).toBe(200);
      expect(
        createHash("sha256")
          .update(await r.body())
          .digest("hex"),
      ).toBe(a.sha256);
    }
    const post = async (url: string, data: unknown) => {
        const r = await page.request.post(url, { data });
        expect(r.ok(), await r.text()).toBe(true);
        return r.json();
      },
      patch = async (url: string, data: unknown) => {
        const r = await page.request.patch(url, { data });
        expect(r.ok(), await r.text()).toBe(true);
        return r.json();
      };
    const a = await post("/api/collections", {
      title: "虚构旧卷出生第一周",
      kind: "chapter",
    });
    let album = await patch("/api/collections/" + a.id, {
      operation: "add",
      revision: 1,
      eventIds: expected.events,
    });
    album = await patch("/api/collections/" + a.id, {
      operation: "save",
      revision: album.revision,
      edit: {
        ...album,
        description: "Docker 迁移后的人工说明",
        items: [...album.items].reverse().map((i: object, n: number) => ({
          ...i,
          caption: `人工顺序 ${n + 1}`,
        })),
      },
    });
    const b = await post("/api/books/projects", {
      title: "虚构旧卷的成长年册",
      template: "growth",
      audience: "family",
    });
    let book = await patch("/api/books/projects/" + b.id, {
      operation: "add",
      revision: 1,
      selection: [{ kind: "collection", id: a.id }],
    });
    const photo = book.blocks.find((b: { kind: string }) => b.kind === "image");
    expect(photo).toBeTruthy();
    book = await patch("/api/books/projects/" + b.id, {
      operation: "save",
      revision: book.revision,
      edit: {
        ...book,
        subtitle: "三十二页人工编辑继续保留",
        blocks: Array.from({ length: 32 }, (_, i) => [
          {
            id: randomUUID(),
            chapterId: book.chapters[0].id,
            kind: "text",
            text: `第 ${i + 1} 页虚构中文家书。旧素材经过整理，原件完整保留。Mixed text stays searchable.`,
            caption: "手工排版",
            layout: {
              breakBefore: true,
              fit: "contain",
              focus: Array.from({ length: 4 }, () => ({ x: 0.3, y: 0.7 })),
            },
            sourceIds: photo.sourceIds,
          },
          { ...photo, id: randomUUID(), caption: `虚构照片 ${i + 1}` },
        ]).flat(),
      },
    });
    await patch("/api/books/projects/" + b.id, {
      operation: "snapshot",
      revision: book.revision,
    });
    const results = [];
    for (const format of ["pdf", "epub", "reading_zip"]) {
      const job = await post(`/api/books/projects/${b.id}/renders`, {
        revision: book.revision,
        format,
      });
      const worker = docker([
        "run",
        "--rm",
        "-v",
        volume + ":/data",
        "-e",
        "AUTH_SECRET=fictional-upgrade12-secret",
        image,
        "node",
        "ops/worker.mjs",
        "--once",
      ]);
      expect(worker.stdout).toContain("[book-worker] succeeded");
      const status = await (
        await page.request.get(`/api/books/renders/${job.id}`)
      ).json();
      expect(status.downloadable).toBe(true);
      const r = await page.request.get(`/api/books/renders/${job.id}/download`);
      expect(r.status()).toBe(200);
      writeFileSync(
        "/tmp/ftc-m8-docker." + (format === "reading_zip" ? "zip" : format),
        await r.body(),
      );
      results.push({
        format,
        status: status.status,
        pages: status.pages,
        bytes: status.bytes,
      });
    }
    const exportA = await page.request.get("/api/export");
    expect(exportA.status()).toBe(200);
    const archiveA = await exportA.body();
    mkdirSync("/tmp/ftc-m8-docker-fixtures", { recursive: true });
    writeFileSync("/tmp/ftc-m8-docker-fixtures/complete12.zip", archiveA);
    const zipA = await JSZip.loadAsync(archiveA),
      broken = await JSZip.loadAsync(archiveA);
    broken.remove("family-time-capsule-export/book-chapters.json");
    writeFileSync(
      "/tmp/ftc-m8-docker-fixtures/broken12.zip",
      await broken.generateAsync({ type: "nodebuffer" }),
    );
    docker(["volume", "create", restoreVolume]);
    docker([
      "run",
      "-d",
      "--name",
      restoreApp,
      "-p",
      "3197:3000",
      "-v",
      restoreVolume + ":/data",
      "-e",
      "AUTH_SECRET=fictional-docker12-restore",
      "-e",
      "INITIAL_SETUP_TOKEN=fictional-docker12-restore",
      "-e",
      "BETTER_AUTH_URL=http://localhost:3197",
      image,
    ]);
    const fresh = await browser.newPage({ baseURL: "http://localhost:3197" });
    await expect
      .poll(async () => {
        try {
          return (await fresh.request.get("/setup")).status();
        } catch {
          return 0;
        }
      })
      .toBe(200);
    await fresh.goto("/setup");
    await fresh.getByLabel("初始化令牌").fill("fictional-docker12-restore");
    await fresh.getByLabel("显示名称").fill("虚构恢复管理员");
    await fresh
      .getByLabel("邮箱（登录用）")
      .fill("docker12-restore@example.test");
    await fresh
      .getByLabel("密码（至少 10 位）")
      .fill("fictional-docker12-password");
    await fresh.getByLabel("确认密码").fill("fictional-docker12-password");
    await fresh.getByRole("button", { name: "创建管理员" }).click();
    await expect(fresh).toHaveURL(/login/);
    docker(["stop", restoreApp]);
    const restore = (filename: string, okay = true) =>
      docker(
        [
          "run",
          "--rm",
          "-v",
          restoreVolume + ":/data",
          "-v",
          "/tmp/ftc-m8-docker-fixtures:/fixtures:ro",
          "-e",
          "AUTH_SECRET=fictional-docker12-restore",
          image,
          "node",
          "ops/restore.mjs",
          "/fixtures/" + filename,
        ],
        okay,
      );
    const rejected = restore("broken12.zip", false);
    expect(rejected.status).not.toBe(0);
    writeFileSync(
      "/tmp/ftc-m8-docker-restore-rejection.log",
      rejected.stdout + rejected.stderr,
    );
    const check = docker([
      "run",
      "--rm",
      "-v",
      restoreVolume + ":/data",
      image,
      "node",
      "-e",
      "const D=require('better-sqlite3'); const d=new D('/data/db/capsule.sqlite'); if(d.prepare('select count(*) n from family').get().n!==0) process.exit(2); console.log('failed restore wrote no family');",
    ]);
    expect(check.stdout).toContain("no family");
    const restored = restore("complete12.zip");
    writeFileSync(
      "/tmp/ftc-m8-docker-restore.log",
      restored.stdout + restored.stderr,
    );
    docker(["start", restoreApp]);
    await expect
      .poll(async () => {
        try {
          return (await fresh.request.get("/api/health")).status();
        } catch {
          return 0;
        }
      })
      .toBe(200);
    await fresh.context().clearCookies();
    await fresh.goto("/login");
    await fresh.getByLabel("邮箱").fill("docker12-restore@example.test");
    await fresh.getByLabel("密码").fill("fictional-docker12-password");
    await fresh.getByRole("button", { name: "登录", exact: true }).click();
    await expect(fresh).toHaveURL(/onboarding/);
    await fresh
      .getByRole("combobox", { name: /你是/ })
      .selectOption({ label: "爸爸" });
    await fresh.getByRole("button", { name: "进入家庭" }).click();
    await expect(
      fresh.getByRole("navigation", { name: "一级导航" }),
    ).toBeVisible();
    const reread = await (
      await fresh.request.get("/api/books/projects/" + b.id)
    ).json();
    expect(reread.blocks).toEqual(book.blocks);
    expect(reread.subtitle).toBe(book.subtitle);
    const realbum = await (
      await fresh.request.get("/api/collections/" + a.id)
    ).json();
    // Preview derivatives are rebuildable and are deliberately absent from portable backups.
    const durableItems = (items: typeof album.items) =>
      items.map(
        (item: { source: { previewAssetId: string | null } | null }) => ({
          ...item,
          source: item.source
            ? { ...item.source, previewAssetId: undefined }
            : null,
        }),
      );
    expect(durableItems(realbum.items)).toEqual(durableItems(album.items));
    for (const asset of expected.assets) {
      const response = await fresh.request.get("/api/media/" + asset.id);
      expect(response.status()).toBe(200);
      expect(
        createHash("sha256")
          .update(await response.body())
          .digest("hex"),
      ).toBe(asset.sha256);
    }
    const exportB = await fresh.request.get("/api/export");
    expect(exportB.status()).toBe(200);
    writeFileSync(
      "/tmp/ftc-m8-docker-fixtures/reexport12.zip",
      await exportB.body(),
    );
    const zipB = await JSZip.loadAsync(await exportB.body());
    for (const name of [
      "collections",
      "collection-sections",
      "collection-items",
      "book-projects",
      "book-chapters",
      "book-blocks",
      "book-source-refs",
      "book-block-sources",
      "book-revisions",
    ])
      expect(
        JSON.parse(
          await zipB
            .file(`family-time-capsule-export/${name}.json`)!
            .async("string"),
        ),
        name,
      ).toEqual(
        JSON.parse(
          await zipA
            .file(`family-time-capsule-export/${name}.json`)!
            .async("string"),
        ),
      );
    const artifactReport = {
      image: docker([
        "image",
        "inspect",
        image,
        "--format",
        "{{.Id}}",
      ]).stdout.trim(),
      volume,
      restoreVolume,
      events: 5,
      originals: 5,
      bookBlocks: reread.blocks.length,
      formats: results,
      upgrade: "passed",
      brokenRestore: "rejected before writes",
      restoreReexport: "passed",
      originalsSha: "unchanged",
    };
    writeFileSync(
      "/tmp/ftc-m8-docker-report.json",
      JSON.stringify(artifactReport, null, 2),
    );
    console.log(JSON.stringify(artifactReport, null, 2));
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
