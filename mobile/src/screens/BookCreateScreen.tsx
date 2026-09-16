import { Pressable, ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "../components/typography";
import { draftReadingScope } from "../drafts/reading";
import type { RootStackParamList } from "../navigation/types";
import { useAppData } from "../state/AppContext";
import { useSharedStyles } from "../theme";
import { WorkCreator } from "./WorkCreator";

export function BookCreateScreen({ navigation, route }: NativeStackScreenProps<RootStackParamList, "BookCreate">) {
  const s = useSharedStyles();
  const insets = useSafeAreaInsets();
  const { credentials, userId, viewer, family } = useAppData();
  const scope = draftReadingScope(credentials, userId, viewer?.id, family?.id);
  return <View style={s.screen}><ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 28 }]}>
    {scope && scope !== "local" && scope === route.params.scope ? <WorkCreator kind="book" initialMemoryIds={route.params.eventIds}
      onCancel={() => navigation.goBack()} onCreated={id => navigation.replace("BookDetail", { id })} /> : <View style={s.card}>
      <Text style={s.cardTitle}>请从当前家庭重新选取记忆</Text>
      <Text style={s.body}>账号或家庭已变化，之前的选择没有带入。</Text>
      <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} style={s.primaryButton}><Text style={s.primaryText}>返回</Text></Pressable>
    </View>}
  </ScrollView></View>;
}
