"use client";

import { useEffect, useState } from "react";
import SiteHeader from "@/components/brand/SiteHeader";
import SiteFooter from "@/components/brand/SiteFooter";
import Spinner from "@/components/brand/Spinner";
import AdminNav from "@/components/admin/AdminNav";
import {
  fetchAnalytics,
  type AnalyticsView,
} from "@/lib/admin/analyticsApi";
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

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("ja-JP");
}

function OverviewView({ data }: { data: OverviewReport }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="mb-2 text-xs font-bold text-ink/50">本日</h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Successful Transfers" value={formatNumber(data.today.successfulTransfers)} />
          <Stat label="Unique Senders" value={formatNumber(data.today.uniqueSenders)} />
          <Stat label="Upload Success Rate" value={formatPercent(data.today.uploadSuccessRate)} />
          <Stat label="Download Success Rate" value={formatPercent(data.today.downloadSuccessRate)} />
        </dl>
      </div>
      <div>
        <h2 className="mb-2 text-xs font-bold text-ink/50">直近30日</h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Unique Senders" value={formatNumber(data.last30Days.uniqueSenders)} />
          <Stat label="Successful Transfers" value={formatNumber(data.last30Days.successfulTransfers)} />
          <Stat label="New Senders" value={formatNumber(data.last30Days.newSenders)} />
          <Stat label="Repeat Sender Rate" value={formatPercent(data.last30Days.repeatSenderRate)} />
          <Stat
            label="Recipient→Sender Conversions"
            value={formatNumber(data.last30Days.recipientToSenderConversions)}
          />
        </dl>
      </div>
    </div>
  );
}

function FunnelView({ data }: { data: FunnelReport }) {
  return (
    <table className="w-full text-left text-xs">
      <thead>
        <tr className="border-b border-ink/10 text-ink/50">
          <th className="py-2 font-bold">段階</th>
          <th className="py-2 font-bold">件数</th>
          <th className="py-2 font-bold">前段階からのConversion</th>
        </tr>
      </thead>
      <tbody>
        {data.steps.map((step) => (
          <tr key={step.name} className="border-b border-ink/5">
            <td className="py-2">{step.name}</td>
            <td className="py-2">{formatNumber(step.count)}</td>
            <td className="py-2">{formatPercent(step.conversionRateFromPrevious)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ReliabilityView({ data }: { data: ReliabilityReport }) {
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Upload Success Rate" value={formatPercent(data.uploadSuccessRate)} />
        <Stat label="Download Success Rate" value={formatPercent(data.downloadSuccessRate)} />
      </dl>

      <ErrorTable title="Upload Errors" rows={data.uploadErrorsByCode} />
      <ErrorTable title="Download Errors" rows={data.downloadErrorsByCode} />

      <RateTable
        title="Size Bucket別 Upload Success Rate"
        rows={data.successRateBySizeBucket.map((r) => ({ key: r.bucket, rate: r.successRate }))}
      />
      <RateTable
        title="Device Class別 Upload Success Rate"
        rows={data.successRateByDeviceClass.map((r) => ({ key: r.deviceClass, rate: r.successRate }))}
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

function RateTable({ title, rows }: { title: string; rows: { key: string; rate: number | null }[] }) {
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
              <td className="py-1.5">{row.key}</td>
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
    <table className="w-full text-left text-xs">
      <thead>
        <tr className="border-b border-ink/10 text-ink/50">
          <th className="py-2 font-bold">Source</th>
          <th className="py-2 font-bold">Medium</th>
          <th className="py-2 font-bold">Campaign</th>
          <th className="py-2 font-bold">Landing Path</th>
          <th className="py-2 font-bold">Sessions</th>
          <th className="py-2 font-bold">New Senders</th>
          <th className="py-2 font-bold">Upload Success</th>
        </tr>
      </thead>
      <tbody>
        {data.rows.map((row, index) => (
          <tr key={index} className="border-b border-ink/5">
            <td className="py-1.5">{row.source ?? "(direct)"}</td>
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
  );
}

function RetentionView({ data }: { data: RetentionReport }) {
  return (
    <div className="space-y-3">
      <Stat label="Cohort Size" value={formatNumber(data.cohortSize)} />
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-ink/10 text-ink/50">
            {(["1", "7", "14", "30", "60", "90"] as const).map((day) => (
              <th key={day} className="py-2 font-bold">Day {day}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {(["1", "7", "14", "30", "60", "90"] as const).map((day) => (
              <td key={day} className="py-1.5">{formatPercent(data.dayRates[day])}</td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function RecipientGrowthView({ data }: { data: RecipientGrowthReport }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <Stat label="Unique Recipients" value={formatNumber(data.uniqueRecipients)} />
      <Stat label="CTA Views" value={formatNumber(data.ctaViews)} />
      <Stat label="CTA Clicks" value={formatNumber(data.ctaClicks)} />
      <Stat label="Recipient→Sender Conversions" value={formatNumber(data.conversions)} />
      <Stat
        label="平均転換日数"
        value={data.averageDaysToConversion === null ? "—" : data.averageDaysToConversion.toFixed(1)}
      />
    </dl>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-ink/10 p-3">
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
  const [data, setData] = useState<unknown>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    fetchAnalytics(view)
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
  }, [view]);

  const switchView = (nextView: AnalyticsView) => {
    if (nextView === view) {
      return;
    }

    setIsLoading(true);
    setView(nextView);
  };

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="flex min-h-[calc(100svh-4rem)] flex-1 justify-center p-4">
        <div className="w-full max-w-3xl space-y-6 py-8">
          <AdminNav active="analytics" />

          <div className="space-y-1">
            <h1 className="text-2xl font-black leading-snug tracking-normal">
              計測ダッシュボード
            </h1>
            <p className="text-xs text-ink/50">
              匿名化された利用状況の集計データです(ファイル内容・復号鍵・IPアドレス等は含まれません)
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {VIEW_TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => switchView(tab.value)}
                className={`rounded px-3 py-1.5 text-xs font-bold transition-colors ${
                  view === tab.value
                    ? "bg-ink text-paper"
                    : "border border-ink/20 text-ink/60 hover:bg-ink/[0.06]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {error && (
            <div className="rounded border-2 border-brand p-3 text-sm font-bold text-brand">
              {error}
            </div>
          )}

          {isLoading ? (
            <div className="flex h-40 flex-col items-center justify-center gap-1 rounded border-2 border-ink p-10 text-center">
              <Spinner className="mb-1 h-6 w-6 text-brand" />
              <span className="text-xs font-bold text-ink/50">読み込み中...</span>
            </div>
          ) : !error && data ? (
            <div className="rounded-lg border border-ink/10 bg-paper p-5">
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
