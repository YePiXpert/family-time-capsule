import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { useLibrary } from "./context";
import { sortedRecords } from "./model";
import type { Props } from "./navigation";
import { clusterPlaces, type PlaceCluster } from "./places";
import { RecordCard } from "./Home";
import { Photo } from "./Media";
import {
  Card,
  Ornament,
  Page,
  Text,
  dateLabel,
  useStyles,
} from "./ui";
import { useNav } from "./navigation";

function ClusterCard({
  cluster,
  index,
  open,
  onToggle,
}: {
  cluster: PlaceCluster;
  index: number;
  open: boolean;
  onToggle: () => void;
}) {
  const state = useLibrary(),
    s = useStyles(),
    nav = useNav();
  const cover = cluster.mediaIds
    .map((id) => state.media[id])
    .find((m) => m?.kind === "image");
  const records = useMemo(() => {
    const ids = new Set(cluster.mediaIds);
    return sortedRecords(state).filter((r) =>
      r.mediaIds.some((id) => ids.has(id)),
    );
  }, [state, cluster.mediaIds]);
  const range =
    cluster.firstAt && cluster.lastAt
      ? cluster.firstAt === cluster.lastAt
        ? dateLabel(cluster.firstAt)
        : `${dateLabel(cluster.firstAt)} – ${dateLabel(cluster.lastAt)}`
      : "";
  return (
    <Card compact>
      <Pressable
        testID={`footprint-cluster-${index}`}
        accessibilityRole="button"
        accessibilityLabel={`地点 ${index + 1}，${cluster.mediaIds.length} 张照片`}
        onPress={onToggle}
        style={{ gap: 8 }}
      >
        {cover && <Photo media={cover} preview />}
        <Text style={s.heading}>地点 {index + 1}</Text>
        <Text style={s.muted}>
          {cluster.mediaIds.length} 张照片
          {range ? ` · ${range}` : ""}
        </Text>
        <Text style={s.muted}>
          {cluster.center.latitude.toFixed(4)}, {cluster.center.longitude.toFixed(4)}
        </Text>
      </Pressable>
      {open && (
        <View style={{ gap: 12 }}>
          {records.map((record) => (
            <RecordCard
              key={record.id}
              record={record}
              onPress={() => nav.navigate("Record", { id: record.id })}
            />
          ))}
          {records.length === 0 && (
            <Text style={s.muted}>这个地点的照片不在任何记录里。</Text>
          )}
        </View>
      )}
    </Card>
  );
}

export function Footprint(_: Props<"Footprint">) {
  const state = useLibrary(),
    s = useStyles();
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const clusters = useMemo(
    () =>
      clusterPlaces(Object.values(state.media)).sort(
        (a, b) => b.mediaIds.length - a.mediaIds.length,
      ),
    [state.media],
  );
  return (
    <Page title="足迹">
      <Text style={s.muted}>
        {clusters.length
          ? `按照片拍摄位置聚成 ${clusters.length} 个地点，从最常去的地方排起。`
          : ""}
      </Text>
      <View style={{ gap: 16 }}>
        {clusters.map((cluster, index) => (
          <ClusterCard
            key={`${cluster.center.latitude},${cluster.center.longitude}`}
            cluster={cluster}
            index={index}
            open={openIndex === index}
            onToggle={() => setOpenIndex(openIndex === index ? null : index)}
          />
        ))}
      </View>
      {clusters.length === 0 && (
        <View style={s.empty}>
          <Text style={s.heading}>还没有带位置的照片</Text>
          <Text style={s.muted}>
            用相机拍照并允许使用位置，导入后这里会慢慢长出她常去的地方。
          </Text>
          <Ornament />
        </View>
      )}
      <Text style={s.muted}>
        位置只来自照片的拍摄信息，始终保存在本机。
      </Text>
    </Page>
  );
}
