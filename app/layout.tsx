// Person 1: root layout (mobile-first shell; bottom nav goes here).
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FindOn: USC Lost & Found",
  description: "AI-powered campus-wide lost and found for USC.",
  applicationName: "FindOn",
  appleWebApp: { capable: true, title: "FindOn", statusBarStyle: "default" },
};

// Pinch zoom stays on (no maximum-scale). Theme color tints the phone's browser bar cardinal.
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#990000", viewportFit: "cover" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Root layout, so the font loads on every page. The lint rule targets the old pages/ router. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
