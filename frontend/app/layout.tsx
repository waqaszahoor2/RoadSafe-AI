import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RoadSafe AI | Live Road Risk Intelligence",
  description: "Live road-risk intelligence using current weather, traffic and validated historical collision data.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
