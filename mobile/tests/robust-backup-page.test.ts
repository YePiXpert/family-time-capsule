import { beforeEach, expect, it, vi } from "vitest";
import { Restore } from "../src/local/BackupPages";

// 「数据与备份」「恢复备份」两页：钩子按槽位保存，重绘后找到真实控件触发回调；
// 备份引擎、分卷导出、互斥全换成可观察的假件，只验证页面怎样调用它们。
const env = vi.hoisted(() => {
  class BackupStopped extends Error {
    constructor() {
      super("已停止。");
    }
  }
  // 磁盘上有哪些文件：导出卷、选择器副本都按 uri 记在这里。
  const disk = new Set<string>();
  class File {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    get name() {
      return this.uri.split("/").pop()!;
    }
    get exists() {
      return disk.has(this.uri);
    }
    delete() {
      if (!disk.delete(this.uri)) throw new Error(`没有 ${this.uri}`);
    }
  }
  return {
    BackupStopped, File, disk,
    slots: [] as unknown[], cursor: 0,
    alerts: [] as [string, string, { text: string; onPress?: () => void }[]][],
    running: false, joined: false, localBusy: false,
    log: [] as string[],
  };
});
vi.mock("react", () => ({
  useState: (initial: unknown) => {
    const index = env.cursor++;
    if (!(index in env.slots))
      env.slots[index] = typeof initial === "function" ? initial() : initial;
    return [env.slots[index], (next: unknown) => {
      env.slots[index] = typeof next === "function" ? next(env.slots[index]) : next;
    }];
  },
  useRef: (initial: unknown) => ({ current: initial }),
  useEffect: vi.fn(),
  useCallback: (fn: unknown) => fn,
}));
vi.mock("react-native", () => ({
  View: "View", Pressable: "Pressable", Switch: "Switch", StyleSheet: { hairlineWidth: 1 },
  Alert: { alert: (...args: never) => env.alerts.push(args) },
}));
vi.mock("@react-navigation/native", () => ({ useFocusEffect: vi.fn() }));
vi.mock("expo-image-picker", () => ({}));
vi.mock("expo-local-authentication", () => ({}));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: vi.fn() }));
vi.mock("expo-file-system", () => ({ File: env.File }));
vi.mock("../src/local/context", () => ({
  useLibrary: () => ({ media: {} }),
  useStore: () => ({ get: () => ({}), change: vi.fn() }),
  useSyncStatus: () => ({ running: env.running, joined: env.joined }),
}));
vi.mock("../src/local/navigation", () => ({ useNav: () => ({ navigate: vi.fn() }) }));
vi.mock("../src/family/session", () => ({ getToken: vi.fn() }));
vi.mock("../src/local/files", () => ({ preserveMedia: vi.fn() }));
vi.mock("../src/local/backup", () => ({
  BackupStopped: env.BackupStopped,
  collectBlobs: vi.fn(),
  createBackup: vi.fn(),
  daysSinceExport: () => null,
  discardPickedCopies: vi.fn(),
  inspectBackup: vi.fn(),
  listLocalBackups: () => [],
  restoreBackup: vi.fn(),
  shareBackup: vi.fn(),
}));
vi.mock("../src/local/backup-export", () => ({
  planExport: vi.fn(),
  purgeExports: vi.fn(),
  writeVolume: vi.fn(),
}));
vi.mock("../src/local/services", () => ({ collectUnusedMedia: vi.fn() }));
vi.mock("../src/local/archive", () => ({ ArchiveStopped: class extends Error {}, createArchive: vi.fn(), shareArchive: vi.fn() }));
vi.mock("../src/local/health-file", () => ({ healthFile: vi.fn() }));
vi.mock("../src/sync/status", () => ({
  isSyncRunning: () => env.running,
  isLocalBusy: () => env.localBusy,
  markLocalBusy: (value: boolean) => { env.localBusy = value; },
}));
vi.mock("../src/sync/conflicts", () => ({ conflictMediaIds: () => new Set<string>() }));
vi.mock("../src/sync/state", () => ({
  forgetMergeHistory: vi.fn(async () => {}),
  readConflicts: async () => [],
  subscribeSyncFiles: () => () => {},
}));
vi.mock("../src/local/health", () => ({ changeAvgMs: () => 0 }));
vi.mock("../src/components/JournalIcon", () => ({ JournalIcon: "JournalIcon" }));
vi.mock("../src/local/model", () => ({
  BY_PRESETS: [], referencedMedia: vi.fn(), sealInitial: vi.fn(), stampUnsigned: vi.fn(), unsignedRecords: vi.fn(), yearKey: vi.fn(),
}));
vi.mock("../src/local/ui", () => ({
  Button: "Button", Card: "Card", ErrorText: "ErrorText", Field: "Field", Ornament: "Ornament", Page: "Page",
  SectionHeader: "SectionHeader", SettingsGroup: "SettingsGroup", SettingsRow: "SettingsRow",
  SignatureButton: "SignatureButton", Stamp: "Stamp", Text: "Text",
  dateLabel: String, messageOf: (e: Error) => e.message, serif: {}, useStyles: () => ({}), useTheme: () => ({ colors: {} }),
}));
vi.mock("../src/local/Media", () => ({ Photo: "Photo" }));

