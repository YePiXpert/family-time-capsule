import { useState } from "react";
import {
  DateTimePickerAndroid,
  type DateTimePickerEvent,
  default as DateTimePicker,
} from "@react-native-community/datetimepicker";
import { Modal, Platform, Pressable, Text, View } from "react-native";
import { colors, sharedStyles } from "../theme";

/**
 * 适配手机的发生时间选择器（M3）：日期 → 时间两步，按家庭墙钟时间
 * （YYYY-MM-DDTHH:mm）存储；不让普通用户手输 ISO 字符串。
 * 时间可以为空（“待补时间”，不拿导入时间伪造拍摄时间）。
 */

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function toWallString(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function parseWallString(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function DateTimeField({
  value,
  onChange: emitChange,
  disabled = false,
}: {
  value: string | null;
  disabled?: boolean;
  onChange: (value: string | null) => void;
}) {
  const onChange = (value: string | null) => { if (!disabled) emitChange(value); };
  const [picking, setPicking] = useState<{ date: Date; step: "date" | "time" } | null>(null);
  const current = parseWallString(value) ?? new Date();

  const commit = (date: Date) => onChange(toWallString(date));

  const openAndroid = () => {
    DateTimePickerAndroid.open({
      mode: "date",
      value: current,
      onChange: (event: DateTimePickerEvent, date?: Date) => {
        if (event.type !== "set" || !date) return;
        DateTimePickerAndroid.open({
          mode: "time",
          value: date,
          onChange: (timeEvent: DateTimePickerEvent, time?: Date) => {
            if (timeEvent.type === "set" && time) commit(time);
          },
        });
      },
    });
  };

  const label = value ? value.replace("T", " ") : "待补时间";

  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable disabled={disabled}
          onPress={Platform.OS === "android" ? openAndroid : () => setPicking({ date: new Date(current.getTime()), step: "date" })}
          style={[sharedStyles.input, { flex: 1, justifyContent: "center" }]}
        >
          <Text style={{ color: value ? colors.ink : colors.muted, fontSize: 16 }}>{label}</Text>
        </Pressable>
        {value ? (
          <Pressable disabled={disabled} onPress={() => onChange(null)} style={[sharedStyles.input, { justifyContent: "center" }]}>
            <Text style={{ color: colors.coralDark, fontSize: 14, fontWeight: "800" }}>清空</Text>
          </Pressable>
        ) : null}
      </View>
      {Platform.OS === "ios" && picking ? (
        <Modal animationType="slide" transparent visible onRequestClose={() => setPicking(null)}>
          <View style={styles.sheet}>
            <View style={styles.sheetCard}>
              <DateTimePicker
                key={picking.step}
                mode={picking.step}
                style={{ width: "100%" }}
                value={picking.date}
                onChange={(_event, date) => {
                  if (date) setPicking({ date: new Date(date.getTime()), step: picking.step });
                }}
              />
              {picking.step === "date" ? (
                <Pressable disabled={disabled}
                  onPress={() => setPicking({ date: picking.date, step: "time" })}
                  style={sharedStyles.primaryButton}
                >
                  <Text style={sharedStyles.primaryText}>下一步：选择时间</Text>
                </Pressable>
              ) : (
                <Pressable disabled={disabled}
                  onPress={() => {
                    commit(picking.date);
                    setPicking(null);
                  }}
                  style={sharedStyles.primaryButton}
                >
                  <Text style={sharedStyles.primaryText}>确定</Text>
                </Pressable>
              )}
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = {
  sheet: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(47,36,31,0.4)" },
  sheetCard: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, gap: 12 },
} as const;
