import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const image = `${origin}/og.png`;

  return {
    title: "Lane Justice — Snap. Clear. Ride.",
    description:
      "Ride through live city traffic and document bike-lane and crosswalk violations.",
    icons: { icon: "/og.png", shortcut: "/og.png" },
    openGraph: {
      title: "Lane Justice",
      description: "Ride the city. Document the violation. Keep moving.",
      type: "website",
      images: [{ url: image, width: 1536, height: 1024, alt: "Lane Justice comic arcade game" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Lane Justice",
      description: "Ride the city. Document the violation. Keep moving.",
      images: [image],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
