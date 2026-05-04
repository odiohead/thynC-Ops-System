#!/usr/bin/env bash
# PROD DB(thync_ops)의 데이터를 DEV DB(thync_ops_dev)로 복사한다.
# DEV DB 자체는 DROP 하지 않고, 안의 데이터만 PROD 데이터로 덮어쓴다.
#
# 사용법:
#   ./scripts/sync-prod-data-to-dev.sh           # 확인 프롬프트 후 진행
#   ./scripts/sync-prod-data-to-dev.sh --yes     # 프롬프트 생략 (자동 실행용)

set -euo pipefail

# ── 설정 ──────────────────────────────────────────────────────────
PROD_DB="thync_ops"
DEV_DB="thync_ops_dev"
DB_USER="thync"
DB_HOST="localhost"
DB_PORT="5432"

ENV_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.env"
BACKUP_DIR="/home/ubuntu/backups/db-sync"
RETENTION_DAYS=7
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"

# 데이터 동기화에서 제외할 테이블 (DEV 고유 상태 보존)
EXCLUDE_TABLES=("_prisma_migrations")

# ── 비밀번호 로드 (.env DATABASE_URL에서 추출) ────────────────────
[[ -f "$ENV_FILE" ]] || { echo "ERROR: $ENV_FILE 없음" >&2; exit 1; }
DB_PASSWORD="$(grep -E '^DATABASE_URL' "$ENV_FILE" \
  | sed -E 's|.*//[^:]+:([^@]+)@.*|\1|' | head -1)"
[[ -n "$DB_PASSWORD" ]] || { echo "ERROR: .env에서 DB 비밀번호 추출 실패" >&2; exit 1; }
export PGPASSWORD="$DB_PASSWORD"

PSQL=(psql -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT")
PGDUMP=(pg_dump -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT")

# ── 헬퍼 ──────────────────────────────────────────────────────────
log() { echo "[$(date +%H:%M:%S)] $*"; }
err() { echo "[$(date +%H:%M:%S)] ERROR: $*" >&2; exit 1; }

# ── 사전 점검 ─────────────────────────────────────────────────────
mkdir -p "$BACKUP_DIR"

log "PROD/DEV 연결 확인"
"${PSQL[@]}" -d "$PROD_DB" -c "SELECT 1" >/dev/null 2>&1 || err "PROD($PROD_DB) 연결 실패"
"${PSQL[@]}" -d "$DEV_DB"  -c "SELECT 1" >/dev/null 2>&1 || err "DEV($DEV_DB) 연결 실패"

log "스키마 차이 검사 (PROD vs DEV)"
PROD_SCHEMA="$(mktemp)"; DEV_SCHEMA="$(mktemp)"
trap 'rm -f "$PROD_SCHEMA" "$DEV_SCHEMA"' EXIT
# pg_dump가 매 실행마다 찍는 \restrict/\unrestrict 무작위 토큰 라인은 무시
SCHEMA_FILTER='/^\\(restrict|unrestrict) /d'
"${PGDUMP[@]}" -d "$PROD_DB" --schema-only --no-owner --no-comments --no-privileges \
  | sed -E "$SCHEMA_FILTER" > "$PROD_SCHEMA"
"${PGDUMP[@]}" -d "$DEV_DB"  --schema-only --no-owner --no-comments --no-privileges \
  | sed -E "$SCHEMA_FILTER" > "$DEV_SCHEMA"
if ! diff -q "$PROD_SCHEMA" "$DEV_SCHEMA" >/dev/null; then
  echo "─── 스키마 차이 발견 (앞 100줄만 표시) ───" >&2
  diff "$PROD_SCHEMA" "$DEV_SCHEMA" | head -100 >&2
  err "PROD/DEV 스키마가 다릅니다. 먼저 스키마를 맞춘 후 다시 실행하세요."
fi
log "스키마 일치"

# ── 사용자 확인 ───────────────────────────────────────────────────
if [[ "${1:-}" != "--yes" ]]; then
  read -p "→ DEV($DEV_DB) 데이터를 PROD($PROD_DB) 데이터로 덮어씁니다. 계속? [y/N] " ans
  [[ "$ans" =~ ^[Yy]$ ]] || { log "취소됨"; exit 0; }
fi

# ── 1단계: DEV 백업 (롤백용) ──────────────────────────────────────
DEV_BACKUP="$BACKUP_DIR/dev_before_sync_${TIMESTAMP}.sql.gz"
log "DEV 전체 백업 생성: $DEV_BACKUP"
"${PGDUMP[@]}" -d "$DEV_DB" | gzip > "$DEV_BACKUP"

# ── 2단계: PROD 데이터 덤프 ───────────────────────────────────────
PROD_DUMP="$BACKUP_DIR/prod_data_${TIMESTAMP}.sql"
log "PROD 데이터 덤프: $PROD_DUMP"
EXCLUDE_ARGS=()
for t in "${EXCLUDE_TABLES[@]}"; do
  EXCLUDE_ARGS+=(--exclude-table-data="$t")
done
"${PGDUMP[@]}" -d "$PROD_DB" \
  --data-only --no-owner --no-privileges \
  "${EXCLUDE_ARGS[@]}" \
  > "$PROD_DUMP"

# ── 3단계: TRUNCATE + 적재 (단일 트랜잭션) ────────────────────────
log "TRUNCATE 대상 테이블 수집"
EXCLUDE_SQL=""
for t in "${EXCLUDE_TABLES[@]}"; do
  EXCLUDE_SQL+=" AND tablename != '$t'"
done
TABLES="$("${PSQL[@]}" -d "$DEV_DB" -At -c \
  "SELECT string_agg(format('%I.%I', schemaname, tablename), ', ')
   FROM pg_tables WHERE schemaname='public'$EXCLUDE_SQL")"
[[ -n "$TABLES" ]] || err "TRUNCATE 대상 테이블 없음"

log "DEV TRUNCATE + PROD 데이터 적재 (단일 트랜잭션)"
"${PSQL[@]}" -d "$DEV_DB" --single-transaction -v ON_ERROR_STOP=1 \
  -c "TRUNCATE $TABLES RESTART IDENTITY CASCADE;" \
  -f "$PROD_DUMP"

# ── 4단계: 오래된 백업 정리 ───────────────────────────────────────
log "${RETENTION_DAYS}일 이전 백업 정리"
find "$BACKUP_DIR" -type f -mtime +"$RETENTION_DAYS" \( -name "*.sql" -o -name "*.sql.gz" \) -print -delete || true

log "✓ 완료. PROD → DEV 데이터 동기화 성공"
log "  롤백: gunzip -c $DEV_BACKUP | ${PSQL[*]} -d $DEV_DB"
