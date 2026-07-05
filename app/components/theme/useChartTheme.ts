'use client'

import { useTheme } from './ThemeProvider'

/**
 * recharts 등 JS로 색을 받는 차트용 테마 팔레트.
 * SVG 속성은 CSS 변수를 못 읽으므로 라이트/다크 값을 직접 분기한다.
 */
export function useChartTheme() {
  const { theme } = useTheme()
  const dark = theme === 'dark'
  return {
    dark,
    grid: dark ? 'hsl(217 30% 20%)' : '#eef2f7',
    tick: dark ? 'hsl(215 20% 62%)' : '#64748b',
    tooltip: {
      fontSize: 12,
      borderRadius: 8,
      border: dark ? '1px solid hsl(217 30% 20%)' : '1px solid #e2e8f0',
      backgroundColor: dark ? 'hsl(222 33% 11%)' : '#ffffff',
      color: dark ? 'hsl(210 40% 96%)' : '#0f172a',
    },
    // 시리즈 컬러 (다크에서 밝게 보정)
    blue: dark ? '#4B7BFF' : '#2C5CE5',
    emerald: dark ? '#34D399' : '#10B981',
    amber: dark ? '#FBBF24' : '#F59E0B',
    indigo: dark ? '#818CF8' : '#6366F1',
  }
}
