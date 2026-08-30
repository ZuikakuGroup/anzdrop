import LegalLayout from "@/components/legal/LegalLayout";
import { LEGAL_LAST_UPDATED } from "@/lib/legal/constants";
import { buildTokushohoItems } from "@/lib/legal/tokushoho";

export default function TokushohoPage() {
  const items = buildTokushohoItems();

  return (
    <LegalLayout
      title="特定商取引法に基づく表記"
      description="有料プランのご購入にあたっての表示事項です。"
      lastUpdated={LEGAL_LAST_UPDATED}
    >
      <section className="overflow-hidden rounded-lg border border-ink/10 bg-paper">
        <dl className="divide-y divide-ink/10">
          {items.map((item) => (
            <div
              key={item.label}
              className="grid gap-1 p-6 sm:grid-cols-[10rem_1fr] sm:gap-6 sm:p-8"
            >
              <dt className="text-sm font-bold text-ink">{item.label}</dt>
              <dd className="space-y-2 text-sm leading-relaxed text-ink/70">
                {item.lines.map((line, index) => (
                  <p key={index}>{line}</p>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </LegalLayout>
  );
}
