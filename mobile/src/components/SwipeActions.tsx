import { useRef, type ReactNode } from "react";
import { Pressable, StyleSheet, View, type Animated as AnimatedType } from "react-native";
import Swipeable from "react-native-gesture-handler/Swipeable";
import { haptics } from "../design/haptics";
import { useColorTheme } from "../theme";
import { Text } from "./typography";

/**
 * 滑动操作（M2 导出，M3 接入列表）：iOS 风格整行彩色操作格，
 * 靠近内容边缘的第一个操作更宽（半滑时先露出/“偷看”）。
 * 划过开启阈值时给出 selection 触觉。
 */

export type SwipeAction = {
  key: string;
  label: string;
  /** 单元格底色（传 tokens 色，如 colors.coral / colors.error）。 */
  color: string;
  destructive?: boolean;
  /** 默认 colors.onCoral。 */
  labelColor?: string;
  onPress: () => void;
};

export type SwipeActionsProps = {
  children: ReactNode;
  /** 从边缘向内依次 revealed 的操作；第一个最靠内容边缘。 */
  actions: SwipeAction[];
  onOpen?: () => void;
  onClose?: () => void;
};

const SUBSEQUENT_CELL_WIDTH = 76;

export function SwipeActions({ children, actions, onOpen, onClose }: SwipeActionsProps) {
  const { colors } = useColorTheme();
  const hapticArmed = useRef(true);
  const renderActions = (
    _progress: AnimatedType.AnimatedInterpolation<string | number>,
    _translation: AnimatedType.AnimatedInterpolation<string | number>,
    methods: Swipeable,
  ) => (
    <View style={styles.row}>
      {actions.map((action, index) => (
        <Pressable
          key={action.key}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={() => {
            action.onPress();
            methods.close();
          }}
          style={[styles.cell, { backgroundColor: action.color, width: index === 0 ? styles.peekCell.width : SUBSEQUENT_CELL_WIDTH }]}
        >
          <Text numberOfLines={1} style={[styles.label, { color: action.labelColor ?? colors.onCoral }]}>{action.label}</Text>
        </Pressable>
      ))}
    </View>
  );
  return (
    <Swipeable
      friction={1.2}
      overshootRight={false}
      renderRightActions={renderActions}
      onSwipeableWillOpen={() => {
        if (hapticArmed.current) {
          haptics.selection();
          hapticArmed.current = false;
        }
        onOpen?.();
      }}
      onSwipeableWillClose={() => {
        hapticArmed.current = true;
        onClose?.();
      }}
    >
      {children}
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "stretch" },
  cell: { minHeight: 72, alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  peekCell: { width: 96 },
  label: { fontSize: 14, fontWeight: "700" },
});
