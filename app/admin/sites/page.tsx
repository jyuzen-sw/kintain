import type { Metadata } from "next";
import { SitesAdminView } from "../../../components/admin/sites-admin-view";

export const metadata: Metadata = { title: "現場別の勤怠" };

export default function AdminSitesPage() {
  return <SitesAdminView />;
}
