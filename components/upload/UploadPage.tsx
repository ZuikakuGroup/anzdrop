import UploadForm from "./uploadForm";
import SiteHeader from "@/components/brand/SiteHeader";
import SiteFooter from "@/components/brand/SiteFooter";
export default function UploadPage() {
  return <UploadForm header={<SiteHeader />} footer={<SiteFooter />} />;
}
