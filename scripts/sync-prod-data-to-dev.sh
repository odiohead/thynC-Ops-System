#!/usr/bin/env bash
# PROD 데이터를 이 개발 환경의 DB로 들이붓는다 (DEV 서버 · dev2 공용).  [2026-11-18 개편]
#
# 2026-11-18 운영 서버 이전으로 PROD와 DEV가 서로 다른 호스트가 됐다. 예전 판은 "PROD·DEV DB가 같은 호스트(localhost)"를
# 전제로 PROD DB를 직접 읽었지만, 이제 PROD 데이터는 **PROD가 매일 S3에 올리는 백업 덤프**에서 가져온다.
#   · 이 스크립트는 PROD 서버에 접속하지 않는다(기본) — PROD는 읽지도 쓰지도 않음. `--fresh`만 SSH로 pg_dump(읽기)를 뜬다
#   · 대상 DB는 이 레포 `.env`의 DATABASE_URL. DB 자체·스키마·`_prisma_migrations`는 건드리지 않고 데이터만 교체
#
# 사용법 (레포 어디서든):
#   scripts/sync-prod-data-to-dev.sh              S3의 가장 최신 일일 백업으로 (확인 프롬프트)
#   scripts/sync-prod-data-to-dev.sh --yes        프롬프트 생략
#   scripts/sync-prod-data-to-dev.sh --dry        점검·계획만 출력하고 아무것도 바꾸지 않음
#   scripts/sync-prod-data-to-dev.sh --key=db-backups/daily/thync_ops_YYYYMMDD_HHMMSS.dump   특정 S3 백업
#   scripts/sync-prod-data-to-dev.sh --file=/path/x.dump                                     이미 받아 둔 덤프(custom 포맷)
#   scripts/sync-prod-data-to-dev.sh --fresh      PROD에서 지금 새로 덤프 (SSH 키 필요 — PROD_SSH_KEY·PROD_SSH_HOST)
#
# 순서: 덤프 확보 → 점검(대상 환경·덤프 판독·테이블/컬럼 호환) → [확인] → 이 레포의 PM2 앱 정지 → 대상 DB 백업(항상)
#       → TRUNCATE + 데이터 적재 + DEV 전용 스케줄러 OFF (한 트랜잭션 — 실패하면 전부 롤백, 대상 DB 그대로) → 앱 재기동 → 건수 보고
# 안전장치:
#   · 운영 환경에서는 실행 거부 — `.env`에 DB_BACKUP_S3_PREFIX(운영 표시)가 있거나 대상 DB명이 `_dev`로 끝나지 않으면 중단
#   · 덤프에 있는데 대상에 없는 컬럼이 있으면(대상 스키마가 PROD보다 뒤처짐) 아무것도 바꾸기 전에 중단
#   · 덤프에만 있는 테이블(PROD의 `_bak_*` 등)은 건너뛰고, 대상에만 있는 테이블(미배포 기능)은 비워 둔다
#   · `_prisma_migrations`는 덮어쓰지 않는다
# 필요: 비밀번호 없는 sudo(적재는 FK 트리거를 끄기 위해 postgres 슈퍼유저로 수행), node_modules(tsx), pg 클라이언트
set -euo pipefail

APP_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
ENV_FILE="$APP_DIR/.env"
BACKUP_DIR="${SYNC_BACKUP_DIR:-$HOME/backups/db-sync}"
RETENTION_DAYS=7                      # 이 스크립트가 받은 PROD 덤프(prod_sync_*) 보관
DEV_BACKUP_RETENTION_DAYS=14          # 동기화 직전 대상 DB 백업(dev_before_sync_*) 보관
S3_DAILY_PREFIX="db-backups/daily/"   # PROD 백업 위치 (scripts/backup-db.sh)
PROD_SSH_HOST="${PROD_SSH_HOST:-ubuntu@54.117.160.187}"
PROD_SSH_KEY="${PROD_SSH_KEY:-$HOME/.ssh/joon-board-key.pem}"
PROD_APP_DIR="/home/ubuntu/thynC-Ops-System/thynC-Ops-PROD"
# 적재 직후 끄는 설정 — PROD 값이 따라와 개발 환경이 채널톡을 읽고 시트에 쓰는 것을 막는다
DEV_OFF_KEYS=("channeltalk_as_interval" "channeltalk_voc_interval" "channeltalk_as_intake")
REPORT_TABLES=(public.users public.hospitals public.projects public.tickets public.voc_receipts public.as_receipts public.hospital_devices wiki.wiki_pages)
TS="$(date +%Y%m%d_%H%M%S)"

