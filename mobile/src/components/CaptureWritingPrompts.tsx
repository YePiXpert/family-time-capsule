import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { journalRadius, journalSpace, journalType } from "../design/tokens";
import { useColorTheme } from "../theme";
import { Disclosure } from "./Disclosure";
import { Text } from "./typography";
import { Button } from "./ui";

const writingPrompts = [
  { name: "第一次", text: "今天，你第一次……\n当时，你……\n我最想记住的是……" },
  { name: "你说的话", text: "你说：“……”\n当时，我们正在……\n听到这句话，我……" },
  { name: "生日", text: "这个生日，想为你记下……\n这一年，最想记住的是……\n想对长大的你说……" },
] as const;

/** Optional writing starters share the existing editable, auto-saved body. */
export function CaptureWritingPrompts({ text, disabled, onUse }: {
  text: string;
  disabled: boolean;
  onUse: (nextText: string) => void;
}) {
  const { colors } = useColorTheme();
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const selected = writingPrompts.find(prompt => prompt.name === selectedName);
  const separator = !text.length || text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
  const nextText = selected ? `${text}${separator}${selected.text}` : text;
  const tooLong = nextText.length > 5000;

  return (
    <Disclosure title="更多工具">
      <View style={styles.body}>
        <Text accessibilityRole="header" style={[styles.heading, { color: colors.ink }]}>写作提示</Text>
        <Text style={[styles.description, { color: colors.muted }]}>选一段开头，改成你想留下的话。</Text>
        <View style={styles.choices}>
          {writingPrompts.map(prompt => {
            const selected = prompt.name === selectedName;
            return <Pressable
              key={prompt.name}
              accessibilityRole="button"
              accessibilityLabel={prompt.name}
              accessibilityHint="预览可加入正文的写作提示"
              accessibilityState={{ selected, disabled }}
              disabled={disabled}
              onPress={() => { setSelectedName(prompt.name); setMessage(""); }}
              style={({ pressed }) => [styles.choice, {
                backgroundColor: selected ? colors.softCoral : colors.card,
                borderColor: selected ? colors.coral : colors.line,
                opacity: disabled ? 0.45 : pressed ? 0.72 : 1,
              }]}
            ><Text style={[styles.choiceLabel, { color: selected ? colors.coralDark : colors.ink }]}>{prompt.name}</Text></Pressable>;
          })}
        </View>
        {selected ? <View style={[styles.preview, { backgroundColor: colors.card, borderColor: colors.line }]}>
          <Text style={[styles.prompt, { color: colors.ink }]}>{selected.text}</Text>
          <Text style={[styles.description, { color: colors.muted }]}>{text.length ? "加入后接在已有文字后面，可随时删改。" : "加入后可在正文中直接修改或删除。"}</Text>
          {tooLong ? <Text accessibilityRole="alert" style={[styles.description, { color: colors.error }]}>正文最多 5000 字，删去一些文字后再添加提示。</Text> : null}
          <Button
            title={text.length ? "追加到正文" : "加入正文"}
            disabled={disabled || tooLong}
            onPress={() => {
              if (disabled || tooLong) return;
              onUse(nextText);
              setMessage(`已加入“${selected.name}”提示，可在正文中删改。`);
              setSelectedName(null);
            }}
          />
        </View> : null}
        {message ? <Text accessibilityLiveRegion="polite" style={[styles.description, { color: colors.muted }]}>{message}</Text> : null}
      </View>
    </Disclosure>
  );
}

const styles = StyleSheet.create({
  body: { gap: journalSpace.small },
  heading: { fontSize: journalType.body, fontWeight: "600" },
  description: { fontSize: journalType.label, lineHeight: 22 },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: journalSpace.small },
  choice: { minHeight: 44, minWidth: 88, flexGrow: 1, justifyContent: "center", alignItems: "center", borderWidth: 1, borderRadius: journalRadius.control, paddingHorizontal: 12, paddingVertical: 8 },
  choiceLabel: { fontSize: journalType.label, textAlign: "center" },
  preview: { borderWidth: 1, borderRadius: journalRadius.control, padding: journalSpace.medium, gap: journalSpace.small },
  prompt: { fontSize: journalType.body, lineHeight: 26 },
});
