import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SiteHeader } from "@/components/SiteHeader";
import { BottomNav } from "@/components/nav/BottomNav";
import { BottomNavVisibilityProvider } from "@/components/nav/BottomNavVisibility";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Bambini — For every little beginning",
  description:
    "Buy and sell baby and children's products near you. Free collection, dynamically priced delivery, and verified sellers.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-brand-bg">
        <BottomNavVisibilityProvider>
          <SiteHeader />
          {/* pb-20 reserves space for BottomNav (mobile only, see
              BottomNav.tsx's own sm:hidden) plus its safe-area inset, so
              page content is never hidden behind it; sm:pb-0 drops that
              reservation once the bottom nav itself disappears. Applied
              unconditionally (not just when BottomNav renders) since a
              layout-level component can't know a route-scoped decision
              made three components down without its own churn — the
              wasted padding on admin/auth pages is a fixed, small,
              acceptable cost for keeping that logic in one place
              (BottomNav.tsx itself). */}
          <main className="flex flex-1 flex-col pb-20 sm:pb-0">{children}</main>
          <BottomNav />
        </BottomNavVisibilityProvider>
      </body>
    </html>
  );
}
