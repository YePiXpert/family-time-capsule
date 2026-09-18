import { useState } from "react";
import { Alert, View } from "react-native";
import { useLibrary, useStore } from "./context";
import { deletePerson, mergePersons, type Library } from "./model";
import { renamePerson } from "./services";
import type { Props } from "./navigation";
import {
  Button,
  Card,
  ErrorText,
  Field,
  Page,
  Text,
  messageOf,
  useStyles,
} from "./ui";

export function People(_: Props<"People">) {
  const state = useLibrary(),
    store = useStore(),
    s = useStyles();
  const [error, setError] = useState(""),
    [renaming, setRenaming] = useState<string | null>(null),
    [name, setName] = useState(""),
    [merging, setMerging] = useState<string | null>(null);
  // 一律改 change 提供的克隆 s；改实时 state 会绕过落盘。
  const action = (fn: (s: Library) => void) => {
    void store.change(fn).catch((e) => setError(messageOf(e)));
  };
  const people = Object.values(state.persons).sort((a, b) =>
    a.name.localeCompare(b.name, "zh"),
  );
  const usageOf = (id: string) =>
    Object.values(state.records).filter((r) => r.personIds?.includes(id))
      .length +
    Object.values(state.drafts).filter((d) =>
      d.content.personIds?.includes(id),
    ).length;
  const confirmMerge = (sourceId: string, targetId: string) => {
    const source = state.persons[sourceId]!,
      target = state.persons[targetId]!;
    Alert.alert(
      `把「${source.name}」合并进「${target.name}」？`,
      "之后所有标记都算在后者名下，这个操作无法撤销。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "合并",
          style: "destructive",
          onPress: () => {
            action((s) => mergePersons(s, sourceId, targetId));
            setMerging(null);
          },
        },
      ],
    );
  };
  return (
    <Page>
      <Text style={s.title}>整理人物</Text>
      <Text style={s.muted}>
        {people.length
          ? "改名、合并同一个人，或取消标记；记录本身不会被动到。"
          : "还没有人物。在记录的「补充信息」里添加后，就能在这里整理。"}
      </Text>
      <ErrorText message={error} />
      <View style={{ gap: 16 }}>
        {people.map((person) => {
          const usage = usageOf(person.id);
          return (
            <Card compact key={person.id}>
              <View style={s.between}>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text style={s.heading}>{person.name}</Text>
                  <Text style={s.muted}>
                    {usage
                      ? `出现在 ${usage} 条记录或草稿里`
                      : "还没有记录用过这个人物"}
                  </Text>
                </View>
              </View>
              {renaming === person.id && (
                <View style={{ gap: 8 }}>
                  <Field
                    label="新的名字"
                    testID={`person-rename-${person.id}`}
                    value={name}
                    onChangeText={setName}
                  />
                  <View style={s.row}>
                    <Button
                      title="保存名字"
                      compact
                      testID={`person-rename-save-${person.id}`}
                      onPress={() => {
                        void renamePerson(store, person.id, name)
                          .then(() => setRenaming(null))
                          .catch((e) => setError(messageOf(e)));
                      }}
                    />
                    <Button
                      title="算了"
                      compact
                      onPress={() => setRenaming(null)}
                    />
                  </View>
                </View>
              )}
              {merging === person.id && (
                <View style={{ gap: 8 }}>
                  <Text style={s.muted}>把这个人合并进：</Text>
                  {people
                    .filter((p) => p.id !== person.id)
                    .map((target) => (
                      <Button
                        key={target.id}
                        title={target.name}
                        compact
                        onPress={() => confirmMerge(person.id, target.id)}
                      />
                    ))}
                  {people.length < 2 && (
                    <Text style={s.muted}>现在只有这一个人物。</Text>
                  )}
                  <Button
                    title="不合并了"
                    compact
                    onPress={() => setMerging(null)}
                  />
                </View>
              )}
              <View style={s.row}>
                <Button
                  title="改名"
                  compact
                  testID={`person-edit-${person.id}`}
                  onPress={() => {
                    setRenaming(renaming === person.id ? null : person.id);
                    setMerging(null);
                    setName(person.name);
                  }}
                />
                <Button
                  title="合并"
                  compact
                  testID={`person-merge-${person.id}`}
                  onPress={() => {
                    setMerging(merging === person.id ? null : person.id);
                    setRenaming(null);
                  }}
                />
                <Button
                  title="删除"
                  compact
                  testID={`person-delete-${person.id}`}
                  onPress={() =>
                    Alert.alert(
                      `删除「${person.name}」？`,
                      "只取消这个人出现在记录上的标记，记录本身保留。",
                      [
                        { text: "取消", style: "cancel" },
                        {
                          text: "删除人物",
                          style: "destructive",
                          onPress: () => {
                            action((s) => deletePerson(s, person.id));
                            setRenaming(null);
                            setMerging(null);
                          },
                        },
                      ],
                    )
                  }
                />
              </View>
            </Card>
          );
        })}
      </View>
    </Page>
  );
}
