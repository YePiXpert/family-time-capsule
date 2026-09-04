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
