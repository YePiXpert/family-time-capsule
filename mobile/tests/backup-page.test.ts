import { beforeEach, expect, it, vi } from "vitest";
import { Backup, Restore } from "../src/local/BackupPages";

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
    // 本机库：恢复换库就是换掉 lib 这个对象。
    lib: {} as object,
    // 同步状态文件：合并之基与已读清单。
    remote: null as { seen: Record<string, string> } | null,
    base: { version: 1, merged: {}, known: {} } as unknown,
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
  useStore: () => ({ get: () => env.lib, change: vi.fn() }),
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
  forgetMergeHistory: vi.fn(async () => {
    env.base = { version: 1, merged: {}, known: {} };
    if (env.remote) env.remote = { ...env.remote, seen: {} };
  }),
  readBase: vi.fn(async () => env.base),
  writeBase: vi.fn((base: unknown) => { env.base = base; }),
  readRemoteState: vi.fn(async () => env.remote),
  writeRemoteState: vi.fn((state: { seen: Record<string, string> }) => { env.remote = state; }),
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
const syncState = await import("../src/sync/state");
const picker = vi.mocked(DocumentPicker.getDocumentAsync);
const inspect = vi.mocked(backup.inspectBackup);
const restoreBackup = vi.mocked(backup.restoreBackup);
const discard = vi.mocked(backup.discardPickedCopies);
const purge = vi.mocked(exporter.purgeExports);

// useBackupActions 的槽位：busy、message、error、stopper、backups（「数据与备份」再加一个 unconfirmed）。
const BUSY = 0, MESSAGE = 1, ERROR = 2;
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
const alertButton = (text: string) => env.alerts.at(-1)![2].find((b) => b.text === text)!;
const settled = () => vi.waitFor(() => expect(env.slots[BUSY] || env.localBusy).toBe(false));
// 选择器把备份复制进缓存；两卷一起选中。
const PICKED = ["cache/DocumentPicker/A1/安安-备份-1.xmb", "cache/DocumentPicker/B2/安安-备份-2.xmb"];
const pickedUris = (call: unknown[] | undefined) => (call?.[0] as { uri: string }[] | undefined)?.map((f) => f.uri);
const inside = { records: { r: {} }, albums: {}, media: {} };
/** 在停止信号上挂起：停了就抛 BackupStopped，没给信号就一直等（停不下来）。 */
const hangUntilStopped = (signal?: AbortSignal) =>
  new Promise<never>((_, reject) =>
    signal?.addEventListener("abort", () => reject(new env.BackupStopped())),
  );

/** 「从文件恢复」→ 选中两卷 → 检查完弹出确认框，第一次操作已结束。 */
async function pickFromFiles() {
  byId("backup-restore")!.onPress!();
  await vi.waitFor(() => expect(env.alerts).toHaveLength(1));
  await settled();
}
async function confirmRestore() {
  alertButton("恢复并替换").onPress!();
  await vi.waitFor(() => expect(restoreBackup).toHaveBeenCalled());
  await settled();
}

beforeEach(() => {
  vi.clearAllMocks();
  env.slots = []; env.cursor = 0; env.alerts = []; env.log = []; env.disk.clear();
  env.running = false; env.joined = false; env.localBusy = false;
  env.lib = {}; env.remote = null; env.base = { version: 1, merged: {}, known: {} };
  page = Restore;
  for (const uri of PICKED) env.disk.add(uri);
  picker.mockResolvedValue({ canceled: false, assets: PICKED.map((uri) => ({ uri })) } as never);
  inspect.mockResolvedValue(inside as never);
  restoreBackup.mockResolvedValue({ prior: new env.File("backups/恢复前.xmb"), skipped: 0 } as never);
});

// #10 恢复与恢复前检查不能停止
it("#10 恢复前检查可以停止：停止信号传给 inspectBackup，页上报「已停止」且不弹确认框", async () => {
  inspect.mockImplementationOnce((_files, _extract, signal) => hangUntilStopped(signal));
  byId("backup-restore")!.onPress!();
  await vi.waitFor(() => expect(inspect).toHaveBeenCalledOnce());
  const signal = inspect.mock.calls[0]![2];
  expect(signal).toBeInstanceOf(AbortSignal);
  const stop = byId("backup-stop");
  expect(stop).toBeDefined();
  stop!.onPress!();
  expect(signal!.aborted).toBe(true);
  await settled();
  expect(env.slots[MESSAGE]).toBe("已停止。");
  expect(env.slots[ERROR]).toBe("");
  expect(env.alerts).toEqual([]);
  expect(pickedUris(discard.mock.calls[0])).toEqual(PICKED);
});
it("#10 恢复本身可以停止：停止信号传给 restoreBackup，页上报「已停止」而不是恢复完成", async () => {
  await pickFromFiles();
  restoreBackup.mockImplementationOnce((_store, _files, _progress, signal) => hangUntilStopped(signal));
  alertButton("恢复并替换").onPress!();
  await vi.waitFor(() => expect(restoreBackup).toHaveBeenCalledOnce());
  const signal = restoreBackup.mock.calls[0]![3];
  expect(signal).toBeInstanceOf(AbortSignal);
  const stop = byId("backup-stop");
  expect(stop).toBeDefined();
  stop!.onPress!();
  expect(signal!.aborted).toBe(true);
  await settled();
  expect(env.slots[MESSAGE]).toBe("已停止。");
  expect(env.slots[ERROR]).toBe("");
  expect(syncState.writeBase).not.toHaveBeenCalled();
});

