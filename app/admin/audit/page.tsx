import type { Metadata } from "next";
import { Suspense } from "react";
import { AuditAdminView } from "../../../components/admin/audit-admin-view";
import { LoadingPanel } from "../../../components/shared/ui";

export const metadata: Metadata = { title: "監査ログ" };

export default function AdminAuditPage() {
  return <Suspense fallback={<LoadingPanel label="監査ログを準備しています" />}><AuditAdminView /></Suspense>;
}
