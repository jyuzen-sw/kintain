import type { Metadata } from "next";
import { Suspense } from "react";
import { EmployeeShell } from "../../../components/employee/employee-shell";
import { HistoryView } from "../../../components/employee/history-view";
import { LoadingPanel } from "../../../components/shared/ui";

export const metadata: Metadata = {
  title: "個人実績",
};

export default function HistoryPage() {
  return (
    <EmployeeShell title="個人実績">
      <Suspense fallback={<LoadingPanel label="月次実績を準備しています" />}>
        <HistoryView />
      </Suspense>
    </EmployeeShell>
  );
}
