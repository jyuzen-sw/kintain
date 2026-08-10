import type { Metadata } from "next";
import { UserAttendanceView } from "../../../../components/admin/user-attendance-view";

export const metadata: Metadata = { title: "個人月次実績" };

export default async function AdminUserAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
  return <UserAttendanceView initialMonth={month} />;
}