// #11 选择器复制进缓存的备份从不删除（页面这一半；函数本身见 backup-picked.test.ts）
it("#11 恢复成功后删掉选择器副本", async () => {
  await pickFromFiles();
  expect(discard).not.toHaveBeenCalled();
  await confirmRestore();
  expect(restoreBackup).toHaveBeenCalledOnce();
  expect(pickedUris(discard.mock.calls[0])).toEqual(PICKED);
  expect(env.slots[MESSAGE]).toBe("恢复完成。恢复前的内容也留了一份在下面。");
});
it("恢复前就找不到原件的照片没放进「恢复前」那份：结果行说明有几个", async () => {
  restoreBackup.mockResolvedValueOnce({ prior: new env.File("backups/恢复前.xmb"), skipped: 2 } as never);
  await pickFromFiles();
  await confirmRestore();
  expect(env.slots[MESSAGE]).toBe(
    "恢复完成。恢复前的内容也留了一份在下面。有 2 个照片或录音在恢复前就已找不到原件，「恢复前」那份备份里没有它们。",
  );
});
it("#11 确认框点取消也删掉选择器副本，不恢复", async () => {
  await pickFromFiles();
  alertButton("取消").onPress?.();
  expect(pickedUris(discard.mock.calls[0])).toEqual(PICKED);
  expect(restoreBackup).not.toHaveBeenCalled();
});
it("#11 恢复失败也删掉选择器副本，错误照常显示", async () => {
  await pickFromFiles();
  restoreBackup.mockRejectedValueOnce(new Error("空间不够"));
  await confirmRestore();
  expect(pickedUris(discard.mock.calls[0])).toEqual(PICKED);
  expect(env.slots[ERROR]).toBe("空间不够");
  expect(syncState.writeBase).not.toHaveBeenCalled();
});

// 恢复换库之后才忘合并历史：中间被杀掉就留着旧基与已读清单，备份之后家人的记录一直并不回来
const HISTORY = { version: 1, merged: { records: { r: "fp" } }, known: {} };
it("一起写的手机恢复：换库之前先忘掉合并历史，恢复成功后不再放回", async () => {
  env.remote = { seen: { d2: "sha-d2" } };
  env.base = HISTORY;
  restoreBackup.mockImplementationOnce(async () => {
    // 换库这一刻合并历史已经忘掉了。
    expect({ seen: env.remote?.seen, base: env.base }).toEqual({ seen: {}, base: { version: 1, merged: {}, known: {} } });
    env.lib = { restored: true };
    return new env.File("backups/恢复前.xmb") as never;
  });
  await pickFromFiles();
  await confirmRestore();
  expect(env.slots[ERROR]).toBe("");
  expect(vi.mocked(syncState.forgetMergeHistory).mock.invocationCallOrder[0]!).toBeLessThan(restoreBackup.mock.invocationCallOrder[0]!);
  expect({ seen: env.remote?.seen, base: env.base }).toEqual({ seen: {}, base: { version: 1, merged: {}, known: {} } });
  expect(env.slots[MESSAGE]).toBe("恢复完成。恢复前的内容也留了一份在下面。");
});
it("一起写的手机恢复失败、库没换：合并之基与已读清单原样放回", async () => {
  env.remote = { seen: { d2: "sha-d2" } };
  env.base = HISTORY;
  await pickFromFiles();
  restoreBackup.mockRejectedValueOnce(new Error("空间不够"));
  await confirmRestore();
  expect(env.slots[ERROR]).toBe("空间不够");
  expect(syncState.forgetMergeHistory).toHaveBeenCalledOnce();
  expect({ seen: env.remote?.seen, base: env.base }).toEqual({ seen: { d2: "sha-d2" }, base: HISTORY });
});
it("一起写的手机恢复途中本机又写过、最后没换成：合并历史照样放回", async () => {
  env.remote = { seen: { d2: "sha-d2" } };
  env.base = HISTORY;
  await pickFromFiles();
  restoreBackup.mockImplementationOnce(async () => {
    // 分享进来一张照片、编辑页落了盘：库变了，但恢复报错就是没换成（换库是最后一步）。
    env.lib = { ...(env.lib as object), shared: true };
    throw new Error("恢复期间本机一直在写入新内容，已停下，现在的内容没有被替换；请稍后再恢复一次。");
  });
  await confirmRestore();
  expect({ seen: env.remote?.seen, base: env.base }).toEqual({ seen: { d2: "sha-d2" }, base: HISTORY });
});

