import type {
  CompositeNavigationProp,
  NavigatorScreenParams,
} from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { CaptureIntent } from "./intents";

export type RootStackParamList = {
  MainTabs: NavigatorScreenParams<MainTabParamList> | undefined;
  Memory: { id: string };
  Search: undefined;
  AssetLibrary: undefined;
  AssetDetail: { id: string };
  Settings: undefined;
  Inbox: undefined;
  PersonDetail: { id: string };
  Stories: undefined;
  StoryDetail: { id: string };
  Capsules: undefined;
  CapsuleDetail: { id: string };
  Requests: undefined;
  RequestDetail: { id: string };
  RequestCreate: { personId?: string } | undefined;
  ContributionPortals: undefined;
  ContributionPortalDetail: { id: string; token?: string };
  ImportSessions: undefined;
  ImportSessionDetail: { id: string };
  WeeklyReview: undefined;
  Books: undefined;
  BookReview: undefined;
  ReadingDownloads: undefined;
  OfflineReading: {key:string};
  BookDetail: {id:string};
  Calendar: undefined;
  Collections: {eventIds?:string[]} | undefined;
  CollectionDetail: {id:string};
  InviteFamily: undefined;
  LocalCapture: { captureId: string };
};

// 正式 1.0 五个一级入口(M1):今天/记忆/记录/家人/我的。
// 收件箱不再是主导航:从「今天」卡片与「记忆」页头部进入,栈内保留深链。
export type MainTabParamList = {
  Home: undefined;
  Timeline: undefined;
  Capture: { intent?: CaptureIntent; requestKey?: number; draftId?: string } | undefined;
  People: undefined;
  More: undefined;
};

export const TAB_ROUTES = ["Home", "Timeline", "Capture", "People", "More"] as const;

export type AppNavigation = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList>,
  NativeStackNavigationProp<RootStackParamList>
>;
