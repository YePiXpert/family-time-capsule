import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { authorizeApiFamilyRequest } from "@/lib/authz/context";
import { BookError } from "@/lib/books/projects/service";
import { readableBookArtifact } from "@/lib/books/render/jobs";
import { mobileJson, mobileRequestError } from "@/lib/mobile/http";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApiFamilyRequest(request.headers, "archive:view");
  if (!auth.ok)
    return mobileJson({ error: auth.error }, { status: auth.status });
  try {
    const file = await readableBookArtifact(auth.context, (await params).id),
      format = file.row.format,
      extension = format === "reading_zip" ? "zip" : format;
    const inline =
      format === "pdf" &&
      new URL(request.url).searchParams.get("preview") === "1";
    return new Response(
      Readable.toWeb(createReadStream(file.path)) as ReadableStream<Uint8Array>,
      {
        headers: {
          "content-type":
            format === "pdf"
              ? "application/pdf"
              : format === "epub"
                ? "application/epub+zip"
                : "application/zip",
          "content-length": String(file.row.bytes),
          "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.title.replace(/[\r\n"]/g, "_") + "." + extension)}`,
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        },
      },
    );
  } catch (e) {
    return e instanceof BookError
      ? mobileJson({ error: e.code }, { status: e.status })
      : mobileRequestError(e);
  }
}
