import type { ReactNode } from "react";
import Script from "@/components/brand/ExternalScript";
import SiteHeader from "@/components/brand/SiteHeader";
import SiteFooter from "@/components/brand/SiteFooter";
import { TURNSTILE_SITE_KEY } from "@/lib/turnstile-client";

type CenteredFormShellProps = {
  title: string;
  description: string;
  children: ReactNode;
  /** タイトル直下に置く補足(通報フォーム間の相互リンクなど)。 */
  notice?: ReactNode;
  /** Turnstile スクリプトを読み込むか。既定は true。 */
  includeTurnstileScript?: boolean;
};

// アカウント・通報など、中央カード型フォーム画面の共通外枠。
export default function CenteredFormShell({
  title,
  description,
  children,
  notice,
  includeTurnstileScript = true,
}: CenteredFormShellProps) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="flex min-h-[calc(100svh-4rem)] flex-1 items-center justify-center p-4">
        <div className="w-full max-w-md space-y-6 rounded-lg border border-ink/10 bg-paper p-6 sm:p-8">
          <div className="space-y-1">
            <h1 className="text-2xl font-black leading-snug tracking-normal">
              {title}
            </h1>
            <p className="text-xs text-ink/50">{description}</p>
          </div>

          {notice}

          {children}
        </div>
      </main>

      <SiteFooter />

      {includeTurnstileScript && TURNSTILE_SITE_KEY && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js"
          strategy="afterInteractive"
        />
      )}
    </div>
  );
}
