"use client";

import { useId, useState } from "react";
import { ChevronIcon, PlusIcon } from "@/components/brand/ShareIcons";

type FaqItem = {
  question: string;
  answer: React.ReactNode;
};

type FaqAccordionProps = {
  items: FaqItem[];
  native?: boolean;
  marker?: "chevron" | "plus";
  className?: string;
};

export default function FaqAccordion({
  items,
  native = false,
  marker = "chevron",
  className = "divide-y divide-ink/10 border-t border-ink/10",
}: FaqAccordionProps) {
  const baseId = useId();
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  // Astro's public pages keep FAQ interaction native, without hydrating the page.
  if (native) return <div className={className}>{items.map((item) =>
    <details key={item.question} name={baseId} className="group py-5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand sm:text-base [&::-webkit-details-marker]:hidden">
        {item.question}
        {marker === "plus" ? <PlusIcon className="h-5 w-5 shrink-0 text-brand-text transition-transform motion-reduce:transition-none group-open:rotate-45" /> : <ChevronIcon className="h-4 w-4 shrink-0 text-ink/40 transition-transform motion-reduce:transition-none group-open:rotate-180" />}
      </summary>
      <div className="pr-8 pt-3 text-sm leading-7 text-ink/70">{item.answer}</div>
    </details>)}</div>;

  return (
    <div className={className}>
      {items.map((item, index) => {
        const isOpen = openIndex === index;
        const panelId = `${baseId}-panel-${index}`;
        const buttonId = `${baseId}-button-${index}`;

        return (
          <div key={item.question} className="py-5">
            <button
              id={buttonId}
              type="button"
              onClick={() => setOpenIndex(isOpen ? null : index)}
              aria-expanded={isOpen}
              aria-controls={panelId}
              className="flex w-full items-center justify-between gap-4 text-left text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand sm:text-base motion-reduce:transition-none"
            >
              {item.question}
              {marker === "plus" ? (
                <PlusIcon
                  className={`h-5 w-5 shrink-0 text-brand-text transition-transform duration-300 ease-out motion-reduce:transition-none ${
                    isOpen ? "rotate-45" : ""
                  }`}
                />
              ) : (
                <ChevronIcon
                  className={`h-4 w-4 shrink-0 text-ink/40 transition-transform duration-300 ease-out motion-reduce:transition-none ${
                    isOpen ? "rotate-180" : ""
                  }`}
                />
              )}
            </button>
            <div
              id={panelId}
              role="region"
              aria-labelledby={buttonId}
              aria-hidden={!isOpen}
              inert={!isOpen ? true : undefined}
              className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${
                isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
              }`}
            >
              <div className="min-h-0 overflow-hidden">
                <p
                  className={`pr-8 pt-3 text-sm leading-7 text-ink/70 transition-opacity duration-300 ease-out motion-reduce:transition-none ${
                    isOpen ? "opacity-100" : "opacity-0"
                  }`}
                >
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
