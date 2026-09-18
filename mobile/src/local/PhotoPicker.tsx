import { FlatList, Modal, Pressable, View, useWindowDimensions } from "react-native";
import { useLibrary } from "./context";
import { Photo } from "./Media";
import { Button, Page, Text, useStyles } from "./ui";

/** 一格候选照片：mediaId 兼作 key，label 给读屏，caption 是图下一行说明。 */
export type PhotoChoice = {
  mediaId: string;
  label: string;
  caption?: string;
};

/**
 * 从本机照片里挑一张的全屏浮层（相册封面、时光系列补月份共用）。
 *
 * 必须是 Modal + Page scroll={false}：FlatList 若落在会滚动的 Page 里，
 * 就成了同向嵌套的 VirtualizedList——窗口化失效、内外滚动打架。
 */
export function PhotoPicker<T extends PhotoChoice>({
  visible,
  title,
  hint,
  empty,
  choices,
  onPick,
  onClose,
  testID,
}: {
  visible: boolean;
  title: string;
  hint?: string;
  empty: string;
  choices: T[];
  onPick: (choice: T) => void;
  onClose: () => void;
  testID?: string;
}) {
  const state = useLibrary(),
    s = useStyles();
  const { width } = useWindowDimensions();
  const tile = (width - 40 - 12) / 2;
  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      testID={testID}
    >
      <Page top scroll={false}>
        <FlatList
          data={choices}
          keyExtractor={(choice) => choice.mediaId}
          numColumns={2}
          columnWrapperStyle={{ gap: 12 }}
          contentContainerStyle={[s.content, { gap: 12 }]}
          ListHeaderComponent={
            <View style={{ gap: 8, paddingBottom: 4 }}>
              <View style={s.between}>
                <Text style={s.heading}>{title}</Text>
                <Button title="取消" compact onPress={onClose} />
              </View>
              {!!hint && <Text style={s.muted}>{hint}</Text>}
            </View>
          }
          ListEmptyComponent={<Text>{empty}</Text>}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={item.label}
              onPress={() => onPick(item)}
              style={{ gap: 4 }}
            >
              <Photo media={state.media[item.mediaId]} size={tile} />
              {!!item.caption && (
                <Text numberOfLines={1} style={s.muted}>
                  {item.caption}
                </Text>
              )}
            </Pressable>
          )}
        />
      </Page>
    </Modal>
  );
}
