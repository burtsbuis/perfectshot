import type { Metadata, Viewport } from "next";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/figtree";
import "./globals.css";

export const metadata: Metadata = {
  title: "PerfectShot: plan your portrait shoot around the light",
  description: "AI shoot planner for beginner photographers: when to shoot, where to stand, what settings to use, and how to pose.",
  applicationName: "PerfectShot",
  appleWebApp: { capable: true, title: "PerfectShot", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#161d36",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col antialiased">{children}</body>
    </html>
  );
}
