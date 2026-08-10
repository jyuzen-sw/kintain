import type { Metadata } from "next";
import { EmployeeShell } from "../../components/employee/employee-shell";
import { TodayDashboard } from "../../components/employee/today-dashboard";

export const metadata: Metadata = {
  title: "今日の勤怠",
};

export default function TodayPage() {
  return (
    <EmployeeShell title="今日の勤怠">
      <TodayDashboard />
    </EmployeeShell>
  );
}
