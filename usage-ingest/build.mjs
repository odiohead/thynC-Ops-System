/**
 * 사용량 수신부 번들러 (협업 서버 collab-server/build.mjs 와 같은 방식).
 *
 * 엔트리 2개:
 *  - index.mts   → dist/index.mjs    수신부 프로세스 (PM2 thync-usage-ingest-dev / -prod)
 *  - migrate.mts → dist/migrate.mjs  원본 DB 스키마 적용 스크립트
 *
 * 의존 패키지(pg, dotenv)를 전부 묶으므로 실행에는 node 와 dist 파일만 있으면 된다.
 * pg-native 는 선택 의존이라 묶지 않는다(쓰지 않음).
 */
import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'

// 버전 = 소스 내용의 해시 앞 8자. 소스가 그대로면 dist 도 바이트 단위로 같다 → 재시작 필요 여부를 sha256sum 으로 판단할 수 있다.
const h = createHash('sha256')
for (const f of readdirSync('usage-ingest').filter((n) => n.endsWith('.mts')).sort()) {
  h.update(f).update(readFileSync(`usage-ingest/${f}`))
}
const version = h.digest('hex').slice(0, 8)

await build({
  entryPoints: ['usage-ingest/index.mts', 'usage-ingest/migrate.mts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outdir: 'usage-ingest/dist',
  outExtension: { '.js': '.mjs' },
  external: ['pg-native'],
  define: { __USAGE_INGEST_VERSION__: JSON.stringify(version) },
  banner: {
    js: "import { createRequire as __cr } from 'module'; import { fileURLToPath as __f } from 'url'; import { dirname as __d } from 'path'; const require = __cr(import.meta.url); const __filename = __f(import.meta.url); const __dirname = __d(__filename);",
  },
  logLevel: 'info',
})

console.log(`[usage-ingest] bundled (${version}) → usage-ingest/dist/index.mjs, migrate.mjs`)
