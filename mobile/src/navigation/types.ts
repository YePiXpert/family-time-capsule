import type {
  CompositeNavigationProp,
  NavigatorScreenParams,
} from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { CaptureIntent } from "./intents";

export type RootStackParamList = {
  MainTabs: NavigatorScreenParams<MainTabParamList> | undefined;
  People: undefined;
  DeviceSettings: undefined;
  Memory: { id: string };
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
  Calendar: undefined;
  Collections: {eventIds?:string[]} | undefined;
  CollectionDetail: {id:string};
  FamilyViewing: { collectionId: string; downloadKey?: string };
  InviteFamily: undefined;
  LocalCapture: { captureId: string };
};

// 三个主入口；家人和设备管理使用设置栈。
export type MainTabParamList = {
  Timeline: undefined;
  Capture: { intent?: CaptureIntent; requestKey?: number; draftId?: string; localDraftId?: string } | undefined;
  Works: undefined;
  Profile: undefined;
};

export const TAB_ROUTES = ["Timeline", "Works", "Profile"] as const;

export type AppNavigation = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList>,
  NativeStackNavigationProp<RootStackParamList>
>;
