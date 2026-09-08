"use client";

import { useEffect, useRef } from "react";
import type { Chart as ChartInstance } from "chart.js";

export function AnalyticsBarChart({ title, labels, values }: { title: string; labels: string[]; values: number[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let chart: ChartInstance | undefined;
    let cancelled = false;
    void import("chart.js/auto").then(({ default: Chart }) => {
      if (cancelled) return;
      chart = new Chart(canvas, {
        type: "bar",
        data: { labels, datasets: [{ data: values, backgroundColor: "rgba(220, 38, 38, 0.72)", borderRadius: 4 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
      });
    });
    return () => { cancelled = true; chart?.destroy(); };
  }, [labels, values]);

  return <section aria-label={title} className="h-64 rounded-lg border border-ink/10 bg-paper p-4"><h2 className="mb-3 text-sm font-black">{title}</h2><div className="h-52"><canvas ref={canvasRef} aria-hidden="true" /></div></section>;
}
