import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Fraunces, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";

import "./globals.css";

/*
 * Typography, per build spec Section 0C:
 *
 *   - "large distinctive serif for the main proposition"  -> Fraunces
 *   - "IBM Plex Sans or a close free equivalent for UI text" -> IBM Plex Sans
 *   - "IBM Plex Mono for onchain/proof data"                -> IBM Plex Mono
 *
 * All three are served through `next/font`, which self-hosts them at build
 * time. That matters for two reasons Section 0C calls out: no proprietary font
 * file is committed to the repository, and the browser makes no request to a
 * third-party font host, so there is no external dependency at runtime.
 *
 * `display: "swap"` avoids a blank-text flash if the font is slow.
 */
const display = Fraunces({
  subsets: ["latin"],
  weight: ["500", "600"],
  display: "swap",
  variable: "--font-display",
});

const ui = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-ui",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "UsageBar — pay for what you actually use",
  description:
    "Open one payment tab, let usage build the bill, settle once at the end. A usage-based payment tab built on Solana Payment Channels.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
