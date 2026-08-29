import type { Metadata } from "next";
import { ImageUploadForm } from "./image-upload-form";

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
      <ImageUploadForm />
    </main>
  );
}
