import type { Metadata } from "next";
import { RequestsAdminView } from "../../../components/admin/requests-admin-view";

export const metadata: Metadata = { title: "申請一覧" };

export default function AdminRequestsPage() {
  return <RequestsAdminView />;
}
