import type { Metadata } from "next";
import { EmployeePickerView } from "../../../components/admin/employee-picker-view";

export const metadata: Metadata = { title: "個人実績" };

export default function AdminUsersPage() {
  return <EmployeePickerView />;
}
