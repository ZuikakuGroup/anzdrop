"use client";

import { useEffect, useState, type ReactNode } from "react";
import SiteHeader from "@/components/brand/SiteHeader";
import SiteFooter from "@/components/brand/SiteFooter";
import Spinner from "@/components/brand/Spinner";
import AdminNav from "@/components/admin/AdminNav";
import { AnalyticsBarChart } from "@/components/admin/AnalyticsBarChart";
import {
  fetchAnalytics,
  type AnalyticsView,
} from "@/lib/admin/analyticsApi";
import { allAnalyticsCsvFilename, createAllAnalyticsCsv } from "@/lib/admin/analyticsCsv";
import type {
  AcquisitionRow,
  FunnelReport,
  OverviewReport,
  RecipientGrowthReport,
  ReliabilityReport,
  RetentionReport,
} from "@/lib/analytics/reports";

const VIEW_TABS: { value: AnalyticsView; label: string }[] = [
  { value: "overview", label: "概要" },
  { value: "funnel", label: "ファネル" },
  { value: "reliability", label: "信頼性" },
  { value: "acquisition", label: "流入経路" },
  { value: "retention", label: "継続率" },
  { value: "recipient-growth", label: "受信→送信転換" },
];

const FUNNEL_STEP_LABELS: Record<string, string> = {
  landing_view: "ページ表示",
  file_select: "ファイル選択",
  upload_start: "アップロード開始",
  upload_success: "アップロード完了",
  share: "共有",
  download_success: "ダウンロード完了",
};

const DEVICE_CLASS_LABELS: Record<string, string> = {
  desktop: "パソコン",
  mobile: "スマートフォン",
  tablet: "タブレット",
  unknown: "不明",
};

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 29 * 24 * 60 * 60 * 1000);
  return { from: toDateInputValue(from), to: toDateInputValue(to) };
}

function earliestDate(): string {
  return toDateInputValue(new Date(Date.now() - 364 * 24 * 60 * 60 * 1000));
}

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("ja-JP");
}

export function formatFunnelStepName(name: string): string {
  return FUNNEL_STEP_LABELS[name] ?? name;
}

export function formatDeviceClass(deviceClass: string): string {
  return DEVICE_CLASS_LABELS[deviceClass] ?? deviceClass;
}

export function ScrollableTable({
  label,
  children,
}: {
  label: string;
  children?: ReactNode;
}) {
  return (
    <div
      role="region"
      tabIndex={0}
      aria-label={label}
      className="overflow-x-auto"
    >
      {children}
    </div>
  );
}

function OverviewView({ data }: { data: OverviewReport }) {
  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-3 text-sm font-black">終了日</h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="送信完了数" value={formatNumber(data.today.successfulTransfers)} />
          <Stat label="ユニーク送信者数" value={formatNumber(data.today.uniqueSenders)} />
          <Stat label="アップロード成功率" value={formatPercent(data.today.uploadSuccessRate)} />
          <Stat label="ダウンロード成功率" value={formatPercent(data.today.downloadSuccessRate)} />
        </dl>
      </section>
      <AnalyticsBarChart title="指定期間の主要件数" labels={["送信者", "送信完了", "新規送信者", "受信→送信"]} values={[data.last30Days.uniqueSenders, data.last30Days.successfulTransfers, data.last30Days.newSenders, data.last30Days.recipientToSenderConversions]} />
      <section>
        <h2 className="mb-3 text-sm font-black">指定期間</h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="ユニーク送信者数" value={formatNumber(data.last30Days.uniqueSenders)} />
          <Stat label="送信完了数" value={formatNumber(data.last30Days.successfulTransfers)} />
          <Stat label="新規送信者数" value={formatNumber(data.last30Days.newSenders)} />
          <Stat label="再送信者率" value={formatPercent(data.last30Days.repeatSenderRate)} />
          <Stat
            label="受信者から送信者への転換数"
            value={formatNumber(data.last30Days.recipientToSenderConversions)}
          />
        </dl>
      </section>
    </div>
  );
}

