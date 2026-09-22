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
  People: undefined;
  Title: undefined;
  Settings: undefined;
  Editor: { draftId: string };
  /** shuffle：从「随便翻翻」进来，顶栏右侧给「再翻一页」。 */
  Record: { id: string; shuffle?: boolean };
  Album: { id: string };
  Picker: { sessionId: string };
  AlbumDetails: { sessionId: string };
  Media: { id: string; recordId?: string };
  Profile: undefined;
  Storage: undefined;
  Backup: undefined;
  Appearance: undefined;
  Signature: undefined;
  AISettings: undefined;
  LetterEditor: { id: string };
  Letter: { id: string };
  Quotes: undefined;
  Conflicts: undefined;
  RecoveryCode: { mode: "show" | "join" };
};
export type Props<T extends keyof Routes> = NativeStackScreenProps<Routes, T>;
export const useNav = () => useNavigation<NativeStackNavigationProp<Routes>>();
