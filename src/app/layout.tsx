import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif, Inter_Tight } from "next/font/google";
import { Suspense } from "react";
import { Backdrop } from "@/components/backdrop";
import { DemoBanner } from "@/components/demo-banner";
import { MotionProvider } from "@/components/motion-provider";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const display = Inter_Tight({ variable: "--font-display", subsets: ["latin"], weight: ["500", "600", "700"] });
const serif = Instrument_Serif({ variable: "--font-serif", subsets: ["latin"], weight: "400", style: ["normal", "italic"] });

export const metadata: Metadata = {
  title: { default: "Citely — answers you can verify", template: "%s · Citely" },
  description: "Ask questions about your documents and get answers grounded in them, with citations to the exact passage.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${display.variable} ${serif.variable} h-full antialiased`}
    >
      <body className="relative flex min-h-full flex-col font-sans">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
          <MotionProvider>
            <Backdrop />
            <Suspense fallback={null}>
              <DemoBanner />
            </Suspense>
            <SiteHeader />
            <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">{children}</main>
            <footer className="border-t border-border/60 py-8 text-center text-xs text-muted-foreground">
              <span className="font-display font-medium text-foreground/80">Citely</span> · hybrid retrieval, grounded
              generation, measured with evals
            </footer>
          </MotionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