function FunnelView({ data }: { data: FunnelReport }) {
  return (
    <div className="space-y-4">
    <AnalyticsBarChart title="ファネルの件数" labels={data.steps.map((step) => formatFunnelStepName(step.name))} values={data.steps.map((step) => step.count)} />
    <ScrollableTable label="ファネルの表">
      <table className="min-w-[30rem] w-full text-left text-xs">
        <thead>
          <tr className="border-b border-ink/10 text-ink/50">
            <th className="py-2.5 font-bold">段階</th>
            <th className="py-2.5 font-bold">件数</th>
            <th className="py-2.5 font-bold">前段階からの転換率</th>
          </tr>
        </thead>
        <tbody>
          {data.steps.map((step) => (
            <tr key={step.name} className="border-b border-ink/5">
              <td className="py-2.5">{formatFunnelStepName(step.name)}</td>
              <td className="py-2.5">{formatNumber(step.count)}</td>
              <td className="py-2.5">{formatPercent(step.conversionRateFromPrevious)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollableTable>
    </div>
  );
}

function ReliabilityView({ data }: { data: ReliabilityReport }) {
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="アップロード成功率" value={formatPercent(data.uploadSuccessRate)} />
        <Stat label="ダウンロード成功率" value={formatPercent(data.downloadSuccessRate)} />
      </dl>

      <ErrorTable title="アップロードエラー" rows={data.uploadErrorsByCode} />
      <ErrorTable title="ダウンロードエラー" rows={data.downloadErrorsByCode} />

      <RateTable
        title="ファイルサイズ別アップロード成功率"
        rows={data.successRateBySizeBucket.map((r) => ({ key: r.bucket, rate: r.successRate }))}
      />
      <RateTable
        title="端末種別ごとのアップロード成功率"
        rows={data.successRateByDeviceClass.map((r) => ({ key: r.deviceClass, rate: r.successRate }))}
        formatKey={formatDeviceClass}
      />
    </div>
  );
}

function ErrorTable({ title, rows }: { title: string; rows: { code: string; count: number }[] }) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <div>
      <h3 className="mb-1 text-xs font-bold text-ink/50">{title}</h3>
      <table className="w-full text-left text-xs">
        <tbody>
          {rows.map((row) => (
            <tr key={row.code} className="border-b border-ink/5">
              <td className="py-1.5">{row.code}</td>
              <td className="py-1.5">{formatNumber(row.count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RateTable({
  title,
  rows,
  formatKey = (key) => key,
}: {
  title: string;
  rows: { key: string; rate: number | null }[];
  formatKey?: (key: string) => string;
}) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <div>
      <h3 className="mb-1 text-xs font-bold text-ink/50">{title}</h3>
      <table className="w-full text-left text-xs">
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-ink/5">
              <td className="py-1.5">{formatKey(row.key)}</td>
              <td className="py-1.5">{formatPercent(row.rate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AcquisitionView({ data }: { data: { rows: AcquisitionRow[] } }) {
  if (data.rows.length === 0) {
    return <EmptyState />;
  }

  return (
    <ScrollableTable label="流入経路の表">
      <table className="min-w-[48rem] w-full text-left text-xs">
      <thead>
        <tr className="border-b border-ink/10 text-ink/50">
          <th className="py-2 font-bold">流入元</th>
          <th className="py-2 font-bold">メディア</th>
          <th className="py-2 font-bold">キャンペーン</th>
          <th className="py-2 font-bold">流入ページ</th>
          <th className="py-2 font-bold">セッション数</th>
          <th className="py-2 font-bold">新規送信者数</th>
          <th className="py-2 font-bold">アップロード成功数</th>
        </tr>
      </thead>
      <tbody>
        {data.rows.map((row, index) => (
          <tr key={index} className="border-b border-ink/5">
            <td className="py-1.5">{row.source ?? "（直接流入）"}</td>
            <td className="py-1.5">{row.medium ?? "—"}</td>
            <td className="py-1.5">{row.campaign ?? "—"}</td>
            <td className="py-1.5">{row.landingPath ?? "—"}</td>
            <td className="py-1.5">{formatNumber(row.sessions)}</td>
            <td className="py-1.5">{formatNumber(row.newSenders)}</td>
            <td className="py-1.5">{formatNumber(row.uploadSuccesses)}</td>
          </tr>
        ))}
      </tbody>
      </table>
    </ScrollableTable>
  );
}

function RetentionView({ data }: { data: RetentionReport }) {
  return (
    <div className="space-y-4">
      <Stat label="対象送信者数" value={formatNumber(data.cohortSize)} />
      <ScrollableTable label="継続率の表">
        <table className="min-w-[30rem] w-full text-left text-xs">
          <thead>
            <tr className="border-b border-ink/10 text-ink/50">
              {(["1", "7", "14", "30", "60", "90"] as const).map((day) => (
                <th key={day} className="py-2.5 font-bold">{day}日後</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {(["1", "7", "14", "30", "60", "90"] as const).map((day) => (
                <td key={day} className="py-2.5">{formatPercent(data.dayRates[day])}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </ScrollableTable>
    </div>
  );
}

function RecipientGrowthView({ data }: { data: RecipientGrowthReport }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <Stat label="ユニーク受信者数" value={formatNumber(data.uniqueRecipients)} />
      <Stat label="送信案内の表示数" value={formatNumber(data.ctaViews)} />
      <Stat label="送信案内のクリック数" value={formatNumber(data.ctaClicks)} />
      <Stat label="受信者から送信者への転換数" value={formatNumber(data.conversions)} />
      <Stat
        label="平均転換日数"
        value={data.averageDaysToConversion === null ? "—" : data.averageDaysToConversion.toFixed(1)}
      />
    </dl>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-ink/10 bg-paper p-4">
      <dt className="text-[11px] font-bold text-ink/50">{label}</dt>
      <dd className="mt-1 text-lg font-black">{value}</dd>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded border-2 border-ink/10 p-10 text-center text-sm text-ink/50">
      データがありません
    </div>
  );
}

export default function AdminAnalyticsPage() {
  const [view, setView] = useState<AnalyticsView>("overview");
  const [range, setRange] = useState(defaultRange);
  const [appliedRange, setAppliedRange] = useState(defaultRange);
  const [data, setData] = useState<unknown>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState("");
  const [exportError, setExportError] = useState("");

  useEffect(() => {
    let cancelled = false;

    fetchAnalytics(view, appliedRange)
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setError("");
        }
      })
      .catch((unknownErr: unknown) => {
        if (!cancelled) {
          const err = unknownErr instanceof Error ? unknownErr : new Error("不明なエラー");
          setError(err.message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [view, appliedRange]);

  const switchView = (nextView: AnalyticsView) => {
    if (nextView === view) {
      return;
    }

    setIsLoading(true);
    setView(nextView);
  };

  const applyRange = () => {
    if (range.from > range.to) {
      setError("開始日は終了日以前にしてください。");
      return;
    }
    if (new Date(`${range.to}T00:00:00.000Z`).getTime() - new Date(`${range.from}T00:00:00.000Z`).getTime() > 364 * 24 * 60 * 60 * 1000) {
      setError("指定できる期間は直近1年以内です。");
      return;
    }
    setError("");
    setIsLoading(true);
    setAppliedRange(range);
  };

  const downloadCsv = async () => {
    setIsExporting(true);
    setExportError("");
    try {
      const reports = await Promise.all(
        VIEW_TABS.map(async (tab) => [tab.value, await fetchAnalytics(tab.value, appliedRange)] as const)
      );
      const dataByView = Object.fromEntries(reports) as Record<AnalyticsView, unknown>;
      const url = URL.createObjectURL(new Blob([createAllAnalyticsCsv(appliedRange, dataByView)], { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = allAnalyticsCsvFilename(appliedRange.from, appliedRange.to);
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (unknownErr: unknown) {
      const exportError = unknownErr instanceof Error ? unknownErr : new Error("不明なエラー");
      setExportError(`CSVの出力に失敗しました: ${exportError.message}`);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="flex min-h-[calc(100svh-4rem)] flex-1 justify-center p-4">
        <div className="w-full max-w-5xl space-y-6 py-8">
          <AdminNav active="analytics" />

          <div className="space-y-1">
            <h1 className="text-2xl font-black leading-snug tracking-normal">
              計測ダッシュボード
            </h1>
            <p className="max-w-2xl text-xs leading-relaxed text-ink/50">
              匿名化された利用状況の集計データです(ファイル内容・復号鍵・IPアドレス等は含まれません)
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-ink/10 bg-paper p-4">
            <label className="grid gap-1 text-xs font-bold">
              開始日
              <input type="date" value={range.from} min={earliestDate()} max={range.to} onChange={(event) => setRange((current) => ({ ...current, from: event.target.value }))} className="rounded border border-ink/20 bg-paper px-2 py-1.5 font-normal" />
            </label>
            <label className="grid gap-1 text-xs font-bold">
              終了日
              <input type="date" value={range.to} min={range.from} max={toDateInputValue(new Date())} onChange={(event) => setRange((current) => ({ ...current, to: event.target.value }))} className="rounded border border-ink/20 bg-paper px-2 py-1.5 font-normal" />
            </label>
            <button type="button" onClick={applyRange} className="rounded bg-ink px-3 py-2 text-xs font-bold text-paper">期間を適用</button>
            <button type="button" onClick={downloadCsv} disabled={isLoading || isExporting} className="rounded border border-ink/20 px-3 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50">{isExporting ? "CSVを作成中..." : "全レポートをCSVでダウンロード"}</button>
            <p className="basis-full text-xs text-ink/50">詳細レポートは生イベントの保持期限により直近1年まで確認できます。</p>
          </div>

          <nav
            aria-label="分析レポートの種類"
            className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0"
          >
            {VIEW_TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => switchView(tab.value)}
                aria-pressed={view === tab.value}
                className={`shrink-0 rounded px-3 py-1.5 text-xs font-bold transition-colors ${
                  view === tab.value
                    ? "bg-ink text-paper shadow-sm"
                    : "border border-ink/20 text-ink/60 hover:bg-ink/[0.06]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          {error && (
            <div className="rounded border-2 border-brand p-3 text-sm font-bold text-brand">
              {error}
            </div>
          )}

          {exportError && (
            <div className="rounded border-2 border-brand p-3 text-sm font-bold text-brand">
              {exportError}
            </div>
          )}

          {isLoading ? (
            <div className="flex h-40 flex-col items-center justify-center gap-1 rounded border-2 border-ink p-10 text-center">
              <Spinner className="mb-1 h-6 w-6 text-brand" />
              <span className="text-xs font-bold text-ink/50">読み込み中...</span>
            </div>
          ) : !error && data ? (
            <div className="rounded-xl border border-ink/10 bg-paper p-4 sm:p-6">
              {view === "overview" && <OverviewView data={data as OverviewReport} />}
              {view === "funnel" && <FunnelView data={data as FunnelReport} />}
              {view === "reliability" && <ReliabilityView data={data as ReliabilityReport} />}
              {view === "acquisition" && (
                <AcquisitionView data={data as { rows: AcquisitionRow[] }} />
              )}
              {view === "retention" && <RetentionView data={data as RetentionReport} />}
              {view === "recipient-growth" && (
                <RecipientGrowthView data={data as RecipientGrowthReport} />
              )}
            </div>
          ) : null}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
