"use client";

import { useState } from "react";
import { ChevronIcon } from "@/components/brand/ShareIcons";

type FaqItem = {
  question: string;
  answer: React.ReactNode;
};

export default function FaqAccordion({ items }: { items: FaqItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div className="divide-y divide-ink/10 border-t border-ink/10">
      {items.map((item, index) => {
        const isOpen = openIndex === index;

        return (
          <div key={item.question} className="py-4">
            <button
              type="button"
              onClick={() => setOpenIndex(isOpen ? null : index)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between gap-4 text-left text-sm font-bold"
            >
              {item.question}
              <ChevronIcon
                className={`h-4 w-4 shrink-0 text-ink/40 transition-transform duration-200 ${
                  isOpen ? "rotate-180" : ""
                }`}
              />
            </button>
            <div
              className={`grid transition-[grid-template-rows] duration-300 ease-out ${
                isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
              }`}
            >
              <div className="min-h-0 overflow-hidden">
                <p className="pt-3 text-sm leading-relaxed text-ink/70">
                  {item.answer}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
