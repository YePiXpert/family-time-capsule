import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLibrary, useStore, useSyncStatus } from "./context";
import { CaptureFab, FAB_INSET, FAB_SIZE } from "./CaptureFab";
import {
  beginDraft,
  beginLetter,
  beginSelection,
  now,
} from "./services";
import {
  letterCaption,
  letterShortCaption,
  letterState,
  sortLetters,
} from "./letters";
import {
  fullNameLine,
  sealInitial,
  letterSeal,
  recordTitle,
  sortedRecords,
  stampUnsigned,
  unsignedRecords,
  compareDates,
} from "./model";
import { useFocusGuard, useNav } from "./navigation";
import { isEmptyDraft } from "./empties";
import { daysSinceExport } from "./backup";
import {
  backupDueOf,
  backupNudgeBody,
  bookNudgeOf,
  nudgeOf,
  pickNudge,
  type NudgeKind,
} from "./nudge";
import { pickAnother } from "./shuffle";
import {
  heroItems,
  shelfIndex,
  shelfTiles,
  type ShelfTile,
} from "./shelf-plan";
import {
  ageLine,
  milestoneLabel,
  milestoneNumeral,
  milestoneOf,
} from "./dates";
import {
  Button,
  Card,
  ErrorText,
  IconButton,
  Ornament,
  Page,
  SectionHeader,
  Stamp,
  Text,
  dateLabel,
  hapticLight,
  messageOf,
  serif,
  useStyles,
  useTextScale,
  useTheme,
} from "./ui";
import { JournalIcon } from "../components/JournalIcon";

import {
  coverForRecords,
  coverForAlbum,
  useDayKey,
  GuideRow,
  BookRows,
  ShelfTileView,
  ShelfStrip,
  RecentFlip,
  NudgeCard,
  DraftCard,
  heroCardMin,
  heroBodyFont,
  HERO_CARD_MIN,
  monthName,
} from "./ShelfCards";
/**
 * 书架即首页，而且首屏就是全部：页头、（提醒卡）、「最近」翻页卡、（草稿卡）、书架横条、底行。
 * 「最近」卡的高度吃掉剩下的空间，所以放得下时整页不能上下滑、不回弹；要看更多就左右翻。
 * 底行与悬浮钮同高，「新建相册」「写一封信」排在它左边，悬浮钮底下从不压着东西。
 * 只有真放不下（更大文字、小屏、提醒卡与草稿同时在）时才退回可以往下滑。
 */
