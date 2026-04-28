import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kairox — AI Trading Signals",
  description: "AI-powered cryptocurrency trading signal platform with multi-model analysis, deterministic risk controls, and paper trading.",
  keywords: ["trading", "AI", "signals", "cryptocurrency", "bitcoin", "ethereum"],
  openGraph: {
    title: "Kairox — AI Trading Signals",
    description: "Multi-model AI analysis with deterministic risk controls for cryptocurrency trading.",
    type: "website",
  },
  robots: "index, follow",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0e17",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
