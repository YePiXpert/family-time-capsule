import { Text } from "./typography";
import { useState } from "react";
import {
  DateTimePickerAndroid,
  type DateTimePickerEvent,
  default as DateTimePicker,
} from "@react-native-community/datetimepicker";
import { Modal, Platform, Pressable, View } from "react-native";
import { useSharedStyles } from "../theme";
import { DateTimeField } from "./DateTimeField";
import {
  anchorFromPrecisionInput,
  precisionLevel,
  formatOccurredLabel,
  type OccurredAtPrecision,
} from "../utils/occurred-precision";
import { utcToZonedWallTimeInput, zonedWallTimeToUtc } from "../utils/wall-time";

/**
 * 六档精度的发生时间编辑（正式 1.0 §6 收尾）。
 *
 * - 精确/大约：日期→时间两步（与既有 DateTimeField 一致）；
 * - 只到日：只选日期；到月/到年：借日期选择器取年月，界面明确
 *   「只保留到月/到年」，锚点取该期首日（仅排序分组用）；
 * - 不详：不保存发生时间（发布端用创建时刻做内部排序锚点，
 *   永不显示为发生时间）；
 * - 锚点与精度成对写入草稿；显示文案按精度输出，不泄露虚假精度。
 */

const PRECISION_OPTIONS: readonly { value: OccurredAtPrecision; label: string }[] = [
  { value: "exact", label: "精确" },
  { value: "approximate", label: "大约" },
  { value: "date_only", label: "只到日" },
  { value: "month", label: "到月" },
  { value: "year", label: "到年" },
  { value: "unknown", label: "不详" },
];

/** 到月/到年：选一个日子，只保留年（月）信息。 */
type LooseMode = "date_only" | "month" | "year";

const LOOSE_HINT: Record<LooseMode, string> = {
  date_only: "只保留到日",
  month: "选任意一天，只保留到月",
  year: "选任意一天，只保留到年",
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** 日期选择器给出的是本机时刻；取其本地墙钟日期段。 */
function localWallDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function PrecisionDateTimeField({
  occurredAt,
  precision,
  timezone,
  onChange: emitChange,
  disabled = false,
}: {
  occurredAt: string | null;
  precision: OccurredAtPrecision;
  timezone: string;
  disabled?: boolean;
  onChange: (next: { occurredAt: string | null; precision: OccurredAtPrecision }) => void;
}) {
  const s = useSharedStyles();
  const onChange = (value: { occurredAt: string | null; precision: OccurredAtPrecision }) => { if (!disabled) emitChange(value); };
  const [loosePicking, setLoosePicking] = useState<{ mode: LooseMode; date: Date } | null>(null);

  const anchorWall = occurredAt ? utcToZonedWallTimeInput(new Date(occurredAt), timezone) : "";
  const currentLabel =
    precision === "unknown"
      ? "时间不确定"
      : occurredAt
        ? formatOccurredLabel(precision, occurredAt, timezone)
        : "待补时间";

  const emitAnchor = (wall: string, target: OccurredAtPrecision) => {
    const anchor = anchorFromPrecisionInput({ precision: target, wall, timezone, toUtc: zonedWallTimeToUtc });
    onChange({ occurredAt: anchor ? anchor.toISOString() : null, precision: target });
  };

  const switchPrecision = (next: OccurredAtPrecision) => {
    if (next === precision) return;
    if (precisionLevel(next) > precisionLevel(precision)) { onChange({ occurredAt: null, precision: next }); return; }
    if (next === "unknown" || !occurredAt || !anchorWall) {
      onChange({ occurredAt: next === "unknown" ? null : occurredAt, precision: next });
      return;
    }
    if (next === "month" || next === "year") {
      // 收细到月/年：锚点改为该期首日，只保留期信息。
      const wall = next === "month" ? anchorWall.slice(0, 7) : anchorWall.slice(0, 4);
      emitAnchor(wall, next);
      return;
    }
    onChange({ occurredAt, precision: next });
  };

  const commitLoose = (date: Date, mode: LooseMode) => {
    const wallDate = localWallDate(date);
    const wall =
      mode === "date_only" ? wallDate : mode === "month" ? wallDate.slice(0, 7) : wallDate.slice(0, 4);
    emitAnchor(wall, mode);
  };

  const openLooseAndroid = (mode: LooseMode) => {
    const base = occurredAt && anchorWall ? new Date(anchorWall) : new Date();
    DateTimePickerAndroid.open({
      mode: "date",
      value: Number.isNaN(base.getTime()) ? new Date() : base,
      onChange: (event: DateTimePickerEvent, date?: Date) => {
        if (event.type === "set" && date) commitLoose(date, mode);
      },
    });
  };

  return (
    <View style={{ gap: 8 }} accessibilityLabel="发生时间与精度">
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {PRECISION_OPTIONS.map((option) => {
          const active = option.value === precision;
          return (
            <Pressable disabled={disabled}
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              onPress={() => switchPrecision(option.value)}
              style={[
                s.secondaryButton,
                { opacity: active ? 1 : 0.65, borderColor: active ? s.colors.coral : s.colors.muted },
              ]}
            >
              <Text style={active ? s.secondaryText : { color: s.colors.muted, fontSize: 14 }}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {precision === "exact" || precision === "approximate" ? (
        <DateTimeField disabled={disabled}
          value={anchorWall}
          onChange={(wall) => {
            if (!wall) {
              onChange({ occurredAt: null, precision });
              return;
            }
            emitAnchor(wall, precision);
          }}
        />
      ) : null}

      {precision === "date_only" || precision === "month" || precision === "year" ? (
        <View style={{ gap: 4 }}>
          <Pressable disabled={disabled}
            onPress={() =>
              Platform.OS === "android"
                ? openLooseAndroid(precision)
                : setLoosePicking({ mode: precision, date: occurredAt && anchorWall ? new Date(anchorWall) : new Date() })
            }
            style={[s.input, { justifyContent: "center" }]}
          >
            <Text style={{ color: occurredAt ? s.colors.ink : s.colors.muted, fontSize: 16 }}>{currentLabel}</Text>
          </Pressable>
          <Text style={{ color: s.colors.muted, fontSize: 12 }}>{LOOSE_HINT[precision]}</Text>
        </View>
      ) : null}

      {precision === "unknown" ? (
        <Text style={{ color: s.colors.muted, fontSize: 12 }}>不写发生时间；这条记忆按保存先后排序，不会显示编造的日期。</Text>
      ) : null}

      {precision !== "exact" && precision !== "approximate" && precision !== "unknown" ? (
        <Text style={{ color: s.colors.muted, fontSize: 12 }}>当前：{currentLabel}</Text>
      ) : null}

      {Platform.OS === "ios" && loosePicking ? (
        <Modal animationType="slide" transparent visible onRequestClose={() => setLoosePicking(null)}>
          <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: s.colors.scrim }}>
            <View style={{ backgroundColor: s.colors.elevated, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, gap: 12 }}>
              <DateTimePicker
                mode="date"
                style={{ width: "100%" }}
                value={Number.isNaN(loosePicking.date.getTime()) ? new Date() : loosePicking.date}
                onChange={(_event, date) => {
                  if (date) setLoosePicking({ ...loosePicking, date: new Date(date.getTime()) });
                }}
              />
              <Pressable disabled={disabled}
                onPress={() => {
                  commitLoose(loosePicking.date, loosePicking.mode);
                  setLoosePicking(null);
                }}
                style={s.primaryButton}
              >
                <Text style={s.primaryText}>确定</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}
