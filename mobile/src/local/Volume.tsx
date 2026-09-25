import { Pressable, View } from "react-native";
import Animated from "react-native-reanimated";
import { type LocalMedia } from "./model";
import { Stamp, Text, serif, usePressScale, useStyles, useTheme } from "./ui";
import { JournalIcon } from "../components/JournalIcon";
import { Photo } from "./Media";

export function Volume({
  title,
  caption,
  cover,
  fallbackIcon,
  stamp,
  onPress,
  testID,
  width,
  ratio = 4 / 3,
}: {
  title: string;
  caption: string;
  cover?: LocalMedia;
  fallbackIcon?: "book" | "star" | "plus" | "pin";
  /** 无封面时盖在纸封面上的印章文字（年度册年份）。 */
  stamp?: string;
  onPress: () => void;
  testID?: string;
  width: number;
  /** 封面裁切比例，默认 4:3；年度册里的月册网格用 1。 */
  ratio?: number;
}) {
  const s = useStyles(),
    { colors, large } = useTheme();
  const press = usePressScale();
  // 不做逐个进场：年度册是被原生 push 进来的一整页，再让封面一张张浮上来就是两套位移叠在一起。
  return (
    <Animated.View style={[{ width }, press.style]}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${title}，${caption}`}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={{ gap: 6 }}
      >
        {cover ? (
          <Photo media={cover} preview ratio={ratio} />
        ) : (
          <View
            style={[
              s.section,
              {
                aspectRatio: ratio,
                justifyContent: "center",
                alignItems: "center",
                gap: 8,
              },
            ]}
          >
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                left: 10,
                top: 12,
                bottom: 12,
                width: 4,
                borderRadius: 2,
                backgroundColor: colors.accent,
                opacity: 0.7,
              }}
            />
            {stamp ? (
              <Stamp size={56}>
                <Text
                  style={{
                    fontFamily: serif,
                    fontSize: stamp.length > 3 ? 13 : 18,
                    color: colors.accent,
                    fontWeight: "600",
                    letterSpacing: 0.3,
                  }}
                >
                  {stamp}
                </Text>
              </Stamp>
            ) : (
              <JournalIcon
                name={fallbackIcon ?? "book"}
                color={colors.accent}
                size={28}
              />
            )}
          </View>
        )}
        <View style={{ gap: 1 }}>
          <Text
            numberOfLines={1}
            style={{
              fontFamily: serif,
              fontWeight: "600",
              letterSpacing: 0.3,
              lineHeight: large ? 26 : 22,
            }}
          >
            {title}
          </Text>
          <Text
            numberOfLines={1}
            style={[s.muted, { lineHeight: large ? 20 : 18 }]}
          >
            {caption}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

