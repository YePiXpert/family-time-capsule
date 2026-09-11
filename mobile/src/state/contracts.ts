import type { ThemeMode } from "../theme";
import type { Credentials, Family, LocalTimelineEvent, MobileHome, OnboardingInput, OutboxItem, Person, SyncConsent, Viewer } from "../types";

export type AppContextValue = {
  credentials: Credentials | null;
  family: Family | null;
  viewer: Viewer | null;
  people: Person[];
  events: LocalTimelineEvent[];
  outbox: OutboxItem[];
  home: MobileHome | null;
  lastSyncAt: string | null;
  online: boolean | null;
  syncing: boolean;
  message: string | null;
  /** 首次欢迎页是否已处理：null 表示还在读取本机状态。 */
  welcomeSeen: boolean | null;
  localReadError: string | null;
  /** 设备级显示偏好（标准/大字简洁）；null 表示还在读取。切换账号不改变它。 */
  displayMode: "standard" | "simple" | null;
  setDisplayMode: (mode: "standard" | "simple") => Promise<void>;
  /** 设备级外观偏好（跟随系统/浅色/深色）；null 表示还在读取。 */
  themeMode: ThemeMode | null;
  setThemeMode: (mode: ThemeMode) => Promise<void>;
  /** 设备级触觉反馈开关（设置页「触觉反馈」），持久化在本机 meta。 */
  hapticsEnabled: boolean;
  setHapticsEnabled: (value: boolean) => Promise<void>;
  /** 账号已建立但尚未建立/绑定家庭：登录不算失败，应继续初始化。 */
  needsOnboarding: boolean;
  /** 当前目的地的同步授权；null 表示尚未授权（有待传记录时会弹出授权门）。 */
  syncConsent: SyncConsent | null;
  awaitingSyncConsent: boolean;
  userId: string | null;
  reloadLocal: () => Promise<void>;
  runSync: () => Promise<void>;
  queued: () => Promise<void>;
  connect: (credentials: Credentials) => Promise<void>;
  disconnect: () => Promise<void>;
  setWelcomeSeen: () => Promise<void>;
  completeOnboarding: (input: OnboardingInput) => Promise<void>;
  /** 授权上传目的地：scope all/selected/local（M4）。 */
  grantSyncConsent: (
    scope: SyncConsent["scope"],
    ids?: string[],
  ) => Promise<void>;
  /** 仅保留在本机：移除待传项，保留记录与原件。 */
  keepOutboxItemLocal: (itemId: string) => Promise<void>;
  /** 彻底删除一条本机记录（含原件），调用方必须先取得明确确认。 */
  deleteOutboxCapture: (item: OutboxItem) => Promise<void>;
  clearLocal: () => Promise<void>;
  dismissMessage: () => void;
};

