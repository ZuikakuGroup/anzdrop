import SiteFooter from "@/components/brand/SiteFooter";
import SiteHeader from "@/components/brand/SiteHeader";

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen flex-col"><SiteHeader /><main className="flex-1 px-4 pb-10 pt-12 sm:px-8 sm:pb-10 sm:pt-14">{children}</main><SiteFooter /></div>;
}
