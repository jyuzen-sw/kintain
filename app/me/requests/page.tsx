import type { Metadata } from "next";
import { EmployeeShell } from "../../../components/employee/employee-shell";
import { RequestsView } from "../../../components/employee/requests-view";

export const metadata: Metadata = {
  title: "休暇・欠勤申請",
};

export default function RequestsPage() {
  return (
    <EmployeeShell title="休暇・欠勤申請">
      <RequestsView />
    </EmployeeShell>
  );
}