export function Shelf() {
  const sync = useSyncStatus();
  const state = useLibrary(),
    store = useStore(),
    nav = useNav(),
    s = useStyles(),
    { colors, large } = useTheme();
  const textScale = useTextScale();
  const insets = useSafeAreaInsets();
  const captureGuard = useFocusGuard();
  const [error, setError] = useState(""),
    [viewport, setViewport] = useState(0),
    [contentHeight, setContentHeight] = useState(0),
    [heroHeader, setHeroHeader] = useState(0);
  // store 只在某个集合真的动过时才换它的引用，所以按集合记忆：改一条草稿不会
  // 让一万条记录重新排序，主题、尺寸与本页 useState 引起的重渲染都命中缓存。
  const {
    records: recordMap,
    albums: albumMap,
    media: mediaMap,
    drafts: draftMap,
    letters: letterMap,
  } = state;
  const records = useMemo(
    () => sortedRecords({ records: recordMap }),
    [recordMap],
  );
  // 按月、按年的汇总跟着排好的记录走：书架挂在编辑页底下，存草稿、同步状态变化都会重渲染。
  const volumes = useMemo(() => shelfIndex(records), [records]);
  const { months, years, firsts, quotes } = volumes;
  // 换日时 day 变化触发重渲染，today 随之更新。
  const day = useDayKey();
  const today = new Date();
  const albums = useMemo(
    () =>
      Object.values(albumMap).sort(
        (a, b) =>
          b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
      ),
    [albumMap],
  );
  const drafts = useMemo(
    () =>
      Object.values(draftMap)
        // 点开就被杀掉的空白新草稿什么都没有，不挂「上次没写完」，也不催。
        .filter((d) => d.recordId || !isEmptyDraft(d))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [draftMap],
  );
  const letters = useMemo(
    () => sortLetters(Object.values(letterMap), new Date(`${day}T00:00:00`)),
    [letterMap, day],
  );
  // 只看月日：同一天之内不必重算。
  const hero = useMemo(
    () => heroItems(records, new Date(`${day}T12:00:00`)),
    [records, day],
  );
  const tiles = shelfTiles({
    months,
    years,
    firsts,
    quotes,
    albumIds: albums.map((a) => a.id),
    letterIds: letters.map((l) => l.id),
  });
  const latestDraft = drafts[0];
  const nudge = nudgeOf(
    records[0]?.date ?? null,
    latestDraft?.updatedAt ?? null,
    drafts.length,
  );
  const bookNudge = bookNudgeOf(
    today,
    years,
    Object.keys(state.yearBooksBoundAt ?? {}),
  );
  // records 按日期新到旧排，最后一段就是第一段时光：它满 7 天才提备份，刚开始记的头几天不打扰。
  const exportedDays = daysSinceExport(state),
    backupDue = backupDueOf(
      records[records.length - 1]?.date ?? null,
      exportedDays,
      today,
    );
  const age = ageLine(state.profile.birthday),
    milestone = milestoneOf(state.profile.birthday);
  const initial = sealInitial(state.profile.name);
  // 同屏只放一张提醒卡：合并冲突 > 落款 > 里程碑 > 装订 > 备份 > 节奏；关掉的写进库里，沉默期见 nudge.ts。
  const candidates: NudgeKind[] = [];
  // 落款卡：这台手机定了默认落款、库里还有没落款的记录时问一次；「都是」一次写上，关掉就永远不再问。
  const unsigned = useMemo(() => unsignedRecords({ records: recordMap }), [recordMap]);
  const defaultBy = state.settings.by;
  if (sync.conflicts > 0) candidates.push("conflict");
  if (defaultBy && unsigned.length) candidates.push("by");
  if (milestone) candidates.push("milestone");
  if (bookNudge) candidates.push("book");
  if (backupDue) candidates.push("backup");
  if (nudge) candidates.push("rhythm");
  const nudgeKind = pickNudge(candidates, state.nudgeClosedAt, today);
  const closeNudge = (kind: NudgeKind) => {
    void store
      .change((lib) => {
        lib.nudgeClosedAt = { ...lib.nudgeClosedAt, [kind]: now() };
      })
      .catch((e) => setError(messageOf(e)));
  };
  const captureNow = () => {
    if (!captureGuard.take()) return;
    hapticLight();
    void beginDraft(store)
      .then((draftId) => nav.navigate("Editor", { draftId }))
      .catch((e) => {
        captureGuard.release();
        setError(messageOf(e));
      });
  };
  const createAlbum = () => {
    void beginSelection(store)
      .then((sessionId) => nav.navigate("Picker", { sessionId }))
      .catch((e) => setError(messageOf(e)));
  };
  const createLetter = () => {
    void beginLetter(store)
      .then((id) => nav.navigate("LetterEditor", { id }))
      .catch((e) => setError(messageOf(e)));
  };
  const tileOf = (tile: ShelfTile, index: number) => {
    switch (tile.kind) {
      case "year":
        // 年度册打头，月册摆在它后面：不另占一行年份标题，也不和月册重复同一张封面照片。
        return (
          <ShelfTileView
            key={`year-${tile.year}`}
            index={index}
            title={`${tile.year} 年`}
            caption="年度册"
            stamp={tile.year}
            testID={`volume-year-${tile.year}`}
            onPress={() => nav.navigate("Year", { year: tile.year })}
          />
        );
      case "month": {
        const monthRecords = volumes.byMonth.get(tile.month) ?? [];
        return (
          <ShelfTileView
            key={tile.month}
            index={index}
            title={monthName(tile.month)}
            caption={`${monthRecords.length} 段时光`}
            cover={coverForRecords(monthRecords, mediaMap)}
            icon="calendar"
            testID={`volume-${tile.month}`}
            onPress={() => nav.navigate("Month", { month: tile.month })}
          />
        );
      }
      case "firsts":
        return (
          <ShelfTileView
            key="firsts"
            index={index}
            title="第一次合集"
            caption={`${firsts} 个第一次`}
            icon="star"
            testID="volume-firsts"
            onPress={() => nav.navigate("Firsts")}
          />
        );
      case "quotes":
        return (
          <ShelfTileView
            key="quotes"
            index={index}
            title="她说的话"
            caption={`${quotes} 句原话`}
            stamp="语"
            testID="volume-quotes"
            onPress={() => nav.navigate("Quotes")}
          />
        );
      case "album": {
        const album = albumMap[tile.id]!;
        return (
          <ShelfTileView
            key={album.id}
            index={index}
            title={album.name}
            caption={`${album.items.length} 段时光`}
            cover={coverForAlbum(album, state)}
            icon="book"
            testID={`album-${album.id}`}
            onPress={() => nav.navigate("Album", { id: album.id })}
          />
        );
      }
      case "letter": {
        const letter = letterMap[tile.id]!;
        return (
          <ShelfTileView
            key={letter.id}
            index={index}
            title={letter.title || "一封信"}
            caption={letterShortCaption(letter, today)}
            spokenCaption={letterCaption(letter, today)}
            stamp={letterSeal(letter.from)}
            testID={`letter-${letter.id}`}
            onPress={() =>
              nav.navigate(
                letterState(letter, today) === "draft"
                  ? "LetterEditor"
                  : "Letter",
                { id: letter.id },
              )
            }
          />
        );
      }
    }
  };
  const shelfCount = tiles.time.length + tiles.topics.length;
  const hasRecords = records.length > 0;
  // 「最近」区（区标题 + 8 + 卡 + 圆点）最矮多高；首屏剩下的比这还少才让整页可以往下滑。
  // 区标题按量到的高（系统字号放大时文字按钮会高过 44），没量到前带「随便翻翻」时是 44、不带 32；
  // 卡取 180 与每张卡最少内容的较大者（更大文字、系统字号放大时内容更高）；圆点那一截是投影留白 14 + 8 + 6。
  const shuffle = records.length >= 3;
  const lines = {
    footnote: s.footnote.lineHeight * textScale,
    heading: s.heading.lineHeight * textScale,
    body: heroBodyFont(large).lineHeight * textScale,
  };
  const cardMin = hero.reduce(
    (most, item) =>
      Math.max(
        most,
        heroCardMin(item, coverForRecords([item.record], mediaMap), lines),
      ),
    HERO_CARD_MIN,
  );
  const heroMin = Math.ceil(
    cardMin +
      (heroHeader || (shuffle ? 44 : 32)) +
      8 +
      (hero.length > 1 ? 28 : 0),
  );
  return (
    <Page scroll={false} top>
      <ScrollView
        onLayout={(e) => setViewport(e.nativeEvent.layout.height)}
        onContentSizeChange={(_, height) => setContentHeight(height)}
        // 首屏放得下就不能滑：不回弹、不露滚动条；真放不下（更大文字、小屏）才退回可以往下滑。
        scrollEnabled={contentHeight > viewport + 1}
        alwaysBounceVertical={false}
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: 20,
          paddingTop: 12,
          // 底行与悬浮钮同高：内容止于悬浮钮的下沿。
          paddingBottom: insets.bottom + FAB_INSET,
          gap: 16,
        }}
      >
        <View style={s.between}>
          <Pressable
            accessibilityRole="button"
            // 读屏要先听到名字与年龄，再知道点了是翻开扉页。
            accessibilityLabel={[
              state.profile.name
                ? `${state.profile.name}的成长记`
                : "成长中的每一天",
              age ||
                (records.length
                  ? `${records.length} 段时光`
                  : "从今天的一件小事开始"),
            ].join("，")}
            accessibilityHint="翻开扉页"
            onPress={() => nav.navigate("Title")}
            style={{ flex: 1, minWidth: 0, gap: 2 }}
          >
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 2 }}
            >
              <Text numberOfLines={2} style={[s.title, { flexShrink: 1 }]}>
                {state.profile.name
                  ? `${state.profile.name}的成长记`
                  : "成长中的每一天"}
              </Text>
              <JournalIcon
                name="chevron-right"
                color={colors.muted}
                size={18}
              />
            </View>
            {age ? (
              <Text style={s.muted} testID="shelf-age">
                {age}
              </Text>
            ) : (
              <Text style={s.muted}>
                {records.length
                  ? `${records.length} 段时光`
                  : "从今天的一件小事开始"}
              </Text>
            )}
          </Pressable>
          <IconButton
            label="搜索全部记录"
            icon="search"
            testID="open-search"
            onPress={() => nav.navigate("Search")}
          />
          <Pressable
            testID="open-settings"
            accessibilityRole="button"
            accessibilityLabel="设置"
            onPress={() => nav.navigate("Settings")}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Stamp size={32} inset={3}>
              <Text
                style={{
                  fontFamily: serif,
                  fontSize: 15,
                  lineHeight: 18,
                  color: colors.accent,
                  fontWeight: "600",
                }}
              >
                {initial}
              </Text>
            </Stamp>
          </Pressable>
        </View>
        {nudgeKind === "milestone" && milestone && (
          <NudgeCard
            testID="milestone-card"
            eyebrow={milestoneLabel(milestone)}
            title="把今天好好记下来"
            stamp={
              <Stamp size={44} inset={3}>
                <Text
                  style={{
                    fontFamily: serif,
                    fontSize: milestone.kind === "hundred" ? 13 : 18,
                    color: colors.accent,
                    fontWeight: "600",
                  }}
                >
                  {milestoneNumeral(milestone)}
                </Text>
              </Stamp>
            }
            action={{
              label: "记一刻",
              testID: "milestone-card-action",
              onPress: captureNow,
            }}
            onClose={() => closeNudge("milestone")}
          />
        )}
        {nudgeKind === "conflict" && (
          <NudgeCard
            titleTestID="conflict-nudge"
            title={`有 ${sync.conflicts} 段两台手机都改过`}
            body="时间新的一版已经留下，另一版收着，随时可以换回。"
            action={{
              label: "去看看",
              testID: "conflict-nudge-action",
              onPress: () => nav.navigate("Conflicts"),
            }}
            onClose={() => closeNudge("conflict")}
          />
        )}
        {nudgeKind === "by" && defaultBy && (
          <NudgeCard
            titleTestID="by-nudge"
            title={`以前的 ${unsigned.length} 段时光还没有落款`}
            body={`都是${defaultBy}写的吗？点「都是」一次写上；不是的话关掉，以后不再问。`}
            action={{
              label: "都是",
              testID: "by-nudge-action",
              onPress: () => {
                void store
                  .change((lib) => {
                    stampUnsigned(lib, defaultBy);
                    lib.nudgeClosedAt = { ...lib.nudgeClosedAt, by: now() };
                  })
                  .catch((e) => setError(messageOf(e)));
              },
            }}
            onClose={() => closeNudge("by")}
          />
        )}
        {nudgeKind === "book" && bookNudge && (
          <NudgeCard
            titleTestID="book-nudge"
            title="去年的纪念册可以装订了"
            body={`${bookNudge.year} 年已经翻过去了，把它排成一本册子，留在书架上。`}
            action={{
              label: "去年度册",
              testID: "book-nudge-action",
              onPress: () => nav.navigate("Year", { year: bookNudge.year }),
            }}
            onClose={() => closeNudge("book")}
          />
        )}
        {nudgeKind === "backup" && (
          <NudgeCard
            testID="backup-reminder"
            title={
              exportedDays === null
                ? "还没有保存过完整备份"
                : `已经 ${exportedDays} 天没有备份了`
            }
            body={backupNudgeBody(sync.joined, sync.lastSyncAt, today)}
            action={{
              label: "去备份",
              testID: "backup-reminder-action",
              onPress: () => nav.navigate("Backup"),
            }}
            onClose={() => closeNudge("backup")}
          />
        )}
        {nudgeKind === "rhythm" && nudge && (
          <NudgeCard
            titleTestID="rhythm-nudge"
            title={
              nudge.kind === "draft"
                ? "有一份草稿还没写完"
                : `有 ${nudge.days} 天没记啦`
            }
            body={
              nudge.kind === "draft"
                ? "接着上次的话头写下去吧。"
                : "日子过得快，挑一件小事写下来。"
            }
            action={{
              label: nudge.kind === "draft" ? "继续写" : "记一刻",
              testID: "rhythm-nudge-action",
              onPress: () => {
                if (nudge.kind === "draft" && latestDraft) {
                  nav.navigate("Editor", { draftId: latestDraft.id });
                  return;
                }
                captureNow();
              },
            }}
            onClose={() => closeNudge("rhythm")}
          />
        )}
        {hasRecords ? (
          // 「最近」区的高度只由首屏剩下的空间决定：里面的内容绝对定位、不参与撑高。否则有照片的卡
          // 按 16:10 算出的照片高度会反过来把整页撑高，书架与底行被挤出屏幕、整页又能滑了
          // （run 35868419219 的 iOS 首页就是这样）。左右出血 20，翻页条才能贴到屏幕边。
          <View style={{ flex: 1, minHeight: heroMin, marginHorizontal: -20 }}>
            <View
              style={[
                StyleSheet.absoluteFill,
                { paddingHorizontal: 20, gap: 8 },
              ]}
            >
              <View
                onLayout={(e) => setHeroHeader(e.nativeEvent.layout.height)}
              >
                <SectionHeader
                  title="最近"
                  action={
                    shuffle
                      ? {
                          label: "随便翻翻",
                          testID: "shuffle",
                          onPress: () => {
                            const id = pickAnother(records.map((r) => r.id));
                            if (id)
                              nav.navigate("Record", { id, shuffle: true });
                          },
                        }
                      : undefined
                  }
                />
              </View>
              <RecentFlip
                items={hero}
                media={mediaMap}
                onOpen={(id) => nav.navigate("Record", { id })}
              />
            </View>
          </View>
        ) : (
          // 空库只有这张欢迎卡，不挂「最近」的区标题。
          <Card>
            <Text style={s.heading}>把今天的小事留下来</Text>
            <Text style={s.muted}>
              写几句话，留一张照片。日子会慢慢长成一册册书。
            </Text>
            <View style={s.row}>
              <Button
                title="记一刻"
                primary
                icon="edit"
                testID="capture-first"
                onPress={captureNow}
              />
            </View>
          </Card>
        )}
        {latestDraft && (
          <DraftCard
            drafts={drafts}
            onResume={(draftId) => nav.navigate("Editor", { draftId })}
          />
        )}
        <ErrorText message={error} />
        {shelfCount > 0 && (
          <View style={{ gap: 8 }}>
            <SectionHeader title="书架" />
            <ShelfStrip
              time={tiles.time.map(tileOf)}
              topics={tiles.topics.map((tile, i) =>
                tileOf(tile, tiles.time.length + i),
              )}
            />
          </View>
        )}
        {shelfCount > 0 ? (
          <>
            {/* 空库时上面没有撑满的「最近」卡：垫一块弹性空白，底行照样落在悬浮钮那一行。 */}
            {!hasRecords && <View style={{ flex: 1 }} />}
            {/* 新建是工具，排在书架之后；与悬浮钮同高、靠左摆，右边让出悬浮钮的位置。左移 8 让字与页边对齐。 */}
            <View
              style={{
                flexDirection: "row",
                // 窄屏大字放不下两个动作时整个换到下一行，不把字一个个折开；右边照样让出悬浮钮。
                flexWrap: "wrap",
                alignItems: "center",
                alignContent: "center",
                minHeight: FAB_SIZE,
                marginLeft: -8,
                paddingRight: FAB_SIZE + 12,
              }}
            >
              {hasRecords && (
                <Button
                  title="新建相册"
                  kind="text"
                  compact
                  icon="plus"
                  testID="album-new"
                  onPress={createAlbum}
                />
              )}
              <Button
                title="写一封信"
                kind="text"
                compact
                icon="seal"
                testID="letter-new"
                onPress={createLetter}
              />
            </View>
          </>
        ) : (
          // 还没有任何记录与信：新建的引导行放一张卡（选材页是空的，先不给「新建相册」）。
          <BookRows>
            <GuideRow
              icon="seal"
              title="写一封信"
              hint="给多年后的她写一封信，到日子再拆。"
              testID="letter-new"
              onPress={createLetter}
              last
            />
          </BookRows>
        )}
      </ScrollView>
      <CaptureFab />
    </Page>
  );
}

