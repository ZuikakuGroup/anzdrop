"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ChevronIcon } from "@/components/brand/ShareIcons";
import styles from "./BlogPagination.module.css";

type BlogPaginationProps = {
  page: number;
  lastPage: number;
};

export default function BlogPagination({ page, lastPage }: BlogPaginationProps) {
  const router = useRouter();
  const [pageInput, setPageInput] = useState(String(page));

  const navigate = (requestedPage: number) => {
    if (!Number.isInteger(requestedPage) || requestedPage < 1 || requestedPage > lastPage) {
      setPageInput(String(page));
      return;
    }

    router.push(requestedPage === 1 ? "/blog" : `/blog?page=${requestedPage}`);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigate(Number(pageInput));
  };

  return (
    <nav aria-label="ページネーション" className="flex items-center justify-center gap-3 text-sm font-bold">
      <button
        type="button"
        onClick={() => navigate(page - 1)}
        disabled={page === 1}
        aria-label="前のページ"
        className="inline-flex size-8 items-center justify-center rounded text-ink/70 transition-colors hover:bg-ink/[0.06] hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
      >
        <ChevronIcon className="h-4 w-4 rotate-90" />
      </button>
      <form onSubmit={submit} className="flex items-center gap-1.5">
        <label htmlFor="blog-page" className="sr-only">ページ番号</label>
        <input
          id="blog-page"
          name="page"
          type="number"
          inputMode="numeric"
          min={1}
          max={lastPage}
          value={pageInput}
          onChange={(event) => setPageInput(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          className={`${styles.pageInput} size-8 rounded border border-ink/20 bg-paper p-0 text-center tabular-nums outline-none focus:border-brand`}
        />
        <button type="submit" className="sr-only">指定したページへ移動</button>
      </form>
      <button
        type="button"
        onClick={() => navigate(page + 1)}
        disabled={page === lastPage}
        aria-label="次のページ"
        className="inline-flex size-8 items-center justify-center rounded text-ink/70 transition-colors hover:bg-ink/[0.06] hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
      >
        <ChevronIcon className="h-4 w-4 -rotate-90" />
      </button>
    </nav>
  );
}
