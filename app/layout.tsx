import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ăn Vặt House",
  description: "Cửa hàng đồ ăn vặt Trúc Linh.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <body className="antialiased">{children}</body>
    </html>
  );
}