YES=0; DRY=0; FRESH=0; FILE=""; KEY=""; NO_PM2=0
for a in "$@"; do
  case "$a" in
    --yes) YES=1 ;; --dry) DRY=1 ;; --fresh) FRESH=1 ;; --no-pm2) NO_PM2=1 ;;
    --file=*) FILE="${a#--file=}" ;; --key=*) KEY="${a#--key=}" ;;
    *) echo "알 수 없는 옵션: $a" >&2; exit 2 ;;
  esac
done

log() { echo "[$(date +%H:%M:%S)] $*"; }
err() { echo "[$(date +%H:%M:%S)] 중단: $*" >&2; exit 1; }
envval() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"; }

# ── 대상 환경 점검 ────────────────────────────────────────────────
[[ -f "$ENV_FILE" ]] || err "$ENV_FILE 없음"
[[ -z "$(envval DB_BACKUP_S3_PREFIX)" ]] || err "이 환경은 운영으로 표시돼 있습니다(.env DB_BACKUP_S3_PREFIX). 운영 DB에는 실행하지 않습니다"
URL="${SYNC_TARGET_URL:-$(envval DATABASE_URL)}"; URL="${URL%%\?*}"
[[ -n "$URL" ]] || err ".env에 DATABASE_URL 없음"
DBNAME="${URL##*/}"
[[ "$DBNAME" == *_dev ]] || err "대상 DB($DBNAME)가 개발용(_dev)이 아닙니다"
DBPORT="$(echo "$URL" | sed -nE 's#.*@[^:/]+:([0-9]+)/.*#\1#p')"; DBPORT="${DBPORT:-5432}"
TSX="$APP_DIR/node_modules/.bin/tsx"
PSQL=(psql "$URL" -X -q -v ON_ERROR_STOP=1)
SUPSQL=(sudo -n -u postgres psql -p "$DBPORT" -d "$DBNAME" -X -q -v ON_ERROR_STOP=1)
"${PSQL[@]}" -Atc "select 1" >/dev/null 2>&1 || err "대상 DB($DBNAME) 연결 실패"
sudo -n -u postgres psql -p "$DBPORT" -Atc "select 1" >/dev/null 2>&1 || err "postgres 슈퍼유저 접속 불가(sudo -u postgres psql) — 적재에 필요합니다"
mkdir -p "$BACKUP_DIR"

