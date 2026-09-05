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
  Settings: undefined;
  People: undefined;
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
  Calendar: undefined;
  Collections: {eventIds?:string[]} | undefined;
  CollectionDetail: {id:string};
};

export type MainTabParamList = {
  Home: undefined;
  Timeline: undefined;
  Capture: { intent?: CaptureIntent; requestKey?: number } | undefined;
  Inbox: undefined;
  More: undefined;
};

export const TAB_ROUTES = ["Home", "Timeline", "Capture", "Inbox", "More"] as const;

export type AppNavigation = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList>,
  NativeStackNavigationProp<RootStackParamList>
>;
