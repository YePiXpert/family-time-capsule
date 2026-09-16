import { Pressable, ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "../components/typography";
import { draftReadingScope } from "../drafts/reading";
import type { RootStackParamList } from "../navigation/types";
import { useAppData } from "../state/AppContext";
import { useSharedStyles } from "../theme";
import { WorkCreator } from "./WorkCreator";
import { useEffect, useRef, useState } from "react";
import { createWorkSession } from "../worksession/store";

export function BookCreateScreen({ navigation, route }: NativeStackScreenProps<RootStackParamList, "BookCreate">) {
  const s = useSharedStyles();
  const insets = useSafeAreaInsets();
  const { credentials, userId, viewer, family } = useAppData();
  const scope = draftReadingScope(credentials, userId, viewer?.id, family?.id);
  const started = useRef(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!scope || scope === "local" || scope !== route.params.scope || started.current) return;
    started.current = true;
    let live = true;
    void createWorkSession(scope, { mode: "create", kind: "book" }, (route.params.eventIds ?? []).map(id => ({kind:"memory",scope,id})))
      .then(session => { if(live) navigation.replace(route.params.eventIds?.length ? "WorkPreview" : "MaterialPicker",{scope,sessionId:session.id}); })
      .catch(e => {if(live){started.current=false;setError(e.message);}});
    return () => {live=false;};
  },[scope,route.params.scope,route.params.eventIds,navigation]);
  return <View style={s.screen}><ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 28 }]}>
    {scope && scope !== "local" && scope === route.params.scope ? error ? <WorkCreator kind="book" initialMemoryIds={route.params.eventIds}
      onCancel={() => navigation.goBack()} onCreated={id => navigation.replace("BookDetail", { id })} /> : <Text style={s.body}>正在带入所选内容…</Text> : <View style={s.card}>
      <Text style={s.cardTitle}>请从当前家庭重新选取记忆</Text>
      <Text style={s.body}>账号或家庭已变化，之前的选择没有带入。</Text>
      <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} style={s.primaryButton}><Text style={s.primaryText}>返回</Text></Pressable>
    </View>}
  </ScrollView></View>;
}
