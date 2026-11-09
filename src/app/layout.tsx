import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PerfectShot: plan your portrait shoot",
  description: "AI shoot planner for beginner photographers: when to shoot, where to stand, what settings to use, and how to pose.",
  applicationName: "PerfectShot",
  appleWebApp: { capable: true, title: "PerfectShot", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#0f0d0b",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-[#0f0d0b] text-stone-100">{children}</body>
    </html>
  );
}
