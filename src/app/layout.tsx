import type { Metadata, Viewport } from "next";
import "./globals.css";
import { MintApp } from "@/components/mint-app";
export const metadata: Metadata = {
  title: "MINT · Campus pickup",
  description: "Order campus food and manage your canteen pickup.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon-192.png", apple: "/icon-192.png" },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "MINT" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#A4123F",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <MintApp />
        {children}
      </body>
    </html>
  );
}
