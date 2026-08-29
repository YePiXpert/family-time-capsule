import type { Metadata } from "next";
import { ImageUploadForm } from "./image-upload-form";
import { MediaUploadForm, TextNoteForm } from "./media-upload-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "记录 · Family Time Capsule" };

export default function CapturePage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <h1 className="text-2xl font-semibold">记录</h1>
      <p className="mt-2 text-sm leading-6 text-foreground/60">
        今天想留下什么？照片、录音、视频、文字都可以先收进来，
        过几天再整理也不迟——系统会记住它们真实发生的时间。
      </p>

      <section aria-label="照片" className="mt-10">
        <h2 className="text-lg font-medium">照片</h2>
        <ImageUploadForm />
      </section>

      <section aria-label="录音" className="mt-10">
        <h2 className="text-lg font-medium">录音</h2>
        <MediaUploadForm kind="audio" />
      </section>

      <section aria-label="视频" className="mt-10">
        <h2 className="text-lg font-medium">视频</h2>
        <MediaUploadForm kind="video" />
      </section>

      <section aria-label="文字" className="mt-10">
        <h2 className="text-lg font-medium">文字</h2>
        <TextNoteForm />
      </section>
    </main>
  );
}
