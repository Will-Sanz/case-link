import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
  title: {
    default: "CaseLink",
    template: "%s | CaseLink",
  },
  description:
    "CaseLink helps parents find food support and utility assistance, handle supported next steps, and keep track of progress with control over their information.",
  icons: {
    icon: [{ url: "/favicon.svg?v=4", type: "image/svg+xml" }],
    shortcut: "/favicon.svg?v=4",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${GeistSans.variable} h-full`}>
      <body className="flex min-h-full flex-col font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
