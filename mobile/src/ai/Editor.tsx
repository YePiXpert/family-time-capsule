import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { randomUUID } from "expo-crypto";
import { compareDates, type RecordDraft } from "../local/model";
import { useLibrary } from "../local/context";
import { ageLine } from "../local/dates";
import {
  Button,
  Card,
  ErrorText,
  SheetModal,
  Text,
  ToolButton,
  hapticSuccess,
  messageOf,
  useStyles,
  useTheme,
} from "../local/ui";
import { useNav } from "../local/navigation";
import { JournalIcon } from "../components/JournalIcon";
import { api, getToken, AIError } from "./client";
import {
  askContext,
  sourceFingerprint,
  polishRequest,
  retryPlan,
  validateResult,
} from "./state";
import {
  assertGenerateInput,
  matchesCurrentView,
  modeOf,
  pendingOtherProposal,
  planStep,
  reuseJob,
  runSpec,
  successProgress,
} from "./plan";
import type { AIProposal, AIResult, WritingMode } from "./types";
type Patch = Partial<Pick<RecordDraft, "aiJob" | "aiProposal" | "content">>;
type EditorMode = Extract<WritingMode, "polish" | "ask">;
type Run = { mode: EditorMode };
export function AIEditor({
  draft,
  disabled,
  onPatch,
  onApply,
  tool = false,
}: {
  draft: RecordDraft;
  disabled: boolean;
  onPatch: (patch: Patch) => Promise<unknown>;
  onApply: (proposal: AIProposal, part?: "title" | "text") => Promise<unknown>;
  /** 工具栏形态：共用 ToolButton 的标签、字号与状态。 */
  tool?: boolean;
}) {
  const library = useLibrary();
  const s = useStyles(),
    nav = useNav(),
    { colors } = useTheme();
  const [interview, setInterview] = useState<{ questions: string[]; first: boolean; target: string } | null>(null);
  const [open, setOpen] = useState(false),
    [seen, setSeen] = useState(false),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(""),
    [error, setError] = useState(""),
    [writeMode, setWriteMode] = useState<WritingMode>(
      draft.aiProposal?.kind === "write"
        ? modeOf(draft.aiProposal)
        : "polish",
    ),
    [retryable, setRetryable] = useState<Run | null>(null),
    [errorCode, setErrorCode] = useState<string | null>(null);
  const active = useRef(false),
    openRef = useRef(false),
    abort = useRef<AbortController | null>(null),
    latest = useRef({ draft }),
    openButton = useRef<View>(null);
  // 面板是否打开要能同步读取：结果可能在收起面板之后才返回。
  const setPanel = (value: boolean) => {
    openRef.current = value;
    setOpen(value);
    if (value) setSeen(true);
  };
  useEffect(() => {
    latest.current = { draft };
  }, [draft]);
  useEffect(() => () => abort.current?.abort(), []);
  const proposal = draft.aiProposal,
    selectedEvent = draft.content,
    stale =
      !!proposal && sourceFingerprint(draft) !== proposal.fingerprint,
    unseen = !!proposal && !seen;
  const targetOf = (d: RecordDraft) => d.id;
  const interviewTarget = targetOf(draft);
  const visibleInterview = interview?.target === interviewTarget ? interview : null;
  const applyQuestion = async (questionIndex?: number) => {
    if (active.current || disabled || !visibleInterview) return;
    const question = questionIndex === undefined ? undefined : visibleInterview.questions[questionIndex];
    active.current = true;
    try {
      const { draft: d } = latest.current;
      const event = d.content;
      if (targetOf(d) !== visibleInterview.target) return;
      const text = question ? `${event.text}${event.text ? "\n\n" : ""}问：${question}\n` : event.text;
      await onPatch({ content: { ...d.content, text, ...(!question ? { first: true } : {}) } });
      setInterview((old) => old ? { ...old, questions: old.questions.filter((_, index) => index !== questionIndex), first: question ? old.first : false } : null);
    } catch (e) { setError(messageOf(e)); }
    finally { active.current = false; }
  };
  const chooseWriteMode = (mode: EditorMode) => {
    setWriteMode(mode);
    setError("");
    setProgress("");
  };
  const requestWriting = async (
    mode: EditorMode = "polish",
    fresh = false,
  ) => {
    if (active.current || disabled) return;
    active.current = true;
    // 读令牌时也能被卸载清理取消，避免离开编辑页后才发出请求。
    abort.current = new AbortController();
    try {
      const token = await getToken();
      if (abort.current.signal.aborted) return;
      if (!token) {
        // 这台手机还没加入家庭：先收起面板，带去「家庭与同步」加入。
        setPanel(false);
        nav.navigate("Family");
        return;
      }
      setBusy(true);
      setError("");
      setRetryable(null);
      setErrorCode(null);
      const snapshot = latest.current,
        fp = sourceFingerprint(snapshot.draft);
      const selected = snapshot.draft.content;
      if (mode === "ask") {
        if (!selected || !(selected.title.trim() || selected.text.trim())) throw new Error("先写几句，AI 才有得问。");
        setInterview(null);
        setProgress("正在想问题…");
        const result = validateResult(await api("/ai/write", {
          requestId: randomUUID(), photos: [], writingMode: "ask",
          context: askContext({
            by: snapshot.draft.content.by,
            ageLabel: ageLine(library.profile.birthday, new Date(selected.date))?.split(" · ")[0] ?? null,
            date: selected.date, title: selected.title, text: selected.text, first: selected.first,
            recent: Object.values(library.records).filter((r) => r.id !== snapshot.draft.recordId).sort((a, b) => compareDates(b.date, a.date)).slice(0, 10).map(({ title, date }) => ({ title, date })),
          }),
        }, "POST", abort.current.signal), "ask");
        if (abort.current.signal.aborted) throw new AIError("CANCELED", "已停止等待，草稿不变。");
        setInterview({ questions: result.questions!, first: result.first!, target: targetOf(snapshot.draft) });
        setProgress("想答哪一个，点一下再接着写。");
        return;
      }
      assertGenerateInput(mode, {
        by: snapshot.draft.content.by,
        title: selected?.title,
        text: selected?.text,
      });
      // 输入或模式变化时另起任务；重试时保留原请求 ID 与已完成的结果。
      const job = reuseJob(
        snapshot.draft.aiJob,
        runSpec(fp, mode),
        fresh,
      );
      const check = () => {
        if (abort.current?.signal.aborted)
          throw new AIError("CANCELED", "已停止等待，草稿不变。");
      };
      const perform = async (
        key: string,
        extra: Record<string, unknown> = {},
      ): Promise<AIResult> => {
        check();
        const planned = planStep(job, key, randomUUID);
        if (planned.created)
          await onPatch({ aiJob: JSON.parse(JSON.stringify(job)) });
        if (planned.result) return planned.result;
        const step = planned.step;
        const result = await api<AIResult>(
          "/ai/write",
          { requestId: step.requestId, ...extra, photos: [] },
          "POST",
          abort.current!.signal,
        );
        const valid = validateResult(result, mode);
        step.result = valid;
        await onPatch({ aiJob: JSON.parse(JSON.stringify(job)) });
        return valid;
      };
      // 本地校验通过后才值得重试；参数错误重试也不会成功。
      setRetryable({ mode });
      const request = polishRequest({
        by: snapshot.draft.content.by,
        title: selected?.title ?? "",
        text: selected?.text ?? "",
      });
      setProgress("正在润色这段文字…");
      const result = await perform("polish", {
        context: request.context,
        writingMode: "polish",
      });
      check();
      await onPatch({
        aiProposal: { ...result, ...runSpec(fp, mode) },
      });
      // 面板仍打开时用户正看着结果；收起后才返回的结果用图标小圆点提示。
      setSeen(openRef.current);
      setProgress(successProgress(mode));
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
      hapticSuccess();
      setError("");
      setProgress("已填入草稿，保存记录后生效。");
    } catch (e) {
      setError(messageOf(e));
    }
  };
  const matchesView = matchesCurrentView(proposal, writeMode),
    pendingOther = pendingOtherProposal(proposal, writeMode);
  const viewProposal = () => {
    if (!proposal) return;
    setWriteMode(modeOf(proposal));
    setSeen(true);
    setError("");
    setProgress("");
  };
  const sheet = (
    <SheetModal
      visible={open}
      onClose={() => setPanel(false)}
      closeLabel="收起 AI 面板"
      closeTestID="ai-close"
      returnFocus={openButton}
      header={
        <View style={s.between}>
          <Text style={s.heading}>AI 帮你整理</Text>
          <Button
            title="收起"
            compact
            testID="ai-collapse"
            onPress={() => setPanel(false)}
          />
        </View>
      }
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        alwaysBounceVertical={false}
        contentContainerStyle={{
          gap: 12,
          paddingTop: 12,
          paddingBottom: 8,
        }}
      >
        <View style={{ gap: 8 }}>
          <Text style={s.muted}>写记录</Text>
          <View style={s.row}>
            <Button
              title="润色我的文字"
              icon="edit"
              compact
              selected={writeMode === "polish"}
              testID="ai-polish"
              disabled={busy || disabled}
              onPress={() => {
                chooseWriteMode("polish");
                void requestWriting("polish");
              }}
            />
          </View>
          <Text style={s.muted}>
            {writeMode === "ask" ? "AI 会问几个问题，选想答的接着写。" : !selectedEvent?.text.trim()
                ? "还没有可润色的正文。先写下几句话，再来润色。"
                : (polishRequest({
                    by: draft.content.by,
                    title: selectedEvent?.title ?? "",
                    text: selectedEvent?.text ?? "",
                  }).error ??
                  "只发送这件事的标题、正文和落款，保留你的原意、语气和事实，不发送照片。")}
          </Text>
          <Text style={s.muted}>访谈者</Text>
          <Button title="追问我" icon="sparkle" compact testID="ai-ask"
            disabled={busy || disabled || !(selectedEvent?.title.trim() || selectedEvent?.text.trim())}
            onPress={() => { chooseWriteMode("ask"); void requestWriting("ask"); }} />
          {!(selectedEvent?.title.trim() || selectedEvent?.text.trim()) && <Text style={s.muted}>先写几句，AI 才有得问。</Text>}
          <Text style={s.muted}>追问计一次写作额度；只发送这件事的文字、落款、月龄、日期和最近 10 条记录的标题，不发送照片。</Text>
          {visibleInterview?.questions.map((question, index) => <Button key={index} title={question} compact testID={`ai-ask-q-${index}`} disabled={busy || disabled} onPress={() => { void applyQuestion(index); }} />)}
          {visibleInterview?.first && !draft.content.first && <View style={{ gap: 8 }}>
            <Text style={s.muted}>这条像是第一次，标上吗？</Text>
            <Button title="标上" compact disabled={busy || disabled} onPress={() => { void applyQuestion(); }} />
          </View>}
        </View>
        {pendingOther && !matchesView && (
          <View style={{ gap: 8 }}>
            <Text style={s.muted}>
              还有一份润色建议待确认。
            </Text>
            <Button
              title="查看润色建议"
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
                    void requestWriting(retryable.mode);
                  }}
                />
              )}
              <Button
                title="重新生成（使用新的额度）"
                compact
                disabled={disabled}
                onPress={() => {
                  void requestWriting(retryable.mode, true);
                }}
              />
            </View>
          </Card>
        )}
        {matchesView && proposal && (
          <Card>
            {stale && (
              <Text style={{ color: colors.error }}>
                你已修改记录内容，这份建议已过期。重新生成后再采用，当前编辑已保留。
              </Text>
            )}
            {modeOf(proposal) === "polish" && (
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
            )}
            <Button
              title="放弃这份建议"
              compact
              disabled={busy || disabled}
              onPress={() => {
                void onPatch({ aiProposal: undefined }).catch((e) =>
                  setError(messageOf(e)),
                );
              }}
            />
          </Card>
        )}
        <Text style={s.footnote}>由 GPT-6 Astra 提供</Text>
      </ScrollView>
    </SheetModal>
  );
  const badge = unseen ? (
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
  ) : undefined;
  return (
    <View style={tool ? { flex: 1 } : undefined}>
      {tool ? (
        <ToolButton
          ref={openButton}
          testID="ai-open"
          icon="sparkle"
          label="AI"
          accessibilityLabel={unseen ? "AI 助手，有结果待查看" : "AI 助手"}
          selected={open}
          disabled={disabled}
          badge={badge}
          onPress={() => setPanel(true)}
        />
      ) : (
        <Pressable
          ref={openButton}
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
            {badge}
          </View>
        </Pressable>
      )}
      {sheet}
    </View>
  );
}
