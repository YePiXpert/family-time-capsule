const SECTIONS = [
  { label: "记录", hint: "说一句 · 拍一张 · 录一段 · 选已有的" },
  { label: "收件箱", hint: "先捕获，后整理" },
  { label: "时光轴", hint: "按真实发生的时间排列" },
  { label: "家人", hint: "每人一份独立的声音档案" },
  { label: "胶囊", hint: "封存此刻，等未来开启" },
] as const;

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-14 px-6 py-16">
      <section className="flex flex-col gap-5">
        <p className="text-xs tracking-[0.25em] text-accent">
          PRIVATE · SELF-HOSTED · 18+ YEARS
        </p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          家庭时间胶囊
        </h1>
        <p className="text-xl text-foreground/80">随处记录，统一归档。</p>
        <p className="max-w-xl leading-7 text-foreground/60">
          照片可以来自系统相机，声音可以来自语音备忘录，视频可以几个月后再补录，文字可以从聊天里复制。
          这里不要求你在「正确的 App」里记录人生——只负责把散落在不同地方的真实素材，
          整理成一条可以保存几十年的家庭成长时间线。
        </p>
      </section>

      <section
        aria-label="一级导航"
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
      >
        {SECTIONS.map((section) => (
          <div
            key={section.label}
            className="flex flex-col gap-1.5 rounded-lg border border-foreground/10 bg-foreground/[0.02] p-4"
          >
            <span className="font-medium">{section.label}</span>
            <span className="text-xs leading-5 text-foreground/55">
              {section.hint}
            </span>
          </div>
        ))}
      </section>

      <footer className="flex flex-col gap-1 text-sm text-foreground/50">
        <p>
          AI helps organize memories. Family members tell the story. Original
          sources always come first.
        </p>
        <p>P0 · 原件优先 · capturedAt 与 importedAt 永不混淆</p>
      </footer>
    </main>
  );
}
