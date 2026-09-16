import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { File } from "expo-file-system";
import { mediaUri } from "../local/files";
import type { LocalMedia } from "../local/model";
export async function thumbnail(media: LocalMedia): Promise<string> {
  const context = ImageManipulator.manipulate(mediaUri(media));
  let source: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
  try {
    source = await context.renderAsync();
    const longest = Math.max(source.width, source.height);
    if (longest > 1280)
      context.resize({
        width: Math.round((source.width * 1280) / longest),
        height: Math.round((source.height * 1280) / longest),
      });
    for (const quality of [0.75, 0.5, 0.3]) {
      const rendered = await context.renderAsync();
      try {
        const result = await rendered.saveAsync({
          format: SaveFormat.JPEG,
          compress: quality,
          base64: true,
        });
        try {
          if (
            result.base64 &&
            result.base64.length <= Math.floor((512 * 1024) / 3) * 4
          )
            return `data:image/jpeg;base64,${result.base64}`;
        } finally {
          const file = new File(result.uri);
          if (file.exists) file.delete();
        }
      } finally {
        rendered.release();
      }
    }
    throw new Error("这张照片无法缩小到 AI 所需大小，请换一张照片。");
  } finally {
    source?.release();
    context.release();
  }
}
