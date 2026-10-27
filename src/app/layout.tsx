import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Jev2Chat · Choice 实验室",
  description: "逐轮选择，观察文本如何生长。",
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
