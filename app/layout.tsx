import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import Navigation from "./components/Navigation";
import MainWrapper from "./components/MainWrapper";
import { ThemeProvider, themeInitScript } from "./components/theme/ThemeProvider";

const pretendard = localFont({
  src: "./fonts/PretendardVariable.woff2",
  variable: "--font-pretendard",
  weight: "45 920",
  display: "swap",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Thync Ops",
  description: "Thync Operations Management",
  appleWebApp: {
    title: "Thync Ops",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // 노치·홈 인디케이터 영역까지 캔버스 확장 (safe-area 유틸리티와 조합)
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0f1c" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        {/* 최초 페인트 전 테마 적용 (FOUC 방지) */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className={`${pretendard.variable} ${geistMono.variable} antialiased`}>
        <ThemeProvider>
          <Navigation />
          <MainWrapper>{children}</MainWrapper>
        </ThemeProvider>
      </body>
    </html>
  );
}