export function Firsts() {
  const state = useLibrary(),
    s = useStyles();
  const nav = useNav();
  const firsts = sortedRecords(state)
    .filter((r) => r.first)
    .sort((a, b) => compareDates(a.date, b.date));
  return (
    <Page title="第一次合集">
      <Text style={s.muted}>
        {firsts.length ? `${firsts.length} 个第一次，按日子排好。` : ""}
      </Text>
      {firsts.map((record) => (
        <Pressable
          key={record.id}
          testID={`first-${record.id}`}
          accessibilityRole="button"
          accessibilityLabel={`${recordTitle(record)}，${dateLabel(record.date)}`}
          onPress={() => nav.navigate("Record", { id: record.id })}
        >
          <Card compact style={{ paddingVertical: 12 }}>
            <Text style={s.muted}>{dateLabel(record.date)}</Text>
            <Text style={s.heading}>{recordTitle(record)}</Text>
            {!!record.text.trim() && (
              <Text numberOfLines={2} style={s.muted}>
                {record.text.trim()}
              </Text>
            )}
          </Card>
        </Pressable>
      ))}
      {firsts.length === 0 && (
        <View style={s.empty}>
          <Text style={s.heading}>还没有第一次</Text>
          <Text style={s.muted}>
            在阅读页点亮「第一次」，它就会收进这一册。
          </Text>
          <View style={s.row}>
            <Button title="回书架" kind="text" onPress={() => nav.goBack()} />
          </View>
          <Ornament />
        </View>
      )}
    </Page>
  );
}

