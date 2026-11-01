import type { Metadata, Viewport } from "next";
import { Inter, Source_Serif_4 } from "next/font/google";
import { cn } from "@/lib/utils";
import { Providers } from "./providers";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-source-serif",
  display: "swap",
});

const description =
  "FolioMind helps students, researchers, and independent publishers organize documents, understand their contents, compare sources, and create polished PDFs.";

export const metadata: Metadata = {
  title: {
    default: "FolioMind — Your knowledge, connected.",
    template: "%s · FolioMind",
  },
  description,
  applicationName: "FolioMind",
  openGraph: {
    type: "website",
    siteName: "FolioMind",
    title: "FolioMind — Your knowledge, connected.",
    description,
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F8FAFC" },
    { media: "(prefers-color-scheme: dark)", color: "#0B1120" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={cn(inter.variable, sourceSerif.variable)}>
      <body>
        <a
          href="#main"
          className="sr-only z-[100] rounded-button bg-primary px-4 py-2 font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Skip to main content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
