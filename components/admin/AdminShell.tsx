import type { ComponentProps, ReactNode } from "react";
import SiteHeader from "@/components/brand/SiteHeader";
import SiteFooter from "@/components/brand/SiteFooter";
import AdminNav from "./AdminNav";

type Props = {
  active: ComponentProps<typeof AdminNav>["active"];
  wide?: boolean;
  children: ReactNode;
};

export default function AdminShell({ active, wide = false, children }: Props) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex min-h-[calc(100svh-4rem)] flex-1 justify-center p-4">
        <div className={`w-full ${wide ? "max-w-5xl" : "max-w-2xl"} space-y-6 py-8`}>
          <AdminNav active={active} />
          {children}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
