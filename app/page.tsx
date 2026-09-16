import UploadForm from "../components/upload/uploadForm";
import SiteFooter from "../components/brand/SiteFooter";
import SiteHeader from "../components/brand/SiteHeader";

export default function Home() {
  return (
    <UploadForm header={<SiteHeader />} footer={<SiteFooter />} />
  );
}
