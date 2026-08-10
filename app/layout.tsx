import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { PwaStatus } from "../components/shared/pwa-status";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "勤怠",
    template: "%s | 勤怠",
  },
  description: "出退勤、実績確認、休暇・欠勤申請を行う勤怠管理アプリ",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "勤怠",
  },
};

export const viewport: Viewport = {
  colorScheme: "light",
  initialScale: 1,
  themeColor: "#0B6B63",
  viewportFit: "cover",
  width: "device-width",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <a className="skip-link" href="#main-content">
          本文へ移動
        </a>
        <PwaStatus />
        {children}
      </body>
    </html>
  );
}
