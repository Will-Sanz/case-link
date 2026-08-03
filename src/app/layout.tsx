import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: {
    default: "CaseLink",
    template: "%s | CaseLink",
  },
  description:
    "CaseLink helps school case managers turn family needs into structured intervention plans and completed paperwork.",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} h-full`}
    >
      <body className="flex min-h-full flex-col font-sans text-slate-700 antialiased">
        {children}
      </body>
    </html>
  );
}
