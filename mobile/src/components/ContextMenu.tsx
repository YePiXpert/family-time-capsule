import { useCallback, useState, type ReactNode } from "react";
import { Dimensions, Modal, Pressable, StyleSheet, View } from "react-native";
import { haptics } from "../design/haptics";
import { journalRadius, journalShadow, journalSpace, journalType } from "../design/tokens";
import { useColorTheme } from "../theme";
import { GlassSurface } from "./GlassSurface";
import { JournalIcon, type JournalIconName } from "./JournalIcon";
import { Text } from "./typography";

/**
 * 长按浮动菜单（M2 导出，M3 接入）：玻璃质感浮层，锚定长按点附近，
 * 点在屏幕下半部时向上展开；点背景关闭，打开时给 impact 触觉。
 */

export type ContextMenuItem = {
  key: string;
  label: string;
  icon?: JournalIconName;
  destructive?: boolean;
  onPress: () => void;
};

export type ContextMenuAnchor = { x: number; y: number };

export type ContextMenuProps = {
  visible: boolean;
  anchor: ContextMenuAnchor | null;
  items: ContextMenuItem[];
  onClose: () => void;
};

const MENU_WIDTH = 224;
const ITEM_HEIGHT = 48;

export function ContextMenu({ visible, anchor, items, onClose }: ContextMenuProps) {
  const { colors } = useColorTheme();
  const { width: screenWidth, height: screenHeight } = Dimensions.get("window");
  const estimatedHeight = items.length * ITEM_HEIGHT + journalSpace.small * 2;
  const left = Math.max(journalSpace.small, Math.min(anchor?.x ?? journalSpace.small, screenWidth - MENU_WIDTH - journalSpace.small));
  const rawY = anchor?.y ?? 96;
  const top = rawY > screenHeight / 2
    ? Math.max(journalSpace.small, rawY - estimatedHeight - 12)
    : Math.min(rawY + 12, screenHeight - estimatedHeight - 24);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.container}>
        <Pressable accessibilityRole="button" accessibilityLabel="关闭菜单" onPress={onClose} style={StyleSheet.absoluteFill} />
        <View pointerEvents="box-none" style={[styles.menuWrap, { left, top, width: MENU_WIDTH }]}>
          <View style={styles.menu}>
            <GlassSurface tier="overlay" interactive radius={journalRadius.card} />
            {items.map((item, index) => (
              <Pressable
                key={item.key}
                accessibilityRole="menuitem"
                onPress={() => {
                  onClose();
                  item.onPress();
                }}
                style={({ pressed }) => [
                  styles.item,
                  index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
                  pressed && { backgroundColor: colors.softCoral },
                ]}
              >
                {item.icon ? <JournalIcon name={item.icon} color={item.destructive ? colors.error : colors.ink} size={19} /> : null}
                <Text style={[styles.label, { color: item.destructive ? colors.error : colors.ink }]}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** 便捷 hook：menuElement 渲染到屏幕根部，openMenu 传入触摸点（如 onLongPress 事件的 pageX/pageY）。 */
export function useContextMenu() {
  const [state, setState] = useState<{ anchor: ContextMenuAnchor; items: ContextMenuItem[] } | null>(null);
  const openMenu = useCallback((items: ContextMenuItem[], anchor: ContextMenuAnchor) => {
    haptics.impact();
    setState({ items, anchor });
  }, []);
  const closeMenu = () => setState(null);
  const menuElement: ReactNode = (
    <ContextMenu visible={state !== null} anchor={state?.anchor ?? null} items={state?.items ?? []} onClose={closeMenu} />
  );
  return { openMenu, closeMenu, menuElement };
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  menuWrap: { position: "absolute" },
  menu: {
    borderRadius: journalRadius.card,
    overflow: "hidden",
    paddingVertical: journalSpace.small,
    boxShadow: journalShadow.float,
  },
  item: {
    minHeight: ITEM_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: journalSpace.medium,
  },
  label: { fontSize: journalType.body, fontWeight: "600" },
});
