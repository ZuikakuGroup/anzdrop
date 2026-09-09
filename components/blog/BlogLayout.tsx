import SiteFooter from "@/components/brand/SiteFooter";
import SiteHeader from "@/components/brand/SiteHeader";

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen flex-col"><SiteHeader /><main className="flex-1 px-4 py-10 sm:px-8">{children}</main><SiteFooter /></div>;
}
