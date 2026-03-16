import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PM Pulse",
  description: "Track how you spend your PM time with Claude Code",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${geistMono.variable} font-sans antialiased`}
      >
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(window.matchMedia("(prefers-color-scheme:dark)").matches)document.documentElement.classList.add("dark")}catch(e){}`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