// #19 已加入家庭时恢复旧备份的确认框没说下次同步会并回之后的改动
const JOINED_NOTE = "这台手机已加入家庭：下次同步时，备份之后家里（包括这台手机）同步过的改动会并回来。";
it("#19 已加入家庭：确认框说明下次同步会把备份之后的改动并回来", async () => {
  env.joined = true;
  await pickFromFiles();
  expect(env.alerts[0]![1]).toContain("1 段时光");
  expect(env.alerts[0]![1]).toContain(JOINED_NOTE);
});
it("#19 没加入家庭：确认框不提同步", async () => {
  await pickFromFiles();
  expect(env.alerts[0]![1]).toContain("1 段时光");
  expect(env.alerts[0]![1]).not.toContain("同步");
});

// #22 导出最后一卷留在缓存直到下次导出
it("#22 本机操作一开始先清掉上次导出留下的卷，再选文件、再恢复", async () => {
  await pickFromFiles();
  expect(purge).toHaveBeenCalledOnce();
  expect(purge.mock.invocationCallOrder[0]!).toBeLessThan(picker.mock.invocationCallOrder[0]!);
  await confirmRestore();
  expect(purge).toHaveBeenCalledTimes(2);
  expect(purge.mock.invocationCallOrder[1]!).toBeLessThan(restoreBackup.mock.invocationCallOrder[0]!);
});

// #23 「恢复并替换」时同步刚开始、没执行，选择器副本不删
it("#23 确认时同步刚开始：不恢复，选择器副本照样删", async () => {
  await pickFromFiles();
  env.running = true;
  alertButton("恢复并替换").onPress!();
  await vi.waitFor(() => expect(discard).toHaveBeenCalled());
  expect(pickedUris(discard.mock.calls[0])).toEqual(PICKED);
  expect(restoreBackup).not.toHaveBeenCalled();
  expect(env.slots[MESSAGE]).toBe("正在与家人同步，等它完成再试。");
});
it("#23 确认时别的本机操作占着：不恢复，选择器副本照样删", async () => {
  await pickFromFiles();
  env.localBusy = true;
  alertButton("恢复并替换").onPress!();
  await vi.waitFor(() => expect(discard).toHaveBeenCalled());
  expect(pickedUris(discard.mock.calls[0])).toEqual(PICKED);
  expect(restoreBackup).not.toHaveBeenCalled();
  expect(env.slots[MESSAGE]).toBe("上一个操作还没结束，等它完成再试。");
});

// #12 安卓分享面板一关就删卷
/** 「保存完整备份」分三卷；每写一卷、每打开一次分享面板，都记下这时磁盘上还有哪几卷。 */
function exportThreeVolumes(failShareAt?: number) {
  page = Backup;
  const volumes = () => [...env.disk].filter((uri) => uri.startsWith("cache/export/")).map((uri) => uri.split("/").pop()).join(",");
  vi.mocked(backup.createBackup).mockResolvedValue(new env.File("backups/manifest.json") as never);
  vi.mocked(exporter.planExport).mockReturnValue({ volumes: [{}, {}, {}] } as never);
  purge.mockImplementation(() => {
    for (const uri of [...env.disk]) if (uri.startsWith("cache/export/")) env.disk.delete(uri);
  });
  vi.mocked(exporter.writeVolume).mockImplementation(async (_plan, index) => {
    env.log.push(`写第 ${index + 1} 卷前：${volumes()}`);
    const volume = new env.File(`cache/export/卷${index + 1}.xmb`);
    env.disk.add(volume.uri);
    return volume as never;
  });
  vi.mocked(backup.shareBackup).mockImplementation(async (file) => {
    env.log.push(`分享 ${file.name} 时：${volumes()}`);
    if (failShareAt !== undefined && file.name === `卷${failShareAt}.xmb`) throw new Error("分享失败");
  });
  byId("backup-export")!.onPress!();
  return { volumes };
}
it("#12 分享面板关上后这一卷还留着，下一卷写好才删上一卷，最后一卷留在缓存", async () => {
  const { volumes } = exportThreeVolumes();
  await vi.waitFor(() => expect(backup.shareBackup).toHaveBeenCalledTimes(3));
  await settled();
  expect(env.log).toEqual([
    "写第 1 卷前：",
    "分享 卷1.xmb 时：卷1.xmb",
    "写第 2 卷前：卷1.xmb",
    "分享 卷2.xmb 时：卷2.xmb",
    "写第 3 卷前：卷2.xmb",
    "分享 卷3.xmb 时：卷3.xmb",
  ]);
  expect(volumes()).toBe("卷3.xmb");
  expect(env.slots[ERROR]).toBe("");
  expect(byId("backup-confirm-saved")).toBeDefined();
});
it("#12 分享途中出错：导出的卷全部清掉，不算保存过", async () => {
  const { volumes } = exportThreeVolumes(2);
  await vi.waitFor(() => expect(env.slots[ERROR]).toBe("分享失败"));
  await settled();
  expect(env.log.at(-1)).toBe("分享 卷2.xmb 时：卷2.xmb");
  expect(volumes()).toBe("");
  expect(byId("backup-confirm-saved")).toBeUndefined();
});
