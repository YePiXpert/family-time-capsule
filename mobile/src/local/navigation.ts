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
  LetterEditor: { id: string };
  /** sealed：刚封存成功、从写信页转过来，只播一次印章落定；读过就清掉，再进来不播。 */
  Letter: { id: string; sealed?: boolean };
  Quotes: undefined;
  Conflicts: undefined;
  Family: undefined;
};
export type Props<T extends keyof Routes> = NativeStackScreenProps<Routes, T>;
export const useNav = () => useNavigation<NativeStackNavigationProp<Routes>>();
