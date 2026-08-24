import BrandHeader from "./BrandHeader";
import { GitHubIcon } from "./ShareIcons";

export default function SiteHeader() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-ink/10 bg-paper px-6 sm:px-8">
      <BrandHeader />
      <div className="flex items-center gap-3">
        <a
          href="https://github.com/ZuikakuGroup/anzdrop"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub"
          className="text-ink/70 transition-colors hover:text-ink"
        >
          <GitHubIcon className="h-5 w-5" />
        </a>
        <span className="rounded bg-ink px-2 py-0.5 text-[10px] font-bold tracking-widest text-paper">
          暗号化
        </span>
      </div>
    </header>
  );
}
