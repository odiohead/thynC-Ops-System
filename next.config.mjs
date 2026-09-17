import { execSync } from 'node:child_process'

/** 빌드 시점 커밋(short SHA) — `/api/health`의 `buildCommit`으로 노출, 백필 스크립트가 실행 중 서버 빌드를 확인한다(device_condition_location_design.md A.0). git 없으면 '' */
function gitCommit() {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return ''
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    GIT_COMMIT: process.env.GIT_COMMIT ?? gitCommit(),
  },
  experimental: {
    instrumentationHook: true,
    // @blocknote/server-util은 webpack 번들링과 충돌 → 런타임에 node_modules에서 직접 로드
    serverComponentsExternalPackages: ['@blocknote/server-util'],
  },
};

export default nextConfig;