const DocumentPicker = await import("expo-document-picker");
const backup = await import("../src/local/backup");
const exporter = await import("../src/local/backup-export");
const picker = vi.mocked(DocumentPicker.getDocumentAsync);
const inspect = vi.mocked(backup.inspectBackup);
const restoreBackup = vi.mocked(backup.restoreBackup);
const purge = vi.mocked(exporter.purgeExports);

// useBackupActions 的槽位：busy、message、error、stopper、backups（「数据与备份」再加一个 unconfirmed）。
type Props = { testID?: string; title?: string; children?: unknown; onPress?: () => void };
type Element = { type?: unknown; props?: Props };
function nodes(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object") return [];
  const element = node as Element;
  return [element, ...nodes(element.props?.children)];
}
let page: () => unknown = Restore;
function render() {
  env.cursor = 0;
  return page();
}
const control = (match: (p: Props) => boolean) => nodes(render()).find((el) => el.props && match(el.props))?.props;
const byId = (id: string) => control((p) => p.testID === id);
// 选择器把备份复制进缓存；两卷一起选中。
const PICKED = ["cache/DocumentPicker/A1/安安-备份-1.xmb", "cache/DocumentPicker/B2/安安-备份-2.xmb"];
const inside = { records: { r: {} }, albums: {}, media: {} };


beforeEach(() => {
  vi.clearAllMocks();
  env.slots = []; env.cursor = 0; env.alerts = []; env.log = []; env.disk.clear();
  env.running = false; env.joined = false; env.localBusy = false;
  page = Restore;
  for (const uri of PICKED) env.disk.add(uri);
  picker.mockResolvedValue({ canceled: false, assets: PICKED.map((uri) => ({ uri })) } as never);
  inspect.mockResolvedValue(inside as never);
  restoreBackup.mockResolvedValue(new env.File("backups/恢复前.xmb") as never);
});


it("releases the shared local mutex when clearing last export's cache fails before the operation starts", async () => {
  // e.g. the share target still holds the last exported volume, or cache/export is not deletable.
  purge.mockImplementationOnce(() => {
    throw new Error("EACCES: cannot delete cache/export");
  });
  const pressed = (async () => byId("backup-restore")!.onPress!())();
  await pressed.catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 0));
  // perform() sets markLocalBusy(true) and then calls purgeExports() *outside* its try/finally:
  // the flag is never cleared, so every later backup/restore/archive/conflict action says
  // 「上一个操作还没结束」 and auto-sync (isBusy) silently never runs again until the app restarts.
  expect(env.localBusy).toBe(false);
});
