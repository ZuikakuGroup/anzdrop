import SiteFooter from "../../../components/brand/SiteFooter";
import SiteHeader from "../../../components/brand/SiteHeader";
import UploadForm from "../../../components/upload/uploadForm";

export default function Home() {
  return <UploadForm header={<SiteHeader />} footer={<SiteFooter />} />;
}
