import type { Metadata } from "next";
import { Sora, IBM_Plex_Mono } from "next/font/google";
import { SupabaseProvider } from "@/components/providers/supabase-provider";
import "./globals.css";

const sora = Sora({
  variable: "--font-display",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  weight: ["400", "500"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Seven Stones — Crypto & Network Security",
  description:
    "Multiplayer Seven Stones arena demonstrating authentication, secure room join, SHA-256 integrity, and E2E encrypted chat.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${sora.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SupabaseProvider>{children}</SupabaseProvider>
      </body>
    </html>
  );
}
