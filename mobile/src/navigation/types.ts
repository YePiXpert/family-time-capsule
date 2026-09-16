import type {
  CompositeNavigationProp,
  NavigatorScreenParams,
} from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { CaptureIntent } from "./intents";

export type CaptureTarget = { kind: "new" } | { kind: "local"; draftId: string; editSaved?: boolean } | { kind: "serverDraft"; draftId: string } | { kind: "memory"; memoryId: string };

export type RootStackParamList = {
  MainTabs: NavigatorScreenParams<MainTabParamList> | undefined;
  Capture: { scope: string; target: CaptureTarget; intent?: CaptureIntent };
  LocalAlbum: { id: string; scope: string };
  MaterialPicker: { sessionId: string; scope: string };
  WorkPreview: { sessionId: string; scope: string };
  People: undefined;
  DeviceSettings: undefined;
  Memory: { id: string };
  SavedMemory: { draftId: string; scope: string };
  Search: undefined;
  AssetLibrary: undefined;
  AssetDetail: { id: string };
  Settings: undefined;
  Inbox: undefined;
  Pending: undefined;
  PersonDetail: { id: string };
  LocalIntake: { id: string };
  ImportSessions: undefined;
  ImportSessionDetail: { id: string };
  Books: undefined;
  ReadingDownloads: undefined;
  OfflineReading: {key:string};
  BookDetail: {id:string};
  BookCreate: { eventIds?: string[]; scope: string };
  Calendar: undefined;
  Collections: {eventIds?:string[]; refs?:import("../collections/local").MaterialRef[]; scope?:string} | undefined;
  CollectionDetail: {id:string};
  FamilyViewing: { collectionId: string; downloadKey?: string };
  InviteFamily: undefined;
  LocalCapture: { captureId: string };
};

// 三个主入口；家人和设备管理使用设置栈。
export type MainTabParamList = {
  Timeline: { saved?: { draftId: string; scope: string; requestKey: string } } | undefined;
  Works: undefined;
  Profile: undefined;
};

export const TAB_ROUTES = ["Timeline", "Works", "Profile"] as const;

export type AppNavigation = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList>,
  NativeStackNavigationProp<RootStackParamList>
>;
