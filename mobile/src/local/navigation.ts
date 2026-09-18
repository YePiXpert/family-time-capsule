import { useNavigation } from "@react-navigation/native";
import type {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from "@react-navigation/native-stack";
export type Routes = {
  Shelf: undefined;
  Search: undefined;
  Month: { month: string };
  Year: { year: string };
  Recap: { year: string };
  Firsts: undefined;
  Footprint: undefined;
  People: undefined;
  Title: undefined;
  Settings: undefined;
  Editor: { draftId: string };
  Record: { id: string };
  Album: { id: string };
  Series: { id: string };
  Picker: { sessionId: string };
  AlbumDetails: { sessionId: string };
  Media: { id: string; recordId?: string };
  Profile: undefined;
  Storage: undefined;
  Backup: undefined;
  Appearance: undefined;
  AISettings: undefined;
};
export type Props<T extends keyof Routes> = NativeStackScreenProps<Routes, T>;
export const useNav = () => useNavigation<NativeStackNavigationProp<Routes>>();
