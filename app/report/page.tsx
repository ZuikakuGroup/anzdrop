import ReportForm from "@/components/report/ReportForm";

type PageProps = {
  searchParams: Promise<{
    shareId?: string;
  }>;
};

export default async function Page({
  searchParams,
}: PageProps) {
  const { shareId } = await searchParams;

  return <ReportForm initialShareId={shareId ?? ""} />;
}
