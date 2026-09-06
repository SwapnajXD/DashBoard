import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Olympus Control Plane",
  description: "Homelab operations dashboard"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
