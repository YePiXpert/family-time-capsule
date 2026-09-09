"use client";
import { useEffect, useRef, type RefObject } from "react";

/** A live signal from the recording stream, never a decorative fake waveform. */
export function RecordingMeter({ streamRef }: { streamRef: RefObject<MediaStream | null> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const stream = streamRef.current;
    if (!stream || !window.AudioContext) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let audio: AudioContext | undefined, frame = 0;
    const stop = () => { cancelAnimationFrame(frame); if (audio) void audio.close().catch(() => {}); audio = undefined; };
    const start = () => {
      stop();
      if (preference.matches) return;
      try {
        audio = new AudioContext();
        const analyzer = audio.createAnalyser(); analyzer.fftSize = 128;
        audio.createMediaStreamSource(stream).connect(analyzer);
        const values = new Uint8Array(analyzer.frequencyBinCount);
        const draw = () => {
          const context = canvas.current?.getContext("2d");
          if (!context || !canvas.current) return;
          analyzer.getByteTimeDomainData(values);
          context.clearRect(0, 0, 480, 60);
          context.strokeStyle = getComputedStyle(canvas.current).color; context.lineWidth = 3;
          context.beginPath();
          values.forEach((value, index) => { const x = index / (values.length - 1) * 480, y = 30 + (value - 128) / 128 * 28; if (index === 0) context.moveTo(x, y); else context.lineTo(x, y); });
          context.stroke(); frame = requestAnimationFrame(draw);
        };
        void audio.resume().catch(() => {}); draw();
      } catch { stop(); }
    };
    start(); preference.addEventListener("change", start);
    return () => { preference.removeEventListener("change", start); stop(); };
  }, [streamRef]);
  return <div className="rounded-2xl bg-accent-soft p-4 text-accent"><p role="status">正在录音，说完后停止并保存。</p><canvas ref={canvas} width={480} height={60} aria-hidden="true" className="h-12 w-full motion-reduce:hidden" /></div>;
}
