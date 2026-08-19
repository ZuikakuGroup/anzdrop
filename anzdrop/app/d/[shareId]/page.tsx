import DownloadPage from "../../../components/download/DownloadPage";

type PageProps = {
  params: Promise<{
    shareId: string;
  }>;
};

export default async function Page({
  params,
}: PageProps) {
  const { shareId } = await params;

  return <DownloadPage shareId={shareId} />;
}