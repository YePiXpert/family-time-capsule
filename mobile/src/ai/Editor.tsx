import { useEffect, useRef, useState } from "react";
import { Alert, View } from "react-native";
import { randomUUID } from "expo-crypto";
import type { Library, RecordDraft } from "../local/model";
import { photoDayGroups } from "../local/photo-metadata";
import { Button, ErrorText, Text, useStyles, messageOf } from "../local/ui";
import { useNav } from "../local/navigation";
import {
  api,
  getToken,
  getPreferredModel,
  hasConsent,
  giveConsent,
  AIError,
} from "./client";
import { thumbnail } from "./images";
import {
  sourceFingerprint,
  sameDayChunks,
  validateResult,
  localPlaceTags,
} from "./state";
import type { AIGroup, AIJob, AIProposal, AIResult, Config } from "./types";
type Patch = Partial<Pick<RecordDraft, "aiJob" | "aiProposal">>;
export function AIEditor({
  draft,
  media,
  disabled,
  onPatch,
  onApply,
}: {
  draft: RecordDraft;
  media: Library["media"];
  disabled: boolean;
  onPatch: (patch: Patch) => Promise<unknown>;
  onApply: (proposal: AIProposal, part?: "title" | "text") => Promise<unknown>;
}) {
  const s = useStyles(),
    nav = useNav();
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(""),
    [error, setError] = useState(""),
    [eventIndex, setEventIndex] = useState(0),
    [lastKind, setLastKind] = useState<"group" | "write">("group");
  const active = useRef(false),
    abort = useRef<AbortController | null>(null),
    latest = useRef({ draft, media });
  useEffect(() => {
    latest.current = { draft, media };
  }, [draft, media]);
  useEffect(() => () => abort.current?.abort(), []);
  const events = photoDayGroups(draft, media),
    proposal = draft.aiProposal;
  const generate = async (kind: "group" | "write", fresh = false) => {
    if (active.current || disabled) return;
    active.current = true;
    try {
      if (!(await getToken())) {
        nav.navigate("AISettings");
        return;
      }
      if (!(await hasConsent())) {
        Alert.alert(
          "使用 AI 整理照片",
          "将把这份草稿中参与分析的照片缩略图、拍摄时间及相关文字，经主人的服务发送给所选 AI。原图和精确 GPS 不发送，结果由你确认。",
          [
            { text: "取消", style: "cancel" },
            {
              text: "同意并继续",
              onPress: () => {
                void giveConsent()
                  .then(() => generate(kind, fresh))
                  .catch((e) => setError(messageOf(e)));
              },
            },
          ],
        );
        return;
      }
      setBusy(true);
      setError("");
      setLastKind(kind);
      abort.current = new AbortController();
      const snapshot = latest.current,
        fp = sourceFingerprint(snapshot.draft, snapshot.media);
      const selected = photoDayGroups(snapshot.draft, snapshot.media)[
        eventIndex
      ];
      const ids = (
        kind === "write"
          ? (selected?.mediaIds ?? [])
          : snapshot.draft.content.mediaIds
      ).filter((id) => snapshot.media[id]?.kind === "image");
      if (!ids.length) throw new Error("请先为这件事添加照片。");
      if (ids.length > 100)
        throw new Error("一次最多整理 100 张照片，请分几份草稿处理。");
      setProgress("正在读取 AI 配置…");
      const config = await api<Config>(
        "/ai/config",
        undefined,
        "GET",
        abort.current.signal,
      );
      const preferred = await getPreferredModel(),
        model =
          preferred && config.enabledModels.includes(preferred)
            ? preferred
            : config.defaultModel;
      const previous = snapshot.draft.aiJob;
      const job: AIJob =
        !fresh &&
        previous?.fingerprint === fp &&
        previous.kind === kind &&
        previous.eventIndex === eventIndex &&
        previous.model === model
          ? JSON.parse(JSON.stringify(previous))
          : { fingerprint: fp, kind, eventIndex, model, steps: [] };
      const places = localPlaceTags(ids, snapshot.media);
      const context =
        kind === "write"
          ? [selected?.title, selected?.text]
              .filter(Boolean)
              .join("\n")
              .slice(0, 3500)
          : "";
      const check = () => {
        if (abort.current?.signal.aborted)
          throw new AIError("CANCELED", "已停止等待，草稿不变。");
      };
      const perform = async (
        key: string,
        operation: "group" | "write",
        photoIds: string[],
        extra: Record<string, unknown> = {},
      ): Promise<AIResult> => {
        check();
        let step = job.steps.find((s) => s.key === key);
        if (step?.result) return step.result;
        if (!step) {
          step = { key, requestId: randomUUID() };
          job.steps.push(step);
          await onPatch({ aiJob: JSON.parse(JSON.stringify(job)) });
        }
        const photos = [];
        for (const id of photoIds) {
          check();
          const item = snapshot.media[id]!;
          photos.push({
            id,
            date: item.photoMetadata?.capturedAt,
            place: places.get(id),
            image: await thumbnail(item),
          });
        }
        check();
        const result = await api<AIResult>(
          `/ai/${operation}`,
          { requestId: step.requestId, model, photos, ...extra },
          "POST",
          abort.current!.signal,
        );
        const expected =
          extra.mode === "merge"
            ? (extra.groups as AIGroup[]).flatMap((g) => g.photoIds)
            : photoIds;
        const valid = validateResult(result, operation, expected);
        step.result = valid;
        await onPatch({ aiJob: JSON.parse(JSON.stringify(job)) });
        return valid;
      };
      let result: AIResult;
      if (kind === "write" && ids.length <= 20) {
        setProgress(`正在用 ${model} 写记录…`);
        result = await perform("write", "write", ids, { context });
      } else {
        const daySets = sameDayChunks(ids, snapshot.media),
          allGroups: AIGroup[] = [];
        const total = daySets.reduce((n, day) => n + day.chunks.length, 0);
        let count = 0;
        for (const day of daySets) {
          const groups: AIGroup[] = [];
          for (let i = 0; i < day.chunks.length; i++) {
            setProgress(`正在分析第 ${++count}/${total} 批照片…`);
            groups.push(
              ...(await perform(`${day.day}-${i}`, "group", day.chunks[i]!))
                .groups!,
            );
          }
          if (day.chunks.length > 1) {
            setProgress("正在连接同一天的事情…");
            allGroups.push(
              ...(
                await perform(`merge-${day.day}`, "group", [], {
                  mode: "merge",
                  groups,
                })
              ).groups!,
            );
          } else allGroups.push(...groups);
        }
        if (kind === "group")
          result = validateResult({ groups: allGroups }, "group", ids);
        else {
          setProgress("正在根据整组照片写记录…");
          const summaries = allGroups
            .map((g) => `${g.title}：${g.summary.slice(0, 100)}`)
            .join("\n")
            .slice(0, 2000);
          result = await perform("write", "write", ids.slice(0, 1), {
            context: `${context.slice(0, 1500)}\n照片分析摘要（仅作参考）：\n${summaries}`,
          });
        }
      }
      check();
      await onPatch({
        aiProposal: { ...result, fingerprint: fp, kind, eventIndex, model },
      });
      setProgress("建议已保存，请预览后采用。");
    } catch (e) {
      setError(messageOf(e));
    } finally {
      active.current = false;
      setBusy(false);
      abort.current = null;
    }
  };
  const apply = async (part?: "title" | "text") => {
    if (!proposal) return;
    try {
      await onApply(proposal, part);
      setError("");
      setProgress("已采用，保存记录后生效。");
    } catch (e) {
      setError(messageOf(e));
    }
  };
  return (
    <View style={s.section}>
      <Text>AI 帮你整理</Text>
      <Text style={s.muted}>
        先给建议，你确认后再保存。只分析当前草稿中参与整理的照片。
      </Text>
      <Button
        title="AI 设置 / 选择模型"
        disabled={busy || disabled}
        onPress={() => nav.navigate("AISettings")}
      />
      {!draft.recordId && (
        <Button
          title="AI 按事情分组"
          disabled={busy || disabled}
          onPress={() => {
            void generate("group");
          }}
        />
      )}
      {events.length > 1 && (
        <>
          <Text style={s.muted}>选择要写文案的事情</Text>
          {events.map((event, index) => (
            <Button
              key={index}
              title={`事情 ${index + 1}${event.title ? `：${event.title}` : ""}`}
              selected={eventIndex === index}
              disabled={busy || disabled}
              onPress={() => setEventIndex(index)}
            />
          ))}
        </>
      )}
      <Button
        title="帮这件事写记录"
        disabled={busy || disabled}
        onPress={() => {
          void generate("write");
        }}
      />
      {!!progress && (
        <Text style={s.muted} accessibilityLiveRegion="polite">
          {progress}
        </Text>
      )}
      {busy && (
        <Button title="停止等待" onPress={() => abort.current?.abort()} />
      )}
      <ErrorText message={error} />
      {!!error && !busy && (
        <>
          <Button
            title="重试原请求"
            disabled={disabled}
            onPress={() => {
              void generate(lastKind);
            }}
          />
          <Button
            title="重新生成（使用新的额度）"
            disabled={disabled}
            onPress={() => {
              void generate(lastKind, true);
            }}
          />
        </>
      )}
      {proposal && (
        <View style={s.section}>
          <Text>AI 建议 · {proposal.model}</Text>
          {proposal.kind === "group" ? (
            proposal.groups?.map((group, index) => (
              <View key={index} style={{ gap: 4 }}>
                <Text>
                  {index + 1}. {group.title} · {group.photoIds.length} 张
                </Text>
                <Text style={s.muted}>{group.summary}</Text>
              </View>
            ))
          ) : (
            <>
              <Text>{proposal.title}</Text>
              <Text>{proposal.text}</Text>
            </>
          )}
          <Button
            title={
              proposal.kind === "group" ? "采用分组建议" : "采用标题和正文"
            }
            primary
            disabled={busy || disabled}
            onPress={() => {
              void apply();
            }}
          />
          {proposal.kind === "write" && (
            <>
              <Button
                title="只采用标题"
                disabled={busy || disabled}
                onPress={() => {
                  void apply("title");
                }}
              />
              <Button
                title="只采用正文"
                disabled={busy || disabled}
                onPress={() => {
                  void apply("text");
                }}
              />
            </>
          )}
          <Button
            title="放弃这份建议"
            disabled={busy || disabled}
            onPress={() => {
              void onPatch({ aiProposal: undefined }).catch((e) =>
                setError(messageOf(e)),
              );
            }}
          />
        </View>
      )}
    </View>
  );
}
