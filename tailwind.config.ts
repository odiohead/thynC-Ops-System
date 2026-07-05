import type { Config } from "tailwindcss";

/**
 * 팔레트 브리지: 기존 코드의 gray/blue/... 클래스가 CSS 변수를 참조하도록 재정의.
 * - 라이트: gray=slate 톤 보정, blue=Heritage Blue, 나머지=Tailwind 기본과 동일
 * - 다크: globals.css의 .dark 블록에서 스케일 반전 값으로 전환
 * - 새 코드는 시멘틱 토큰(bg-card, text-muted-foreground 등) 사용을 권장
 */
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
function bridged(family: string) {
  return Object.fromEntries(
    SHADES.map((s) => [s, `hsl(var(--${family}-${s}) / <alpha-value>)`])
  );
}
const BRIDGED_FAMILIES = [
  "gray", "blue", "red", "green", "amber", "emerald",
  "yellow", "purple", "indigo", "rose", "teal", "orange", "sky",
] as const;

const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ...Object.fromEntries(BRIDGED_FAMILIES.map((f) => [f, bridged(f)])),
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--input) / <alpha-value>)",
        ring: "hsl(var(--ring) / <alpha-value>)",
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        card: {
          DEFAULT: "hsl(var(--card) / <alpha-value>)",
          foreground: "hsl(var(--card-foreground) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "hsl(var(--popover) / <alpha-value>)",
          foreground: "hsl(var(--popover-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "hsl(var(--accent) / <alpha-value>)",
          foreground: "hsl(var(--accent-foreground) / <alpha-value>)",
        },
        primary: {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          hover: "hsl(var(--primary-hover) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
          subtle: "hsl(var(--primary-subtle) / <alpha-value>)",
          "subtle-foreground": "hsl(var(--primary-subtle-foreground) / <alpha-value>)",
        },
        success: {
          DEFAULT: "hsl(var(--success) / <alpha-value>)",
          foreground: "hsl(var(--success-foreground) / <alpha-value>)",
          subtle: "hsl(var(--success-subtle) / <alpha-value>)",
          "subtle-foreground": "hsl(var(--success-subtle-foreground) / <alpha-value>)",
        },
        warning: {
          DEFAULT: "hsl(var(--warning) / <alpha-value>)",
          foreground: "hsl(var(--warning-foreground) / <alpha-value>)",
          subtle: "hsl(var(--warning-subtle) / <alpha-value>)",
          "subtle-foreground": "hsl(var(--warning-subtle-foreground) / <alpha-value>)",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
          subtle: "hsl(var(--destructive-subtle) / <alpha-value>)",
          "subtle-foreground": "hsl(var(--destructive-subtle-foreground) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: [
          "var(--font-pretendard)",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Apple SD Gothic Neo",
          "Malgun Gothic",
          "맑은 고딕",
          "Roboto",
          "Helvetica Neue",
          "sans-serif",
        ],
        mono: ["var(--font-geist-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        xs: "0 1px 2px 0 hsl(222 47% 11% / 0.04)",
        sm: "0 1px 2px 0 hsl(222 47% 11% / 0.06), 0 1px 3px 0 hsl(222 47% 11% / 0.05)",
        DEFAULT: "0 1px 3px 0 hsl(222 47% 11% / 0.07), 0 1px 2px -1px hsl(222 47% 11% / 0.06)",
        md: "0 4px 6px -1px hsl(222 47% 11% / 0.08), 0 2px 4px -2px hsl(222 47% 11% / 0.06)",
        lg: "0 10px 20px -4px hsl(222 47% 11% / 0.10), 0 4px 8px -4px hsl(222 47% 11% / 0.06)",
        xl: "0 20px 30px -8px hsl(222 47% 11% / 0.14), 0 8px 12px -6px hsl(222 47% 11% / 0.08)",
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
export default config;
