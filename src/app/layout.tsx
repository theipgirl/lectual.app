import type { Metadata } from "next";
import { FONT_VARS } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lectual",
  description: "The operating system for boutique IP firms.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={FONT_VARS}>
      <body>{children}</body>
    </html>
  );
}