export function TitlePage() {
  const state = useLibrary(),
    s = useStyles(),
    { colors } = useTheme();
  const nav = useNav();
  const initial = sealInitial(state.profile.name);
  const name = state.profile.name || state.profile.fullName;
  const nameLine = state.profile.fullName
    ? fullNameLine(state.profile.fullName, state.profile.name)
    : "";
  return (
    <Page>
      <View style={{ alignItems: "center", paddingVertical: 48, gap: 20 }}>
        <Stamp size={96}>
          <Text
            style={{
              fontFamily: serif,
              fontSize: 40,
              lineHeight: 48,
              color: colors.accent,
              fontWeight: "600",
            }}
          >
            {initial}
          </Text>
        </Stamp>
        {name ? (
          <Text style={[s.title, { textAlign: "center" }]}>
            {name}
          </Text>
        ) : (
          <Text
            style={[s.heading, { textAlign: "center", color: colors.muted }]}
          >
            还没填名字
          </Text>
        )}
        {!!nameLine && (
          <Text testID="title-full-name" style={[s.muted, { textAlign: "center" }]}>
            {nameLine}
          </Text>
        )}
        {!!state.profile.motto && (
          <Text
            testID="title-motto"
            style={{
              fontFamily: serif,
              fontSize: 16,
              lineHeight: 26,
              color: colors.muted,
              textAlign: "center",
              paddingHorizontal: 24,
            }}
          >
            {state.profile.motto}
          </Text>
        )}
        {!!state.profile.birthday && (
          <Text style={s.muted}>生于 {dateLabel(state.profile.birthday)}</Text>
        )}
        <Text style={[s.muted, { textAlign: "center" }]}>
          记录保存在这台手机上，慢慢长成一册册书。
        </Text>
        <Ornament />
        <Button
          title="完善资料"
          icon="person"
          onPress={() => nav.navigate("Profile")}
        />
      </View>
    </Page>
  );
}
