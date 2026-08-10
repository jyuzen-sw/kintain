import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "../../components/employee/login-form";

export const metadata: Metadata = {
  title: "ログイン",
};

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="login-page" id="main-content" />}>
      <LoginForm />
    </Suspense>
  );
}
