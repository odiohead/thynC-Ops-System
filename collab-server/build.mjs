/**
 * 위키 협업 서버(Hocuspocus) 번들러.
 * server-util이 끌어오는 jsdom은 런타임에 worker 파일을 동적 require 하므로 번들 불가 → external.
 * @prisma/client(.prisma 포함)는 생성 코드/쿼리엔진을 런타임 로드 → external.
 * 나머지(yjs/blocknote/hocuspocus)는 단일 번들로 묶어 yjs 중복 로드(협업 깨짐)를 방지한다.
 */
import { build } from 'esbuild'

await build({
  entryPoints: ['collab-server/index.mts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'collab-server/dist/index.mjs',
  external: ['@prisma/client', '.prisma/*', 'jsdom'],
  loader: { '.css': 'empty' },
  banner: {
    js: "import { createRequire as __cr } from 'module'; import { fileURLToPath as __f } from 'url'; import { dirname as __d } from 'path'; const require = __cr(import.meta.url); const __filename = __f(import.meta.url); const __dirname = __d(__filename);",
  },
  logLevel: 'info',
})

console.log('[collab] bundled → collab-server/dist/index.mjs')
