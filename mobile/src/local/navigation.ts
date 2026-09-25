import { useCallback, useRef } from "react";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
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
  Restore: undefined;
  ReadableCopy: undefined;
  LetterEditor: { id: string };
  /** sealed：刚封存成功、从写信页转过来，只播一次印章落定；读过就清掉，再进来不播。 */
  Letter: { id: string; sealed?: boolean };
  Quotes: undefined;
  Conflicts: undefined;
  Family: undefined;
};
export type Props<T extends keyof Routes> = NativeStackScreenProps<Routes, T>;
export const useNav = () => useNavigation<NativeStackNavigationProp<Routes>>();

/**
 * 「新建再跳转」的入口只认第一下，直到这一页重新回到前台：转场途中再点一下，
 * 第二份空草稿会换掉已经打开的编辑页参数、自己变成书架上的「上次没写完」。出错时 release 放行。
 */
export function useFocusGuard() {
  const taken = useRef(false);
  useFocusEffect(
    useCallback(() => {
      taken.current = false;
    }, []),
  );
  const take = useCallback(() => {
    if (taken.current) return false;
    taken.current = true;
    return true;
  }, []);
  const release = useCallback(() => {
    taken.current = false;
  }, []);
  return { take, release };
}
