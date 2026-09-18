import { useEffect, useRef, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { randomUUID } from "expo-crypto";
import type { Library, RecordDraft } from "../local/model";
import { photoDayGroups } from "../local/photo-metadata";
import {
  Button,
  Card,
  ErrorText,
  Glass,
  Text,
  useStyles,
  messageOf,
  dateLabel,
  useTheme,
} from "../local/ui";
import { useNav } from "../local/navigation";
import { JournalIcon } from "../components/JournalIcon";
import { api, getToken, hasConsent, giveConsent, AIError } from "./client";
import { Photo } from "../local/Media";
import { thumbnail } from "./images";
import {
  sourceFingerprint,
  sameDayChunks,
  sameJob,
  polishRequest,
  moveProposalPhoto,
  requestImageIds,
  retryPlan,
  validateResult,
  localPlaceTags,
} from "./state";
import type { AIGroup, AIJob, AIProposal, AIResult, WritingMode } from "./types";
type Patch = Partial<Pick<RecordDraft, "aiJob" | "aiProposal">>;
type Run = { kind: "group" | "write"; mode: WritingMode };
const modeOf = (proposal: AIProposal): WritingMode =>
  proposal.writingMode ?? "generate";
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
    nav = useNav(),
    { colors } = useTheme(),
    insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false),
    [seen, setSeen] = useState(false),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(""),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [chosenEventIndex, setEventIndex] = useState(0),
    [task, setTask] = useState<"group" | "write">(
      draft.aiProposal?.kind ?? "write",
    ),
    [writeMode, setWriteMode] = useState<WritingMode>(
      draft.aiProposal?.kind === "write" ? modeOf(draft.aiProposal) : "generate",
    ),
    [retryable, setRetryable] = useState<Run | null>(null),
    [errorCode, setErrorCode] = useState<string | null>(null),
    [adjusting, setAdjusting] = useState(false);
  const active = useRef(false),
    openRef = useRef(false),
    abort = useRef<AbortController | null>(null),
    latest = useRef({ draft, media });
  // 面板是否打开要能同步读取：结果可能在收起面板之后才返回。
  const setPanel = (value: boolean) => {
    openRef.current = value;
    setOpen(value);
    if (value) setSeen(true);
  };
  useEffect(() => {
    latest.current = { draft, media };
  }, [draft, media]);
  useEffect(() => () => abort.current?.abort(), []);
  const events = photoDayGroups(draft, media),
    proposal = draft.aiProposal,
    eventIndex = Math.min(chosenEventIndex, Math.max(0, events.length - 1)),
    selectedEvent = events[eventIndex],
    totalImages = draft.content.mediaIds.filter(
      (id) => media[id]?.kind === "image",
    ),
    eventImages = (selectedEvent?.mediaIds ?? []).filter(
      (id) => media[id]?.kind === "image",
    ),
    stale = !!proposal && sourceFingerprint(draft, media) !== proposal.fingerprint,
    unseen = !!proposal && !seen;
  const chooseTask = (kind: "group" | "write") => {
    setTask(kind);
    setError("");
    setProgress("");
  };
  const chooseWriteMode = (mode: WritingMode) => {
    // 必须在写记录任务下预览，否则生成完成后结果不会展示。
    setTask("write");
    setWriteMode(mode);
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
  const generate = async (
    kind: "group" | "write",
    mode: WritingMode = "generate",
    fresh = false,
  ) => {
    if (active.current || disabled) return;
    active.current = true;
    try {
      if (!(await getToken())) {
        // 先收起面板，避免它盖在 AI 设置页上。
        setPanel(false);
        nav.navigate("AISettings");
        return;
      }
      if (!(await hasConsent())) {
        Alert.alert(
          "使用 AI 整理",
          "生成和分组会把这件事的照片缩略图、拍摄时间及相关文字，润色只把标题和正文，经主人的服务发送给 DeepSeek Flash High。原图和精确 GPS 不发送，结果由你确认。",
          [
            { text: "取消", style: "cancel" },
            {
              text: "同意并继续",
              onPress: () => {
                void giveConsent()
                  .then(() => generate(kind, mode, fresh))
                  .catch((e) => setError(messageOf(e)));
              },
            },
          ],
        );
        return;
      }
      setBusy(true);
      setError("");
      setNotice("");
      setRetryable(null);
      setErrorCode(null);
      abort.current = new AbortController();
      const snapshot = latest.current,
        fp = sourceFingerprint(snapshot.draft, snapshot.media);
      const snapshotEvents = photoDayGroups(snapshot.draft, snapshot.media),
        selected =
          snapshotEvents[
            Math.min(eventIndex, Math.max(0, snapshotEvents.length - 1))
          ];
      const ids = requestImageIds(
        kind,
        selected?.mediaIds,
        snapshot.draft,
        snapshot.media,
      );
      if (kind === "group") {
        if (snapshot.draft.recordId)
          throw new Error(
            "按事情分组只在整理新建草稿的照片时使用，已保存的记录请用「调整归属」。",
          );
        if (ids.length < 2)
          throw new Error("按事情分组至少需要两张照片，先再多选几张。");
      }
      if (kind === "write" && mode === "polish") {
        const request = polishRequest({
          title: selected?.title ?? "",
          text: selected?.text ?? "",
        });
        if (request.error) throw new Error(request.error);
      } else if (kind === "write") {
        if (!ids.length)
          throw new Error(
            "这件事还没有照片。先添加照片再生成，或写下文字后用「润色我的文字」。",
          );
        if (ids.length > 100)
          throw new Error("一次最多整理 100 张照片，请分几份草稿处理。");
      }
      // A profile change starts a new job; old partial results stay in the draft.
      const model = "deepseek-flash:high";
      const jobSpec = {
        fingerprint: fp,
        kind,
        eventIndex,
        model,
        ...(kind === "write" ? { writingMode: mode } : {}),
      };
      const previous = snapshot.draft.aiJob;
      const job: AIJob = !fresh && sameJob(previous, jobSpec)
        ? JSON.parse(JSON.stringify(previous))
        : { ...jobSpec, steps: [] };
      const places = localPlaceTags(
        kind === "write" ? ids : snapshot.draft.content.mediaIds,
        snapshot.media,
      );
      const rawWrite = [selected?.title, selected?.text]
        .filter(Boolean)
        .join("\n");
      const context = kind === "write" ? rawWrite.slice(0, 3500) : "";
      // 只把前一段发给 AI，本机内容不变；超限必须说明，不静默截断。
      const clipped = (limit: number) =>
        rawWrite.length > limit
          ? `正文较长，本次只把前 ${limit} 字发给 AI，本机内容不变。`
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
      // 本地校验通过后才值得重试；参数错误重试也不会成功。
      setRetryable({ kind, mode });
      if (kind === "write" && mode === "polish") {
        const request = polishRequest({
          title: selected?.title ?? "",
          text: selected?.text ?? "",
        });
        setProgress("正在润色这段文字…");
        result = await perform("polish", "write", [], {
          context: request.context,
          writingMode: "polish",
        });
      } else if (kind === "write" && ids.length <= 20) {
        setNotice(clipped(3500));
        setProgress("正在生成这件事的标题和正文…");
        result = await perform("write", "write", ids, {
          context,
          writingMode: "generate",
        });
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
          if (kind === "write") setNotice(clipped(1500));
          setProgress("正在根据整组照片写记录…");
          const summaries = allGroups
            .map((g) => `${g.title}：${g.summary.slice(0, 100)}`)
            .join("\n")
            .slice(0, 2000);
          result = await perform("write", "write", ids.slice(0, 1), {
            context: `${context.slice(0, 1500)}\n照片分析摘要（仅作参考）：\n${summaries}`,
            writingMode: "generate",
          });
        }
      }
      check();
      await onPatch({
        aiProposal: {
          ...result,
          fingerprint: fp,
          kind,
          eventIndex,
          model,
          ...(kind === "write" ? { writingMode: mode } : {}),
        },
      });
      // 面板仍打开时用户正看着结果；收起后才返回的结果用图标小圆点提示。
      setSeen(openRef.current);
      setProgress(
        kind === "group"
          ? "分组建议已保存，核对后确认。"
          : mode === "polish"
            ? "润色结果已保存，与原文对照后采用。"
            : "建议已保存，请预览后采用。",
      );
    } catch (e) {
      setError(messageOf(e));
      setErrorCode(e instanceof AIError ? e.code : null);
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
      setAdjusting(false);
      if (proposal.kind === "group") {
        setTask("write");
        setWriteMode("generate");
        setEventIndex(0);
        setProgress("照片已分好，选一件事写记录，也可以直接保存。");
      } else setProgress("已填入草稿，保存记录后生效。");
    } catch (e) {
      setError(messageOf(e));
    }
  };
  const matchesView =
    !!proposal &&
    (proposal.kind === task
      ? task === "group" || modeOf(proposal) === writeMode
      : false);
  const pendingOther =
    !!proposal &&
    (proposal.kind !== task ||
      (task === "write" && modeOf(proposal) !== writeMode));
  const viewProposal = () => {
    if (!proposal) return;
    setTask(proposal.kind);
    if (proposal.kind === "write") setWriteMode(modeOf(proposal));
    setSeen(true);
    setError("");
    setProgress("");
  };
  const movePhoto = (id: string, target: number) => {
    if (!proposal) return;
    void onPatch({ aiProposal: moveProposalPhoto(proposal, id, target) }).catch(
      (e) => setError(messageOf(e)),
    );
  };
  const sheet = (
    <Modal
      visible={open}
      animationType="slide"
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={() => setPanel(false)}
    >
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="收起 AI 面板"
          testID="ai-close"
          style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: colors.scrim }}
          onPress={() => setPanel(false)}
        />
        <Glass
          radius={24}
          accessibilityViewIsModal
          style={{
            maxHeight: "82%",
            paddingTop: 16,
            paddingHorizontal: 20,
            paddingBottom: insets.bottom + 12,
          }}
        >
          <View style={s.between}>
            <Text style={s.heading}>AI 帮你整理</Text>
            <Button
              title="收起"
              compact
              testID="ai-collapse"
              onPress={() => setPanel(false)}
            />
          </View>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ gap: 12, paddingTop: 12, paddingBottom: 8 }}
          >
            <View style={{ gap: 8 }}>
              <Text style={s.muted}>写记录</Text>
              <View style={s.row}>
                <Button
                  title="AI 生成"
                  icon="sparkle"
                  compact
                  selected={task === "write" && writeMode === "generate"}
                  testID="ai-generate"
                  disabled={busy || disabled}
                  onPress={() => {
                    chooseWriteMode("generate");
                    void generate("write", "generate");
                  }}
                />
                <Button
                  title="润色我的文字"
                  icon="edit"
                  compact
                  selected={task === "write" && writeMode === "polish"}
                  testID="ai-polish"
                  disabled={busy || disabled}
                  onPress={() => {
                    chooseWriteMode("polish");
                    void generate("write", "polish");
                  }}
                />
              </View>
              <Text style={s.muted}>
                {writeMode === "generate"
                  ? task === "write" && !eventImages.length
                    ? "这件事还没有照片，暂不能生成。先添加照片，或写下文字后改用润色。"
                    : "根据这件事的照片和已知拍摄信息，写出短标题和一小段正文。"
                  : !selectedEvent?.text.trim()
                    ? "还没有可润色的正文。先写下几句话，再来润色。"
                    : polishRequest({
                        title: selectedEvent?.title ?? "",
                        text: selectedEvent?.text ?? "",
                      }).error ??
                      "只发送这件事的标题和正文，保留你的原意、语气和事实，不发送照片。"}
              </Text>
              {events.length > 1 && task === "write" && (
                <View style={{ gap: 8 }}>
                  <Text style={s.muted}>先选择要处理的事情</Text>
                  {events.map((event, index) => (
                    <Button
                      key={index}
                      title={`事情 ${index + 1}${event.title ? `：${event.title}` : ""} · ${dateLabel(event.date)}`}
                      compact
                      selected={eventIndex === index}
                      disabled={busy || disabled || matchesView}
                      onPress={() => setEventIndex(index)}
                    />
                  ))}
                </View>
              )}
              {task === "write" && !!eventImages.length && (
                <View style={{ gap: 8 }}>
                  <Text style={s.muted}>
                    本次的照片 · 事情 {eventIndex + 1}
                  </Text>
                  {photoStrip(selectedEvent!.mediaIds)}
                </View>
              )}
            </View>
            {!draft.recordId && (
              <View style={{ gap: 8 }}>
                <Text style={s.muted}>整理照片</Text>
                <Button
                  title="按事情分组"
                  icon="image"
                  compact
                  selected={task === "group"}
                  testID="ai-group"
                  disabled={busy || disabled}
                  onPress={() => {
                    chooseTask("group");
                    void generate("group");
                  }}
                />
                <Text style={s.muted}>
                  {totalImages.length < 2
                    ? "至少需要两张照片才能按事情分组。"
                    : "结合拍摄时间、匿名地点组和画面，把照片分成几件事，每件事保存为一条记录。"}
                </Text>
              </View>
            )}
            {pendingOther && !matchesView && (
              <View style={{ gap: 8 }}>
                <Text style={s.muted}>
                  还有一份
                  {proposal!.kind === "group"
                    ? "分组"
                    : modeOf(proposal!) === "polish"
                      ? "润色"
                      : "生成"}
                  建议待确认。
                </Text>
                <Button
                  title={
                    proposal!.kind === "group"
                      ? "查看分组建议"
                      : modeOf(proposal!) === "polish"
                        ? "查看润色建议"
                        : "查看生成建议"
                  }
                  compact
                  disabled={busy || disabled}
                  onPress={viewProposal}
                />
              </View>
            )}
            {!!progress && (
              <Text style={s.muted} accessibilityLiveRegion="polite">
                {progress}
              </Text>
            )}
            {!!notice && <Text style={s.muted}>{notice}</Text>}
            {busy && (
              <Button title="停止等待" onPress={() => abort.current?.abort()} />
            )}
            <ErrorText message={error} />
            {!!error && !busy && retryable && (
              <Card>
                {!retryPlan(errorCode).retryOriginal && (
                  <Text style={s.muted}>{retryPlan(errorCode).notice}</Text>
                )}
                <View style={s.row}>
                  {retryPlan(errorCode).retryOriginal && (
                    <Button
                      title="重试原请求"
                      compact
                      disabled={disabled}
                      onPress={() => {
                        void generate(retryable.kind, retryable.mode);
                      }}
                    />
                  )}
                  <Button
                    title="重新生成（使用新的额度）"
                    compact
                    disabled={disabled}
                    onPress={() => {
                      void generate(retryable.kind, retryable.mode, true);
                    }}
                  />
                </View>
              </Card>
            )}
            {matchesView && proposal && (
              <Card>
                {stale && (
                  <Text style={{ color: colors.error }}>
                    你已修改照片或文字，这份建议已过期。重新生成后再采用，当前编辑已保留。
                  </Text>
                )}
                {proposal.kind === "group" ? (
                  <>
                    <Text>
                      分组预览 · {proposal.groups?.length} 件事
                    </Text>
                    <Text style={s.muted}>
                      核对每件事包含的照片；摘要只帮助辨认分组，不会写入记录正文。
                    </Text>
                    {adjusting ? (
                      proposal.groups?.map((group, index) => (
                        <View key={index} style={{ gap: 8 }}>
                          <Text>
                            事情 {index + 1}：{group.title}
                          </Text>
                          {group.photoIds.map((id) => (
                            <View
                              key={id}
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                                gap: 8,
                              }}
                            >
                              <Photo media={media[id]} size={48} />
                              <ScrollView
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                contentContainerStyle={{ gap: 8 }}
                              >
                                {proposal.groups!.map((_, target) =>
                                  target === index ? null : (
                                    <Button
                                      key={target}
                                      title={`移到事情 ${target + 1}`}
                                      compact
                                      disabled={busy}
                                      onPress={() => movePhoto(id, target)}
                                    />
                                  ),
                                )}
                              </ScrollView>
                            </View>
                          ))}
                        </View>
                      ))
                    ) : (
                      proposal.groups?.map((group, index) => (
                        <View key={index} style={{ gap: 8 }}>
                          <Text>
                            事情 {index + 1}：{group.title} ·{" "}
                            {group.photoIds.length} 张
                          </Text>
                          {photoStrip(group.photoIds)}
                          <Text style={s.muted}>画面摘要：{group.summary}</Text>
                        </View>
                      ))
                    )}
                    <Button
                      title={adjusting ? "完成调整" : "调整照片归属"}
                      compact
                      disabled={busy || disabled}
                      onPress={() => setAdjusting(!adjusting)}
                    />
                    <Button
                      title="确认照片分组"
                      primary
                      disabled={busy || disabled || stale || adjusting}
                      onPress={() => {
                        void apply();
                      }}
                    />
                  </>
                ) : modeOf(proposal) === "polish" ? (
                  <>
                    <Text>润色预览 · 与原文对照</Text>
                    {!stale ? (
                      <>
                        <Text style={s.muted}>你的原文</Text>
                        {!!selectedEvent?.title.trim() && (
                          <Text>{selectedEvent.title}</Text>
                        )}
                        <Text>{selectedEvent?.text}</Text>
                        <View style={s.line} />
                      </>
                    ) : null}
                    <Text style={s.muted}>润色后</Text>
                    <Text>{proposal.title}</Text>
                    <Text>{proposal.text}</Text>
                    <Button
                      title="采用润色结果"
                      primary
                      disabled={busy || disabled || stale}
                      onPress={() => {
                        void apply();
                      }}
                    />
                    <Button
                      title="只采用标题"
                      compact
                      disabled={busy || disabled || stale}
                      onPress={() => {
                        void apply("title");
                      }}
                    />
                    <Button
                      title="只采用正文"
                      compact
                      disabled={busy || disabled || stale}
                      onPress={() => {
                        void apply("text");
                      }}
                    />
                  </>
                ) : (
                  <>
                    <Text>
                      事情 {proposal.eventIndex + 1} · 文字预览
                    </Text>
                    <Text style={s.muted}>标题</Text>
                    <Text>{proposal.title}</Text>
                    <Text style={s.muted}>正文</Text>
                    <Text>{proposal.text}</Text>
                    <Button
                      title="填入标题和正文"
                      primary
                      disabled={busy || disabled || stale}
                      onPress={() => {
                        void apply();
                      }}
                    />
                    <Button
                      title="只填入标题"
                      compact
                      disabled={busy || disabled || stale}
                      onPress={() => {
                        void apply("title");
                      }}
                    />
                    <Button
                      title="只填入正文"
                      compact
                      disabled={busy || disabled || stale}
                      onPress={() => {
                        void apply("text");
                      }}
                    />
                  </>
                )}
                <Button
                  title="放弃这份建议"
                  compact
                  disabled={busy || disabled}
                  onPress={() => {
                    setAdjusting(false);
                    void onPatch({ aiProposal: undefined }).catch((e) =>
                      setError(messageOf(e)),
                    );
                  }}
                />
              </Card>
            )}
            <Text style={s.muted}>DeepSeek Flash High</Text>
          </ScrollView>
        </Glass>
      </View>
    </Modal>
  );
  return (
    <View>
      <Pressable
        testID="ai-open"
        accessibilityRole="button"
        accessibilityLabel={unseen ? "AI 助手，有结果待查看" : "AI 助手"}
        accessibilityState={{ selected: open }}
        disabled={disabled}
        onPress={() => setPanel(true)}
        style={({ pressed }) => ({
          width: 44,
          height: 44,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 22,
          backgroundColor: open ? colors.selectedGlass : "transparent",
          opacity: pressed || disabled ? 0.6 : 1,
        })}
      >
        <View>
          <JournalIcon name="sparkle" color={colors.accent} size={22} />
          {unseen && (
            <View
              style={{
                position: "absolute",
                top: -2,
                right: -4,
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: colors.accent,
              }}
            />
          )}
        </View>
      </Pressable>
      {sheet}
    </View>
  );
}
