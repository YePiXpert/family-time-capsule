export function Placeholder({ title, hint }: { title: string; hint: string }) {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm leading-6 text-foreground/60">{hint}</p>
    </main>
  );
}
