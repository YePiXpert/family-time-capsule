/**
 * 装订前的逐页预览：一本册子要花几分钟才出得来，先让人翻一遍再决定。
 *
 * 只备当前这一页的照片，且按屏幕尺寸取图（不是 300 DPI），所以翻页快、内存稳；
 * 真正的成品分辨率在 BookBinder 那边。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Modal, PixelRatio, View, useWindowDimensions } from "react-native";
import { File } from "expo-file-system";
import { BookPageCard } from "./BookPage";
import { SCALE, SHEET_PT, slotPixels, type BookLayout } from "./book";
import { prepareBookPhoto } from "./book-export";
import type { LocalMedia, Stored } from "./model";
import { Button, Card, ErrorText, Page, Text, messageOf, useStyles } from "./ui";

export function BookPreview({
  layout,
  media,
  onClose,
  onBind,
}: {
  layout: BookLayout;
  media: Record<string, Stored<LocalMedia> | undefined>;
  onClose: () => void;
  onBind: () => void;
}) {
  const s = useStyles();
  const { width } = useWindowDimensions();
  const side = Math.min(width - 40, 420);
  const [index, setIndex] = useState(0);
  // 备好的照片连着页号一起存：翻页时上一页的图立刻作废，不必在 effect 里先清一次
  // 状态（那会踩 set-state-in-effect）。
  const [staged, setStaged] = useState<{
    index: number;
    photos: Record<string, string>;
  } | null>(null);
  const [error, setError] = useState("");
  const scratch = useRef<string[]>([]);
  const page = layout.pages[index]!;
  const photos = staged?.index === index ? staged.photos : {};

  const discard = useCallback(() => {
    for (const uri of scratch.current)
      try {
        const file = new File(uri);
        if (file.exists) file.delete();
      } catch {
        // 缓存清理尽力而为。
      }
    scratch.current = [];
  }, []);
  useEffect(() => discard, [discard]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const prepared: Record<string, string> = {};
      const fresh: string[] = [];
      try {
        const keys = [
          ...new Set(
            page.elements.flatMap((e) => (e.kind === "photo" ? [e.key] : [])),
          ),
        ];
        for (const key of keys) {
          // 预览按屏幕上的实际大小取图：版位占整页多少，就要屏幕上那么多像素。
          const onScreen = Math.ceil(
            (slotPixels(page, key) / (SHEET_PT * SCALE)) * side * PixelRatio.get(),
          );
          const photo = await prepareBookPhoto(media[key], Math.max(onScreen, 64));
          if (photo) {
            prepared[key] = photo.uri;
            fresh.push(photo.uri);
          }
        }
        if (cancelled) {
          for (const uri of fresh)
            try {
              new File(uri).delete();
            } catch {
              // 同上。
            }
          return;
        }
        discard();
        scratch.current = fresh;
        setStaged({ index, photos: prepared });
      } catch (e) {
        if (!cancelled) setError(messageOf(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page, index, media, side, discard]);

  return (
    <Modal
      visible
      animationType="slide"
      onRequestClose={onClose}
      testID="book-preview"
    >
      <Page back={false} scroll={false}>
        <View style={s.between}>
          <Text style={s.heading}>翻一遍再装订</Text>
          <Button title="返回" compact onPress={onClose} />
        </View>
        <Text style={s.muted}>
          共 {layout.pages.length} 页 · 20×20cm 方形开本 · 300 DPI 可送印
        </Text>
        <View style={{ alignItems: "center", gap: 12 }}>
          <View
            style={{
              width: side,
              height: side,
              // 纸是白的，衬一条细边才看得出页面边界。
              borderWidth: 1,
              borderColor: "rgba(0,0,0,0.12)",
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <BookPageCard page={page} photos={photos} points={side} />
          </View>
          <View style={s.row}>
            <Button
              title="上一页"
              compact
              testID="book-preview-prev"
              disabled={index === 0}
              onPress={() => setIndex(index - 1)}
            />
            <Text style={s.muted}>
              第 {index + 1} / {layout.pages.length} 页
            </Text>
            <Button
              title="下一页"
              compact
              testID="book-preview-next"
              disabled={index + 1 >= layout.pages.length}
              onPress={() => setIndex(index + 1)}
            />
          </View>
        </View>
        <ErrorText message={error} />
        <Card compact>
          <Text style={s.muted}>
            装订要一会儿，中途请留在年度册这一页；完成后会弹出保存与分享。
          </Text>
          <Button title="开始装订" primary testID="book-preview-bind" onPress={onBind} />
        </Card>
      </Page>
    </Modal>
  );
}
