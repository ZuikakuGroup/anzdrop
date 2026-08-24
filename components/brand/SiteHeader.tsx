import BrandHeader from "./BrandHeader";
import { GitHubIcon } from "./ShareIcons";

export default function SiteHeader() {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-ink/10 bg-paper px-6 sm:px-8">
      <BrandHeader />
      <a
        href="https://github.com/ZuikakuGroup/anzdrop"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="GitHub"
        className="text-ink/70 transition-colors hover:text-ink"
      >
        <GitHubIcon className="h-5 w-5" />
      </a>
    </header>
  );
}