WORK="$(mktemp -d /tmp/prod-sync.XXXXXX)"; chmod 755 "$WORK"
STOPPED=()
cleanup() {
  rm -rf "$WORK"
  if (( ${#STOPPED[@]} )); then pm2 start "${STOPPED[@]}" >/dev/null 2>&1 || echo "⚠ PM2 재기동 실패 — 직접 확인: pm2 start ${STOPPED[*]}" >&2; fi
}
trap cleanup EXIT

# ── 1. PROD 덤프 확보 ─────────────────────────────────────────────
if [[ -n "$FILE" ]]; then
  [[ -f "$FILE" ]] || err "덤프 파일 없음: $FILE"
  DUMP="$FILE"; SRC="지정 파일"
elif (( FRESH )); then
  [[ -f "$PROD_SSH_KEY" ]] || err "--fresh 는 PROD SSH 키가 필요합니다($PROD_SSH_KEY 없음). 키가 없는 환경에서는 S3 백업을 쓰세요"
  DUMP="$BACKUP_DIR/prod_sync_fresh_${TS}.dump"; SRC="PROD에서 방금 뜬 덤프(SSH, 읽기 전용)"
  log "PROD($PROD_SSH_HOST)에서 새 덤프 뜨는 중…"
  ssh -n -i "$PROD_SSH_KEY" -o ConnectTimeout=15 "$PROD_SSH_HOST" \
    "cd $PROD_APP_DIR && U=\$(grep -E '^DATABASE_URL=' .env | tail -1 | cut -d= -f2- | tr -d '\"') && TZ=Asia/Seoul pg_dump \"\${U%%\\?*}\" --no-owner --no-acl -F c" > "$DUMP" \
    || err "PROD 덤프 실패"
else
  [[ -x "$TSX" ]] || err "node_modules 없음($TSX) — npm install 후 다시 실행"
  if [[ -z "$KEY" ]]; then
    KEY="$(cd "$APP_DIR" && "$TSX" scripts/backup-db-to-s3.mts --list | awk '{print $3}' | grep "^$S3_DAILY_PREFIX" | sort | tail -1 || true)"
    [[ -n "$KEY" ]] || err "S3에 PROD 백업이 없습니다($S3_DAILY_PREFIX)"
  fi
  DUMP="$BACKUP_DIR/prod_sync_$(basename "$KEY")"; SRC="S3 $KEY"
  if [[ -s "$DUMP" ]]; then log "이미 받아 둔 덤프 사용: $DUMP"
  else log "S3에서 내려받는 중: $KEY"; (cd "$APP_DIR" && "$TSX" scripts/backup-db-to-s3.mts --download "$KEY" "$DUMP") >/dev/null || err "S3 내려받기 실패"; fi
fi

# ── 2. 점검 — 덤프 판독·테이블·컬럼 호환 ───────────────────────────
pg_restore --list "$DUMP" > "$WORK/toc.full" 2>/dev/null || err "덤프를 읽을 수 없습니다(custom 포맷 아님?): $DUMP"
DUMPED_AT="$(grep -m1 -E '^;\s+Archive created at' "$WORK/toc.full" | sed -E 's/^;\s+Archive created at\s+//' || true)"
"${PSQL[@]}" -Atc "select schemaname||'.'||tablename from pg_tables where schemaname in ('public','wiki') order by 1" > "$WORK/dev_tables"
grep ' TABLE DATA ' "$WORK/toc.full" | awk '{print $6"."$7}' | sort > "$WORK/dump_tables"
comm -23 "$WORK/dump_tables" "$WORK/dev_tables" > "$WORK/only_in_dump"          # 건너뜀
comm -13 "$WORK/dump_tables" <(grep -v -E '^public\._prisma_migrations$' "$WORK/dev_tables") > "$WORK/only_in_dev"   # 비워 둠
# 적재 목록 = 전체 TOC − (_prisma_migrations, 대상에 없는 테이블)의 TABLE DATA
awk -v skipf="$WORK/only_in_dump" 'BEGIN{while((getline l < skipf)>0) skip[l]=1; skip["public._prisma_migrations"]=1}
  / TABLE DATA /{ if (skip[$6"."$7]) next } {print}' "$WORK/toc.full" > "$WORK/toc.use"
N_LOAD="$(grep -c ' TABLE DATA ' "$WORK/toc.use" || true)"
(( N_LOAD > 0 )) || err "적재할 테이블이 없습니다"
log "적재용 SQL 생성 중… (덤프 $(du -h "$DUMP" | cut -f1))"
pg_restore --data-only --disable-triggers --no-owner --no-privileges -L "$WORK/toc.use" -f "$WORK/load.sql" "$DUMP" || err "덤프 → SQL 변환 실패(덤프가 손상됐을 수 있음)"
chmod 644 "$WORK/load.sql"
"${PSQL[@]}" -At -F $'\t' -c "select table_schema||'.'||table_name, column_name from information_schema.columns where table_schema in ('public','wiki')" > "$WORK/dev_columns"
grep -E '^COPY ' "$WORK/load.sql" > "$WORK/copy_lines" || true
MISSING="$(python3 - "$WORK/copy_lines" "$WORK/dev_columns" <<'PY'
import re, sys
dev = {}
for line in open(sys.argv[2], encoding='utf-8'):
    t, c = line.rstrip('\n').split('\t'); dev.setdefault(t, set()).add(c)
unq = lambda s: s.strip().strip('"')
for line in open(sys.argv[1], encoding='utf-8'):
    m = re.match(r'^COPY (\S+) \((.*)\) FROM stdin;', line)
    if not m: continue
    table = '.'.join(unq(p) for p in m.group(1).split('.'))
    miss = [unq(c) for c in m.group(2).split(', ') if unq(c) not in dev.get(table, set())]
    if miss: print(f"{table}: {', '.join(miss)}")
PY
)"
# 참고 정보 — PROD에는 적용됐는데 대상에는 없는 마이그
pg_restore --data-only -t _prisma_migrations -f "$WORK/mig.sql" "$DUMP" 2>/dev/null || true
PROD_ONLY_MIG="$(python3 - "$WORK/mig.sql" <("${PSQL[@]}" -Atc "select migration_name from public._prisma_migrations") <<'PY'
import re, sys
have = {l.strip() for l in open(sys.argv[2], encoding='utf-8') if l.strip()}
cols, names, incopy = [], [], False
try: lines = open(sys.argv[1], encoding='utf-8').read().split('\n')
except OSError: lines = []
for l in lines:
    m = re.match(r'^COPY \S+ \((.*)\) FROM stdin;', l)
    if m: cols = [c.strip().strip('"') for c in m.group(1).split(', ')]; incopy = True; continue
    if incopy:
        if l == '\\.': break
        f = l.split('\t')
        if 'migration_name' in cols and len(f) > cols.index('migration_name'): names.append(f[cols.index('migration_name')])
print(' '.join(sorted(n for n in names if n not in have)))
PY
)"

echo
echo "  원본      : $SRC"
echo "  덤프 시각 : ${DUMPED_AT:-알 수 없음}  ($(basename "$DUMP"))"
echo "  대상      : $DBNAME @ $(hostname)  (레포 $APP_DIR)"
echo "  적재      : 테이블 ${N_LOAD}개 · 덤프에만 있어 건너뜀 $(wc -l < "$WORK/only_in_dump")개 · 대상에만 있어 비워 둠 $(wc -l < "$WORK/only_in_dev")개 · _prisma_migrations 보존"
[[ -s "$WORK/only_in_dump" ]] && echo "    건너뜀 : $(tr '\n' ' ' < "$WORK/only_in_dump" | cut -c1-300)"
[[ -s "$WORK/only_in_dev" ]] && echo "    비워 둠: $(tr '\n' ' ' < "$WORK/only_in_dev" | cut -c1-300)"
[[ -n "$PROD_ONLY_MIG" ]] && echo "  ⚠ PROD에는 있고 대상에는 없는 마이그: $PROD_ONLY_MIG"
echo
if [[ -n "$MISSING" ]]; then
  echo "대상 DB에 없는 컬럼(덤프에는 있음):" >&2; echo "$MISSING" | sed 's/^/    /' >&2
  err "대상 스키마가 PROD보다 뒤처져 있습니다 — git pull 후 마이그레이션을 적용하고 다시 실행하세요 (아무것도 바꾸지 않았습니다)"
fi
if (( DRY )); then log "--dry: 점검만 했습니다. 아무것도 바꾸지 않았습니다"; exit 0; fi
if (( ! YES )); then
  read -r -p "→ $DBNAME 의 데이터를 위 PROD 덤프로 덮어씁니다. 계속할까요? [y/N] " ans
  [[ "$ans" =~ ^[Yy]$ ]] || { log "취소했습니다"; exit 0; }
fi

# ── 3. 이 레포의 PM2 앱 정지 (DB 연결 정리 — 끝나면 trap이 다시 켠다) ──
if (( ! NO_PM2 )) && command -v pm2 >/dev/null 2>&1; then
  mapfile -t STOPPED < <(pm2 jlist 2>/dev/null | node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{ try { for (const p of JSON.parse(s)) if (p.pm2_env.pm_cwd===process.argv[1] && p.pm2_env.status==="online") console.log(p.name) } catch {} })' "$APP_DIR")
  if (( ${#STOPPED[@]} )); then log "PM2 정지: ${STOPPED[*]}"; pm2 stop "${STOPPED[@]}" >/dev/null; fi
fi

# ── 4. 대상 DB 백업 (항상) ────────────────────────────────────────
DEV_BACKUP="$BACKUP_DIR/dev_before_sync_${TS}.sql.gz"
log "대상 DB 백업: $DEV_BACKUP"
pg_dump "$URL" | gzip > "$DEV_BACKUP"
gzip -t "$DEV_BACKUP" || err "대상 DB 백업 검증 실패 — 적재하지 않았습니다"

# ── 5. TRUNCATE + 적재 + DEV 전용 OFF (한 트랜잭션) ───────────────
TABLES="$("${PSQL[@]}" -Atc "select string_agg(format('%I.%I', schemaname, tablename), ', ' order by 1) from pg_tables where schemaname in ('public','wiki') and tablename <> '_prisma_migrations' and tablename not like '\_bak\_%'")"
OFF_LIST="$(printf "'%s'," "${DEV_OFF_KEYS[@]}")"; OFF_LIST="${OFF_LIST%,}"
log "TRUNCATE + 적재 + DEV 전용 스케줄러 OFF (한 트랜잭션)…"
if ! "${SUPSQL[@]}" --single-transaction \
      -c "TRUNCATE $TABLES RESTART IDENTITY CASCADE;" \
      -f "$WORK/load.sql" \
      -c "UPDATE public.app_settings SET value = 'off' WHERE key IN ($OFF_LIST);" > "$WORK/load.out" 2> "$WORK/load.err"; then
  grep -m5 -E 'ERROR|오류' "$WORK/load.err" >&2 || tail -5 "$WORK/load.err" >&2
  err "적재 실패 — 트랜잭션이 롤백돼 대상 DB는 그대로입니다 (백업: $DEV_BACKUP)"
fi

# ── 6. 재기동·확인 ────────────────────────────────────────────────
if (( ${#STOPPED[@]} )); then
  log "PM2 기동: ${STOPPED[*]}"; pm2 start "${STOPPED[@]}" >/dev/null
  PORT="$(pm2 jlist 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{for(const p of JSON.parse(s)) if(p.pm2_env.pm_cwd===process.argv[1]){const a=(p.pm2_env.args||[]);const i=a.indexOf("-p");if(i>=0){console.log(a[i+1]);return}}}catch{};console.log(3000)})' "$APP_DIR")"
  CODE=000; for _ in $(seq 1 20); do CODE="$(curl -s -o /dev/null -w '%{http_code}' -m 5 "http://localhost:$PORT/login" || true)"; [[ "$CODE" == "200" ]] && break; sleep 2; done
  log "앱 응답(:$PORT/login): $CODE"
  STOPPED=()   # 이미 켰으므로 trap에서 다시 켜지 않는다
fi
COUNTS=""; for t in "${REPORT_TABLES[@]}"; do COUNTS+="${t#*.} $("${PSQL[@]}" -Atc "select count(*) from $t" 2>/dev/null || echo '?') · "; done
log "건수: ${COUNTS% · }"
log "끈 설정: $("${PSQL[@]}" -Atc "select string_agg(key||'='||value, ' ') from public.app_settings where key in ($OFF_LIST)")"

find "$BACKUP_DIR" -maxdepth 1 -type f -name 'prod_sync_*.dump' -mtime +"$RETENTION_DAYS" -delete 2>/dev/null || true
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'prod_data_*.sql' -mtime +"$RETENTION_DAYS" -delete 2>/dev/null || true
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'dev_before_sync_*.sql.gz' -mtime +"$DEV_BACKUP_RETENTION_DAYS" -delete 2>/dev/null || true
log "✓ 완료 — PROD 데이터(${DUMPED_AT:-덤프 시각 미상}) → $DBNAME"
log "  되돌리기: gunzip -c $DEV_BACKUP 으로 복원(스키마 포함 전체 백업)"
