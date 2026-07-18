/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    instrumentationHook: true,
    // @blocknote/server-util은 webpack 번들링과 충돌 → 런타임에 node_modules에서 직접 로드
    serverComponentsExternalPackages: ['@blocknote/server-util'],
  },
};

export default nextConfig;
