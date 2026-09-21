import { useRef, useState } from "react";
import { useLibrary, useStore } from "./context";
import { recordTitle, sortedRecords, type StoryTopic } from "./model";
import { useNav } from "./navigation";
import { beginStoryDraft } from "./services";
import { STORY_TOPICS, storiesWritten, storyTitle } from "./stories";
import {
  Card, Page, SettingsRow, Text, dateLabel, messageOf, useStyles,
} from "./ui";

export function Stories() {
  const state = useLibrary(),
    store = useStore(),
    nav = useNav(),
    s = useStyles();
  const records = sortedRecords(state);
  const counts = storiesWritten(records);
  const opening = useRef(false);
  const [error, setError] = useState("");
  const begin = async (topic: StoryTopic) => {
    if (opening.current) return;
    opening.current = true;
    setError("");
    try {
      const draftId = await beginStoryDraft(store, topic, state.profile.birthday);
      nav.navigate("Editor", { draftId });
    } catch (e) {
      setError(messageOf(e));
    } finally {
      opening.current = false;
    }
  };
  return (
    <Page title="出生的故事">
      <Text style={s.muted}>四个故事，一次答一问就好；写过的还能再写一段。</Text>
      {!!error && <Text style={s.muted}>{error}</Text>}
      {STORY_TOPICS.map((topic) => {
        const written = records.filter((r) => r.story === topic).slice(0, 3);
        return (
          <Card key={topic}>
            <SettingsRow
              label={`${counts[topic] ? "✓ " : ""}${storyTitle(topic)}`}
              subtitle={counts[topic] ? `${counts[topic]} 段时光` : "还没写"}
              serifLabel
              testID={`story-topic-${topic}`}
              onPress={() => void begin(topic)}
              last={written.length === 0}
            />
            {written.map((record, index) => (
              <SettingsRow
                key={record.id}
                label={recordTitle(record)}
                subtitle={dateLabel(record.date)}
                onPress={() => nav.navigate("Record", { id: record.id })}
                last={index === written.length - 1}
              />
            ))}
          </Card>
        );
      })}
    </Page>
  );
}
