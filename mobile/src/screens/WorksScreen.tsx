import { Text } from "../components/typography";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { BooksScreen } from "./BookScreens";
import { CollectionsScreen } from "./CollectionScreens";
import { sharedStyles as s } from "../theme";

export function WorksScreen() {
  const [kind, setKind] = useState<"album" | "book">("album");
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return <View style={[s.screen, { flex: 1 }]}>
    <View style={{ paddingHorizontal: 20, paddingTop: 16, gap: 8 }}><Text style={s.title}>把成长，装订成礼物</Text><Text style={s.body}>照片、家人的话，还有那时的声音。</Text></View>
    <View accessibilityRole="tablist" style={{ flexDirection: "row", gap: 12, padding: 16 }}>
      {(["album", "book"] as const).map(value => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: kind === value }} onPress={() => setKind(value)} style={[kind === value ? s.primaryButton : s.secondaryButton, { flex: 1 }]}><Text style={kind === value ? s.primaryText : s.secondaryText}>{value === "album" ? "回忆相册" : "成长书"}</Text></Pressable>)}
    </View>
    {kind === "album" ? <CollectionsScreen navigation={navigation} route={{ key: "works-albums", name: "Collections" }} /> : <BooksScreen navigation={navigation} />}
  </View>;
}
