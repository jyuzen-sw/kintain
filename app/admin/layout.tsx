import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AdminShell } from "../../components/admin/admin-shell";
import "../../components/admin/admin.css";

export const metadata: Metadata = {
  title: {
    default: "管理画面",
    template: "%s | 勤怠管理",
  },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
