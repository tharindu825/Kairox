import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kairox — AI Trading Signals",
  description: "AI-powered cryptocurrency trading signal platform with multi-model analysis, deterministic risk controls, and paper trading.",
  keywords: ["trading", "AI", "signals", "cryptocurrency", "bitcoin", "ethereum"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
