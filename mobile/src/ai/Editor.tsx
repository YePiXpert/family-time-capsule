import { useEffect, useRef, useState } from "react";
import { Alert, ScrollView, View } from "react-native";
import { randomUUID } from "expo-crypto";
import type { Library, RecordDraft } from "../local/model";
import { photoDayGroups } from "../local/photo-metadata";
import {
  Button,
  ErrorText,
  Text,
  useStyles,
  messageOf,
  dateLabel,
} from "../local/ui";
import { useNav } from "../local/navigation";
import { api, getToken, hasConsent, giveConsent, AIError } from "./client";
import { Photo } from "../local/Media";
import { thumbnail } from "./images";
import {
  sourceFingerprint,
  sameDayChunks,
  validateResult,
  localPlaceTags,
} from "./state";
import type { AIGroup, AIJob, AIProposal, AIResult } from "./types";
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
    [chosenEventIndex, setEventIndex] = useState(0),
    [task, setTask] = useState<"group" | "write">(
      draft.aiProposal?.kind ??
        (draft.recordId ||
        draft.content.mediaIds.filter((id) => media[id]?.kind === "image")
          .length < 2
          ? "write"
          : "group"),
    ),
    [lastKind, setLastKind] = useState<"group" | "write">("group");
  const active = useRef(false),
    abort = useRef<AbortController | null>(null),
    latest = useRef({ draft, media });
  useEffect(() => {
    latest.current = { draft, media };
  }, [draft, media]);
  useEffect(() => () => abort.current?.abort(), []);
  const events = photoDayGroups(draft, media),
    proposal = draft.aiProposal,
    eventIndex = Math.min(chosenEventIndex, Math.max(0, events.length - 1));
  const chooseTask = (kind: "group" | "write") => {
    setTask(kind);
    setError("");
    setProgress("");
  };
  const photoStrip = (ids: string[]) => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator
      contentContainerStyle={{ gap: 8 }}
    >
      {ids
        .filter((id) => media[id]?.kind === "image")
        .map((id) => (
          <Photo key={id} media={media[id]} size={72} />
        ))}
    </ScrollView>
  );
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
          "将把这份草稿中参与分析的照片缩略图、拍摄时间及相关文字，经主人的服务发送给 DeepSeek Flash High。原图和精确 GPS 不发送，结果由你确认。",
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
      // A profile change starts a new job; old partial results stay in the draft.
      const model = "deepseek-flash:high";
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
          { requestId: step.requestId, photos, ...extra },
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
        setProgress("正在生成这件事的标题和正文…");
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
      if (proposal.kind === "group") {
        setTask("write");
        setEventIndex(0);
        setProgress("照片已分好，选一件事写记录，也可以直接保存。");
      } else setProgress("标题和正文已填入，保存记录后生效。");
    } catch (e) {
      setError(messageOf(e));
    }
  };
  const pendingOtherTask = proposal && proposal.kind !== task;
  const selectedEvent = events[eventIndex];
  return (
    <View style={s.section}>
      <Text>AI 帮你整理</Text>
      {!draft.recordId && (
        <View style={s.row}>
          <Button
            title="分照片"
            selected={task === "group"}
            disabled={busy || disabled}
            onPress={() => chooseTask("group")}
          />
          <Button
            title="写记录"
            selected={task === "write"}
            disabled={busy || disabled}
            onPress={() => chooseTask("write")}
          />
        </View>
      )}
      {task === "group" ? (
        <>
          <Text>把照片分成几件事</Text>
          <Text style={s.muted}>
            根据拍摄时间和画面整理照片，同一天可以有多件事。每件事保存为一条记录。
          </Text>
          <Button
            title="按事情分照片"
            disabled={busy || disabled || !!pendingOtherTask}
            onPress={() => {
              void generate("group");
            }}
          />
        </>
      ) : (
        <>
          <Text>给一件事写标题和正文</Text>
          <Text style={s.muted}>
            选好照片所属的事情，生成后预览，再填入这件事的记录。
          </Text>
          {events.length > 1 &&
            events.map((event, index) => (
              <Button
                key={index}
                title={`事情 ${index + 1}${event.title ? `：${event.title}` : ""} · ${dateLabel(event.date)} · ${event.mediaIds.filter((id) => media[id]?.kind === "image").length} 张照片`}
                selected={eventIndex === index}
                disabled={busy || disabled || proposal?.kind === "write"}
                onPress={() => setEventIndex(index)}
              />
            ))}
          {selectedEvent && (
            <View style={{ gap: 8 }}>
              <Text style={s.muted}>
                本次写记录的照片 · 事情 {eventIndex + 1}
              </Text>
              {photoStrip(selectedEvent.mediaIds)}
            </View>
          )}
          <Button
            title="帮这件事写记录"
            disabled={busy || disabled || !!pendingOtherTask}
            onPress={() => {
              void generate("write");
            }}
          />
        </>
      )}
      {pendingOtherTask && (
        <View style={{ gap: 8 }}>
          <Text style={s.muted}>
            还有一份{proposal.kind === "group" ? "分组" : "标题和正文"}
            建议待确认。
          </Text>
          <Button
            title={
              proposal.kind === "group" ? "查看分组建议" : "查看标题和正文"
            }
            onPress={() => chooseTask(proposal.kind)}
            disabled={busy || disabled}
          />
        </View>
      )}
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
      {proposal && proposal.kind === task && (
        <View style={s.section}>
          {proposal.kind === "group" ? (
            <>
              <Text>分组预览 · {proposal.groups?.length} 件事</Text>
              <Text style={s.muted}>
                核对每件事包含的照片。画面摘要帮助辨认分组，记录正文在「写记录」中生成。
              </Text>
              {proposal.groups?.map((group, index) => (
                <View key={index} style={{ gap: 8 }}>
                  <Text>
                    事情 {index + 1}：{group.title} · {group.photoIds.length} 张
                  </Text>
                  {photoStrip(group.photoIds)}
                  <Text style={s.muted}>画面摘要：{group.summary}</Text>
                </View>
              ))}
            </>
          ) : (
            <>
              <Text>事情 {proposal.eventIndex + 1} · 文字预览</Text>
              <Text style={s.muted}>标题</Text>
              <Text>{proposal.title}</Text>
              <Text style={s.muted}>正文</Text>
              <Text>{proposal.text}</Text>
            </>
          )}
          <Button
            title={
              proposal.kind === "group" ? "确认照片分组" : "填入标题和正文"
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
                title="只填入标题"
                disabled={busy || disabled}
                onPress={() => {
                  void apply("title");
                }}
              />
              <Button
                title="只填入正文"
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
      <Text style={s.muted}>DeepSeek Flash High</Text>
    </View>
  );
}
