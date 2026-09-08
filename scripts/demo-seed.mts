#!/usr/bin/env node
/**
 * 生成演示数据：合成一个家庭（人物、跨时间段记忆、图片/音频原件、时间胶囊）。
 *
 * - 只写专用演示目录（默认 <repo>/demo-data），不动 ./data 正式档案；已存在时
 *   需 --reset 才重建。
 * - 登录凭据固定（仅演示目录）：demo@family.local / demo-family-2026。
 * - 全部素材为程序合成的插画照片与正弦波音频，不含任何真实人物数据（NAV-12/SEC-9）。
 *
 * 用法：npm run demo:seed [-- --reset]
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = process.env.DEMO_DATA_DIR ?? path.join(root, "demo-data");
const reset = process.argv.includes("--reset");
const envFile = path.join(dataDir, "demo-env.json");

if (existsSync(path.join(dataDir, "db")) && !reset) {
  if (existsSync(envFile)) {
    const existing = JSON.parse(await import("node:fs").then(m => m.readFileSync(envFile, "utf8")));
    console.log(`演示数据已存在（${dataDir}）。加 --reset 重建，或直接 npm run demo 启动。`);
    console.log(`登录：${existing.email} / ${existing.password}`);
  } else {
    console.log(`目录 ${dataDir} 已有数据库但缺少 demo-env.json；请用 --reset 重建演示目录。`);
  }
  process.exit(0);
}
if (reset && existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true });
mkdirSync(dataDir, { recursive: true });

const AUTH_SECRET = randomBytes(32).toString("base64");
// 环境必须先于任何应用模块导入（lib/paths 在模块加载时读取 DATA_DIR）。
process.env.DATA_DIR = dataDir;
process.env.AUTH_SECRET = AUTH_SECRET;
process.env.INITIAL_SETUP_TOKEN = randomBytes(24).toString("hex");
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";

const DEMO_EMAIL = "demo@family.local";
const DEMO_PASSWORD = "demo-family-2026";

// ---------- 合成插画（sharp 渲染 SVG → JPEG） ----------
const W = 1280;
const H = 960;
const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`;
const grad = (id: string, from: string, to: string, vertical = true) =>
  `<defs><linearGradient id="${id}" x1="0" y1="0" x2="${vertical ? 0 : 1}" y2="${vertical ? 1 : 0}">` +
  `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>`;

function sceneBlocks() {
  return svg(grad("wall", "#F7EFE4", "#EDE0CD") +
    `<rect width="${W}" height="${H}" fill="url(#wall)"/>
     <rect x="820" y="120" width="320" height="260" rx="10" fill="#BEE3F8" stroke="#D9C7AE" stroke-width="14"/>
     <line x1="980" y1="120" x2="980" y2="380" stroke="#D9C7AE" stroke-width="10"/>
     <circle cx="890" cy="190" r="34" fill="#FDE68A"/>
     <rect y="640" width="${W}" height="320" fill="#E7D4BC"/>
     ${[
      ["#E2725B", 300, 500, 150], ["#5B8E7D", 470, 500, 150], ["#E9B44C", 380, 350, 150],
      ["#4A7BA6", 300, 200, 150], ["#C05780", 470, 200, 150], ["#8E7CC3", 640, 500, 150],
      ["#5B8E7D", 640, 350, 150], ["#E2725B", 555, 200, 150],
    ].map(([c, x, y, s]) => `<rect x="${x as number}" y="${(y as number) + 90}" width="${s as number}" height="${s as number}" rx="12" fill="${c}" stroke="#00000022"/>`).join("")}
     <path d="M 555 290 L 705 290 L 630 210 Z" fill="#E9B44C"/>`);
}

function sceneStroll() {
  const stars = Array.from({ length: 26 }, (_, i) => {
    const x = (i * 173 + 60) % (W - 80) + 40;
    const y = (i * 97 + 30) % 340 + 30;
    return `<circle cx="${x}" cy="${y}" r="${2 + (i % 3)}" fill="#FFF7D6" opacity="0.8"/>`;
  }).join("");
  return svg(grad("dusk", "#2C3E67", "#8E7CC3") +
    `<rect width="${W}" height="${H}" fill="url(#dusk)"/>${stars}
     <circle cx="1050" cy="170" r="64" fill="#F6F1D5"/><circle cx="1024" cy="152" r="56" fill="#8E7CC3" opacity="0.35"/>
     <rect y="700" width="${W}" height="260" fill="#3D4E78"/>
     <path d="M 0 700 Q 640 640 1280 700 L 1280 760 Q 640 700 0 760 Z" fill="#56648F"/>
     <rect x="220" y="430" width="14" height="300" fill="#202A4A"/>
     <circle cx="227" cy="410" r="26" fill="#FFE9A8"/>
     <circle cx="227" cy="410" r="90" fill="#FFE9A8" opacity="0.18"/>
     <ellipse cx="640" cy="820" rx="70" ry="90" fill="#141B33"/><circle cx="640" cy="700" r="42" fill="#141B33"/>
     <ellipse cx="760" cy="835" rx="56" ry="70" fill="#1B2440"/><circle cx="760" cy="740" r="34" fill="#1B2440"/>`);
}

function scenePicnic(variant: number) {
  return svg(grad("sky", "#BFE7F7", "#E8F6FC") +
    `<rect width="${W}" height="${H}" fill="url(#sky)"/>
     <circle cx="${180 + variant * 260}" cy="150" r="58" fill="#FDE68A"/>
     <ellipse cx="880" cy="140" rx="90" ry="34" fill="#FFFFFF" opacity="0.9"/>
     <ellipse cx="960" cy="165" rx="70" ry="28" fill="#FFFFFF" opacity="0.75"/>
     <path d="M 0 560 Q 320 440 640 560 T 1280 560 L 1280 ${H} L 0 ${H} Z" fill="#9BC53D"/>
     <path d="M 0 660 Q 420 560 900 680 T 1280 640 L 1280 ${H} L 0 ${H} Z" fill="#6BAA3F"/>
     <g transform="rotate(${variant * 4 - 4} 640 780)">
       <rect x="360" y="740" width="560" height="150" rx="16" fill="#E2725B"/>
       ${[0, 1, 2, 3, 4, 5].map(i => `<rect x="${380 + i * 90}" y="740" width="34" height="150" fill="#FFF6EC" opacity="0.85"/>`).join("")}
       <rect x="560" y="650" width="160" height="90" rx="10" fill="#B08968"/>
       <path d="M 560 650 Q 640 570 720 650" fill="none" stroke="#9C7B57" stroke-width="16"/>
     </g>
     <circle cx="860" cy="700" r="26" fill="#E9B44C"/><circle cx="912" cy="712" r="20" fill="#E9B44C"/>`);
}

function sceneShoes() {
  return svg(grad("floor", "#F4E5D5", "#E9D2BB") +
    `<rect width="${W}" height="${H}" fill="url(#floor)"/>
     <rect x="120" y="120" width="300" height="300" rx="12" fill="#FBF3E4" stroke="#E0C9A8" stroke-width="8"/>
     <g transform="translate(560,560)">
       <ellipse cx="-40" cy="60" rx="130" ry="60" fill="#4A7BA6"/>
       <ellipse cx="180" cy="70" rx="130" ry="60" fill="#4A7BA6"/>
       <ellipse cx="-40" cy="20" rx="120" ry="70" fill="#5B8E7D"/>
       <ellipse cx="180" cy="30" rx="120" ry="70" fill="#5B8E7D"/>
       <path d="M -120 30 Q -60 -60 20 -20" fill="none" stroke="#F6F1D5" stroke-width="10"/>
       <path d="M 70 40 Q 130 -50 240 -10" fill="none" stroke="#F6F1D5" stroke-width="10"/>
       <circle cx="-40" cy="0" r="7" fill="#F6F1D5"/><circle cx="10" cy="-14" r="7" fill="#F6F1D5"/><circle cx="60" cy="-4" r="7" fill="#F6F1D5"/>
     </g>
     <circle cx="1050" cy="220" r="46" fill="#E9B44C" opacity="0.7"/>`);
}

function sceneKindergarten() {
  return svg(grad("ksky", "#BFE7F7", "#EAF7FD") +
    `<rect width="${W}" height="${H}" fill="url(#ksky)"/>
     <rect y="620" width="${W}" height="340" fill="#9BC53D"/>
     <rect x="280" y="300" width="720" height="340" rx="16" fill="#F6E7C9" stroke="#D9C7AE" stroke-width="10"/>
     <path d="M 260 300 L 640 170 L 1020 300 Z" fill="#E2725B"/>
     <rect x="580" y="460" width="120" height="180" rx="8" fill="#5B8E7D"/>
     <circle cx="680" cy="550" r="8" fill="#F6F1D5"/>
     ${[
      ["#BEE3F8", 360, 380], ["#FDE68A", 480, 380], ["#F9C6D0", 800, 380], ["#C9E4C5", 920, 380],
    ].map(([c, x, y]) => `<rect x="${x}" y="${y}" width="86" height="86" rx="8" fill="${c}" stroke="#D9C7AE" stroke-width="6"/>`).join("")}
     <circle cx="150" cy="160" r="54" fill="#FDE68A"/>
     <ellipse cx="1020" cy="150" rx="90" ry="32" fill="#FFFFFF" opacity="0.9"/>`);
}

function sceneStory() {
  return svg(grad("swall", "#F3E2CC", "#E8D0B5") +
    `<rect width="${W}" height="${H}" fill="url(#swall)"/>
     <rect x="120" y="140" width="360" height="300" rx="10" fill="#2C3E67"/>
     <circle cx="200" cy="220" r="22" fill="#F6F1D5" opacity="0.9"/>
     ${Array.from({ length: 12 }, (_, i) => `<circle cx="${160 + i * 27}" cy="${330 + (i % 4) * 22}" r="3" fill="#F6F1D5" opacity="0.7"/>`).join("")}
     <rect y="600" width="${W}" height="360" fill="#B08968"/>
     <g transform="translate(760,540)">
       <rect x="0" y="60" width="330" height="200" rx="28" fill="#A64D45"/>
       <rect x="24" y="-60" width="282" height="150" rx="26" fill="#C0574B"/>
       <rect x="-6" y="-92" width="60" height="240" rx="26" fill="#8C3B34"/>
       <rect x="276" y="-92" width="60" height="240" rx="26" fill="#8C3B34"/>
     </g>
     <rect x="240" y="480" width="16" height="200" fill="#7A5C43"/>
     <path d="M 180 480 L 316 480 L 288 430 L 208 430 Z" fill="#E9B44C"/>
     <circle cx="248" cy="420" r="130" fill="#FFE9A8" opacity="0.22"/>`);
}

function sceneSeaside(variant: number) {
  return svg(grad("sea-sky", "#BFE7F7", "#EAF7FD") +
    `<rect width="${W}" height="${H}" fill="url(#sea-sky)"/>
     <circle cx="1090" cy="150" r="56" fill="#FDE68A"/>
     <rect y="380" width="${W}" height="260" fill="#4FA3D1"/>
     <rect y="380" width="${W}" height="80" fill="#7FC4E8" opacity="0.7"/>
     ${[0, 1, 2].map(i => `<path d="M ${120 + i * 380} 430 q 30 -18 60 0 q 30 18 60 0" fill="none" stroke="#EAF7FD" stroke-width="8" opacity="0.8"/>`).join("")}
     <rect y="620" width="${W}" height="340" fill="#F1D9A7"/>
     <g transform="translate(${200 + variant * 70},660)">
       <path d="M 0 120 L 40 30 L 130 30 L 170 120 Z" fill="#E2725B"/>
       <rect x="24" y="-10" width="120" height="14" rx="7" fill="#C05780"/>
       <rect x="60" y="-70" width="16" height="66" fill="#F6F1D5"/>
     </g>
     <g transform="translate(880,700)">
       <path d="M -90 0 L 90 0 L 60 50 L -60 50 Z" fill="#8C5E3C"/>
       <path d="M 0 -140 L 70 0 L 0 0 Z" fill="#F6F1D5"/><path d="M 0 -140 L -70 0 L 0 0 Z" fill="#E2725B"/>
       <rect x="-4" y="-140" width="8" height="140" fill="#7A5C43"/>
     </g>`);
}

function sceneBirthday(variant: number) {
  const confettiCount = variant === 0 ? 18 : 14;
  return svg(grad("bwall", "#FBEFF2", "#F6E3E9") +
    `<rect width="${W}" height="${H}" fill="url(#bwall)"/>
     <rect y="700" width="${W}" height="260" fill="#EAD9CF"/>
     <rect x="240" y="640" width="800" height="40" rx="10" fill="#C9A87C"/>
     <g transform="translate(520,360)">
       <rect x="0" y="140" width="240" height="120" rx="14" fill="#F6E7C9"/>
       <rect x="30" y="60" width="180" height="100" rx="12" fill="#F9C6D0"/>
       <rect x="60" y="0" width="120" height="80" rx="10" fill="#FBE6A2"/>
       <path d="M 0 152 Q 120 190 240 152 L 240 168 Q 120 206 0 168 Z" fill="#E2725B"/>
       ${[40, 100, 160].map((x, i) => `<rect x="${x}" y="-56" width="12" height="60" rx="4" fill="${["#4A7BA6", "#5B8E7D", "#C05780"][i]}"/>` +
         `<circle cx="${x + 6}" cy="-66" r="10" fill="#E9B44C"/>`).join("")}
     </g>
     ${[
      ["#E2725B", 300, 240], ["#5B8E7D", 980, 200], ["#4A7BA6", 1060, 420],
    ].map(([c, x, y], i) => `<ellipse cx="${x as number}" cy="${y as number}" rx="56" ry="70" fill="${c}"/>` +
      `<path d="M ${x as number} ${(y as number) + 70} q ${i % 2 ? 20 : -20} 60 0 130" fill="none" stroke="#00000030" stroke-width="5"/>`).join("")}
     ${Array.from({ length: confettiCount }, (_, i) =>
       `<rect x="${(i * 137 + 90) % 1180 + 40}" y="${(i * 211 + 80) % 520 + 60}" width="14" height="14" rx="3" fill="${["#E2725B", "#E9B44C", "#5B8E7D", "#4A7BA6"][i % 4]}" opacity="0.8" transform="rotate(${i * 33} 640 480)"/>`).join("")}`);
}

function sceneBike() {
  return svg(grad("gsky", "#C9E8F5", "#EDF8FD") +
    `<rect width="${W}" height="${H}" fill="url(#gsky)"/>
     <rect y="640" width="${W}" height="320" fill="#9BC53D"/>
     <circle cx="170" cy="180" r="52" fill="#FDE68A"/>
     <g transform="translate(1020,380)">
       <rect x="-14" y="120" width="28" height="220" fill="#8C5E3C"/>
       <ellipse cx="0" cy="70" rx="150" ry="120" fill="#6BAA3F"/>
     </g>
     <g transform="translate(480,520)">
       <circle cx="0" cy="160" r="86" fill="none" stroke="#3E4A5E" stroke-width="22"/>
       <circle cx="320" cy="160" r="86" fill="none" stroke="#3E4A5E" stroke-width="22"/>
       <path d="M 0 160 L 130 20 L 320 160 M 130 20 L 230 160 M 130 20 L 200 -20" fill="none" stroke="#E2725B" stroke-width="18" stroke-linecap="round"/>
       <path d="M 200 -20 L 250 -60 L 300 -60" fill="none" stroke="#3E4A5E" stroke-width="14" stroke-linecap="round"/>
       <circle cx="130" cy="20" r="16" fill="#3E4A5E"/>
     </g>`);
}

function sceneHundredDays() {
  const flags = ["#E2725B", "#E9B44C", "#5B8E7D", "#4A7BA6", "#C05780", "#8E7CC3"];
  return svg(grad("hbg", "#FDF6EC", "#F8ECDD") +
    `<rect width="${W}" height="${H}" fill="url(#hbg)"/>
     <path d="M 0 90 Q 640 190 1280 90" fill="none" stroke="#D9C7AE" stroke-width="8"/>
     ${flags.map((c, i) => {
       const x = 60 + i * 200;
       const y = 90 + Math.sin((i / 5) * Math.PI) * 46;
       return `<path d="M ${x} ${y} L ${x + 70} ${y + 10} L ${x + 32} ${y + 78} Z" fill="${c}"/>`;
     }).join("")}
     <circle cx="640" cy="560" r="230" fill="#F9C6D0" opacity="0.55"/>
     <circle cx="640" cy="560" r="150" fill="#FBF3E4"/>
     ${Array.from({ length: 8 }, (_, i) => {
       const a = (i / 8) * Math.PI * 2;
       return `<circle cx="${640 + Math.cos(a) * 196}" cy="${560 + Math.sin(a) * 196}" r="16" fill="${flags[i % 6]}"/>`;
     }).join("")}
     <path d="M 600 560 l 26 28 54 -60" fill="none" stroke="#5B8E7D" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>`);
}

async function renderScene(name: string, variant = 0): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  const scenes: Record<string, () => string> = {
    blocks: sceneBlocks, stroll: sceneStroll, picnic: () => scenePicnic(variant),
    shoes: sceneShoes, kindergarten: sceneKindergarten, story: sceneStory,
    seaside: () => sceneSeaside(variant), birthday: () => sceneBirthday(variant),
    bike: sceneBike, hundred: sceneHundredDays,
  };
  const jitter = 0.94 + ((variant * 37) % 12) / 100;
  return sharp(Buffer.from(scenes[name]()))
    .modulate({ brightness: jitter, saturation: 0.9 + ((variant * 53) % 20) / 100 })
    .jpeg({ quality: 82 })
    .toBuffer();
}

// ---------- 合成音频（正弦波五声音阶琶音，真实可播放 WAV） ----------
function melodyWav(seconds = 10, seed = 0): Buffer {
  const sampleRate = 16000;
  const notes = [523.25, 587.33, 659.25, 783.99, 880.0];
  const samples = sampleRate * seconds;
  const data = Buffer.alloc(samples * 2);
  const noteLen = sampleRate * 0.5;
  for (let i = 0; i < samples; i++) {
    const noteIdx = Math.floor(i / noteLen + seed) % notes.length;
    const f = notes[noteIdx];
    const t = i / sampleRate;
    const pos = (i % noteLen) / noteLen;
    const env = Math.min(1, pos * 8) * Math.min(1, (1 - pos) * 6);
    const fade = Math.min(1, t / 0.4) * Math.min(1, (seconds - t) / 0.8);
    const v = Math.sin(2 * Math.PI * f * t) * 0.55 + Math.sin(2 * Math.PI * f * 2 * t) * 0.12;
    data.writeInt16LE(Math.round(v * env * fade * 0.32 * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

// ---------- 日期工具（家庭时区 Asia/Shanghai） ----------
const pad = (n: number) => String(n).padStart(2, "0");
function localDate(daysAgo: number): string {
  const t = new Date(Date.now() + 8 * 3600e3 - daysAgo * 86400e3);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
const anchor = (date: string, hh = 10, mm = 0) => new Date(`${date}T${pad(hh)}:${pad(mm)}:00+08:00`).toISOString();

// ---------- 主流程 ----------
const { performSetup } = await import("../lib/auth/setup");
const setup = await performSetup({
  token: process.env.INITIAL_SETUP_TOKEN!,
  displayName: "妈妈",
  email: DEMO_EMAIL,
  password: DEMO_PASSWORD,
});
if (!setup.ok) throw new Error(`setup failed: ${JSON.stringify(setup)}`);

const { getDb, closeDatabase } = await import("../db");
const { user: userTable } = await import("../db/schema/auth");
const { person: personTable } = await import("../db/schema/family");
const { completeOnboarding, addPerson, getUserBinding } = await import("../lib/family/service");
const { ingestImage, ingestMedia } = await import("../lib/assets/ingest");
const { saveDraft, publishDraft } = await import("../lib/drafts/service");
const { emptyDraftContent } = await import("../mobile/src/drafts/model");
const { updateMemoryEvent, getTimelinePage } = await import("../lib/memories/service");
const { createCapsule, sealCapsule } = await import("../lib/capsules/service");
const { addFutureQuestion } = await import("../lib/capsules/dialogue");

const db = getDb();
const adminId = (await db.select({ id: userTable.id }).from(userTable))[0].id;

const onboarding = await completeOnboarding(adminId, {
  familyName: "小满家",
  timezone: "Asia/Shanghai",
  childDisplayName: "小满",
  childBirthDate: "2023-04-12",
  selfDisplayName: "妈妈",
  selfRelationToChild: "妈妈",
  selfIsGuardian: true,
});
if (!onboarding.ok) throw new Error(`onboarding failed: ${JSON.stringify(onboarding)}`);
const familyId = onboarding.familyId;

const dad = await addPerson(familyId, { displayName: "爸爸", relationToChild: "爸爸", isChild: false });
const grandma = await addPerson(familyId, { displayName: "外婆", relationToChild: "外婆", isChild: false });
if (!dad.ok || !grandma.ok) throw new Error("addPerson failed");
const people = db.select().from(personTable).all();
const child = people.find(p => p.isChild);
const grandmaId = grandma.personId;
if (!child) throw new Error("child person missing");

const binding = await getUserBinding(adminId);
const context = {
  userId: adminId,
  userName: "妈妈",
  familyId,
  personId: binding.personId,
  role: binding.role,
  accountEnabled: true,
  isGuardian: true,
  familyTimezone: "Asia/Shanghai",
  childLaterUnlockAge: binding.childLaterUnlockAge,
} as import("../lib/family/context").FamilyContext;

let assetSalt = 0;
async function photo(scene: string, variant: number, filename: string, visibility: "family" | "private" = "family") {
  const buffer = await renderScene(scene, variant);
  const stored = await ingestImage({
    familyId, createdByUserId: adminId,
    filename: `${filename}.jpg`, declaredMime: "image/jpeg",
    buffer: Buffer.concat([buffer, Buffer.from([++assetSalt])]),
    clientLastModifiedMs: null, visibility,
  });
  if (stored.status !== "stored") throw new Error(`photo ingest failed: ${stored.status}`);
  return stored.asset.id;
}
async function audio(filename: string, seed: number) {
  const stored = await ingestMedia({
    familyId, createdByUserId: adminId, kind: "audio",
    filename: `${filename}.wav`, declaredMime: "audio/wav",
    buffer: melodyWav(10, seed), clientLastModifiedMs: null, visibility: "family",
  });
  if (stored.status !== "stored") throw new Error(`audio ingest failed: ${stored.status}`);
  return stored.asset.id;
}

let eventSalt = 0;
type EventSpec = {
  title: string; text: string;
  occurredAt: string | null;
  occurredAtPrecision: "exact" | "approximate" | "date_only" | "month" | "year" | "unknown";
  locationText?: string;
  participants?: string[];
  photos?: Array<[scene: string, caption?: string]>;
  audioItem?: [id: string, caption: string];
  visibility?: "family" | "private";
  childAnchor?: boolean;
  milestone?: "first_time" | "growth" | "family" | "learning" | "celebration" | "other";
  pinned?: boolean;
};
async function publishEvent(spec: EventSpec): Promise<string> {
  const items: Array<{ id: string; assetId: string; localCaptureRef: null; caption: string }> = [];
  for (const [scene, caption] of spec.photos ?? []) {
    const assetId = await photo(scene, items.length, `demo-${++eventSalt}-${scene}`);
    items.push({ id: `item-${++eventSalt}`, assetId, localCaptureRef: null, caption: caption ?? "" });
  }
  if (spec.audioItem) {
    const assetId = await audio(spec.audioItem[0], eventSalt);
    items.push({ id: `item-${++eventSalt}`, assetId, localCaptureRef: null, caption: spec.audioItem[1] });
  }
  const draftId = `demo-draft-${++eventSalt}`;
  const content = {
    ...emptyDraftContent(),
    title: spec.title,
    text: spec.text,
    occurredAt: spec.occurredAt,
    occurredAtPrecision: spec.occurredAtPrecision,
    locationText: spec.locationText ?? "",
    participantIds: spec.participants ?? [],
    visibility: spec.visibility ?? "family",
    readerUserIds: [],
    coverItemId: items[0]?.id ?? null,
    items,
  };
  saveDraft(context, draftId, 0, `demo-mut-${draftId}`, content);
  const published = publishDraft(context, draftId, 1);
  if (!published.memoryEventId) throw new Error(`publish failed: ${spec.title}`);
  const patch: Record<string, unknown> = {};
  if (spec.childAnchor && child) patch.childPersonId = child.id;
  if (spec.milestone) patch.milestoneType = spec.milestone;
  if (spec.pinned !== undefined) patch.isPinned = spec.pinned;
  if (Object.keys(patch).length) {
    const result = await updateMemoryEvent(familyId, published.memoryEventId, adminId, patch);
    if (!result.ok) throw new Error(`milestone/anchor patch failed: ${JSON.stringify(result)}`);
  }
  return published.memoryEventId;
}

const events: Array<EventSpec> = [
  {
    title: "客厅的积木城堡", text: "小满搭了一下午积木，最后在城堡顶上插了一面自己剪的小旗子，宣布这是「给外婆住的城堡」。",
    occurredAt: anchor(localDate(0), 16, 40), occurredAtPrecision: "exact",
    participants: [child!.id],
    photos: [["blocks", "搭了一下午的成果"], ["blocks", "城堡全景"], ["blocks", "顶上的小旗子"]],
  },
  {
    title: "晚饭后的散步", text: "天气凉快了，一家人沿着河边走了两圈，小满一路数路灯。",
    occurredAt: anchor(localDate(1), 19, 20), occurredAtPrecision: "exact",
    participants: [child!.id], photos: [["stroll", "河边的傍晚"]],
  },
  {
    title: "公园野餐日", text: "带上了外婆准备的三明治和青团。外婆哼起了小满最喜欢的童谣，小满跟着拍手。",
    occurredAt: anchor(localDate(5), 11, 30), occurredAtPrecision: "date_only",
    locationText: "滨江森林公园", participants: [child!.id, grandmaId],
    photos: [["picnic", "铺好野餐垫"], ["picnic", "外婆准备的食物"], ["picnic", "树荫下"], ["picnic", "收拾前的合影视角"]],
    audioItem: ["grandma-lullaby", "外婆哼的童谣"],
  },
  {
    title: "第一次自己穿好鞋子", text: "蹲在门口折腾了五分钟，左右穿反了一次，换回来之后自己拉好了粘扣。没人帮忙。",
    occurredAt: anchor(localDate(12), 8, 50), occurredAtPrecision: "approximate",
    participants: [child!.id], photos: [["shoes", "自己穿好的鞋"], ["shoes", "拉粘扣的样子"]],
    childAnchor: true, milestone: "first_time", pinned: true,
  },
  {
    title: "幼儿园开学第一周", text: "第一天在门口抱了三分钟才松手；第三天开始，是小朋友跟妈妈说「你回去吧」。",
    occurredAt: anchor(localDate(30), 8, 30), occurredAtPrecision: "date_only",
    participants: [child!.id], photos: [["kindergarten", "开学第一天"], ["kindergarten", "教室窗户"]],
    milestone: "growth",
  },
  {
    title: "这个月，小满开始爱问「为什么」", text: "从「为什么天会黑」到「为什么外婆的头发是白的」，一天大概要问三十个为什么。",
    occurredAt: anchor(localDate(40).slice(0, 8) + "01", 9, 0), occurredAtPrecision: "month",
    participants: [child!.id],
  },
  {
    title: "外婆讲她小时候的事", text: "外婆说她们那时候夏天在河边乘凉，一人一把蒲扇，谁先睡着谁第二天要帮忙烧火。小满听得不肯睡觉。",
    occurredAt: anchor(localDate(55), 20, 15), occurredAtPrecision: "exact",
    participants: [grandmaId],
    audioItem: ["grandma-story", "外婆的原声（节选）"],
  },
  {
    title: "全家去青岛看海", text: "小满第一次看到海，站在浪边上又怕又舍不得走，最后裤腿全湿了。",
    occurredAt: anchor(localDate(95), 14, 5), occurredAtPrecision: "date_only",
    locationText: "青岛", participants: [child!.id],
    photos: [["seaside", "第一眼看到海"], ["seaside", "沙滩上的小桶"], ["seaside", "远处的帆船"], ["seaside", "浪来了"], ["seaside", "湿透的裤腿"]],
  },
  {
    title: "小满的三岁生日", text: "自己挑的草莓蛋糕，吹蜡烛的时候许愿说「希望外婆每天都来我家吃饭」。",
    occurredAt: anchor("2026-04-12", 18, 30), occurredAtPrecision: "exact",
    participants: [child!.id, grandmaId],
    photos: [["birthday", "许愿中"], ["birthday", "吹蜡烛"], ["birthday", "切开第一块"], ["birthday", "气球墙前"]],
    childAnchor: true, milestone: "celebration", pinned: true,
  },
  {
    title: "两岁生日的小蛋糕", text: "那年只要了一个小蛋糕，小满把奶油先抹在了爸爸脸上。",
    occurredAt: anchor("2025-04-12", 19, 0), occurredAtPrecision: "date_only",
    participants: [child!.id], photos: [["birthday", "两岁的小蛋糕"], ["birthday", "奶油现场"]],
  },
  {
    title: "第一次骑平衡车", text: "在小区里练了一个下午，摔了两次，最后一次滑出去十几米都不用扶。",
    occurredAt: anchor("2025-09-20", 16, 30), occurredAtPrecision: "approximate",
    participants: [child!.id], photos: [["bike", "出发"], ["bike", "滑行中"]],
    milestone: "first_time",
  },
  {
    title: "2024 年的夏天，开始说整句的话", text: "从蹦单词到完整的句子好像就是那个夏天突然发生的，第一句完整的话是「妈妈我想吃西瓜」。",
    occurredAt: anchor("2024-07-01", 9, 0), occurredAtPrecision: "year",
    participants: [child!.id],
  },
  {
    title: "不知道哪一天，第一次清楚喊出「外婆」", text: "全家都没反应过来是在叫谁，外婆愣了几秒，然后眼眶就红了。具体哪一天记不清了，但那天晚饭外婆多做了两个菜。",
    occurredAt: null, occurredAtPrecision: "unknown",
    participants: [grandmaId], milestone: "first_time",
  },
  {
    title: "小满的百天", text: "照相馆的阿姨说小满是那天最配合的宝宝。旗子是外婆一针一针缝的。",
    occurredAt: anchor("2023-07-20", 10, 30), occurredAtPrecision: "exact",
    participants: [child!.id], photos: [["hundred", "百天照"], ["hundred", "外婆缝的旗子"]],
    childAnchor: true,
  },
  {
    title: "妈妈记下的悄悄话（仅自己可见）", text: "今天小满在饭桌上说「妈妈你上班的时候我会想你，但是我不说，说了你该难受了」。这句话只留给自己看。",
    occurredAt: null, occurredAtPrecision: "unknown",
    visibility: "private",
  },
];

let published = 0;
for (const spec of events) {
  await publishEvent(spec);
  published++;
}

// 时间胶囊：封存到小满 18 岁，留一个未来问题。
const capsule = await createCapsule(familyId, { title: "写给十八岁的小满", unlockType: "age", unlockValue: "18" });
if (capsule.ok) {
  await addFutureQuestion(context, capsule.capsuleId, "十八岁的你，现在最喜欢做的事是什么？");
  await sealCapsule(familyId, capsule.capsuleId);
}

// ---------- 自检 ----------
const page = await getTimelinePage(context, { limit: 50 });
const { searchFamily } = await import("../lib/search/service");
const search = searchFamily(context, { q: "生日" });
const assets = db.select().from((await import("../db/schema/asset")).asset).all();

writeFileSync(envFile, JSON.stringify({
  authSecret: AUTH_SECRET, email: DEMO_EMAIL, password: DEMO_PASSWORD,
  familyName: "小满家", seededAt: new Date().toISOString(),
}, null, 2));

console.log("演示数据生成完成");
console.log(`  数据目录：${dataDir}`);
console.log(`  登录账号：${DEMO_EMAIL}`);
console.log(`  登录密码：${DEMO_PASSWORD}`);
console.log(`  记忆事件：${published} 条（时间轴可见 ${page.entries.length} 条，含私密 1 条）`);
console.log(`  原件：${assets.length} 份（合成插画照片 + WAV 音频）`);
console.log(`  搜索自检：「生日」命中 ${search.events.length} 条`);
console.log("  下一步：npm run demo 启动服务端，浏览器打开 http://localhost:3000/login");
closeDatabase();
