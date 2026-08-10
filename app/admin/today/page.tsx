import type { Metadata } from "next";
import { TodayAdminView } from "../../../components/admin/today-admin-view";

export const metadata: Metadata = { title: "当日の勤怠" };

export default function AdminTodayPage() {
  return <TodayAdminView />;
}
