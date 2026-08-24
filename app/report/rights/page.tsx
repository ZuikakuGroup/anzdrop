import RightsHolderReportForm from "@/components/report/RightsHolderReportForm";

type PageProps = {
  searchParams: Promise<{
    shareId?: string;
  }>;
};

export default async function Page({
  searchParams,
}: PageProps) {
  const { shareId } = await searchParams;

  return <RightsHolderReportForm initialShareId={shareId ?? ""} />;
}
