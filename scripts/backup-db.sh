#!/bin/bash
# DB 일일 백업 — pg_dump → 서버 내 보관(7일) → S3 사본 (scripts/backup-db-to-s3.mts)   [2026-11-18]
#
# 운영 서버 cron 전용:  0 13 * * * /home/ubuntu/thynC-Ops-System/thynC-Ops-PROD/scripts/backup-db.sh
#   (서버 시각이 UTC라 13:00 UTC = 22:00 KST)
# 이 스크립트가 있는 레포의 .env 에서 접속 정보(DATABASE_URL)와 백업 대상 여부(DB_BACKUP_S3_PREFIX)를 읽는다.
#   - DB_BACKUP_S3_PREFIX 가 없으면 이 환경은 백업 대상이 아니다 → 덤프도 뜨지 않고 종료(코드 3). 운영만 `db-backups` 로 설정.
#   - DB 비밀번호를 이 파일에 적지 않는다(구 ~/scripts/backup-prod-db.sh 는 평문으로 갖고 있었음 — 폐기).
# 덤프 실패 → Slack 알림(.env BACKUP_ALERT_SLACK_CHANNEL). S3 단계 실패 → 그 스크립트가 알림, 서버 내 덤프는 그대로 남는다.
# 선택 환경변수: BACKUP_DIR(기본 ~/backups/db) · BACKUP_LOG(기본 $BACKUP_DIR/backup.log) · DB_BACKUP_S3_PREFIX(.env 대신 지정 — 시험용)
set -u
export TZ=Asia/Seoul   # 파일명·로그 시각을 KST로
APP_DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
ENV_FILE="$APP_DIR/.env"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/db}"
LOG_FILE="${BACKUP_LOG:-$BACKUP_DIR/backup.log}"
KEEP_LOCAL_DAYS=7
TSX="$APP_DIR/node_modules/.bin/tsx"

mkdir -p "$BACKUP_DIR"
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"; }
envval() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"; }

PREFIX="${DB_BACKUP_S3_PREFIX:-$(envval DB_BACKUP_S3_PREFIX)}"
if [ -z "$PREFIX" ]; then
  log "중단: 이 환경은 백업 대상이 아닙니다 — $ENV_FILE 에 DB_BACKUP_S3_PREFIX 없음 (운영 서버에만 설정)"
  exit 3
fi
URL="$(envval DATABASE_URL)"; URL="${URL%%\?*}"
if [ -z "$URL" ]; then log "중단: $ENV_FILE 에 DATABASE_URL 없음"; exit 1; fi
DBNAME="${URL##*/}"
FILE="$BACKUP_DIR/${DBNAME}_$(date +%Y%m%d_%H%M%S).dump"

ts() { (cd "$APP_DIR" && NODE_ENV=production DB_BACKUP_S3_PREFIX="$PREFIX" "$TSX" scripts/backup-db-to-s3.mts "$@") >> "$LOG_FILE" 2>&1; }

log "백업 시작: $(basename "$FILE") (접두 $PREFIX)"
if pg_dump "$URL" --no-owner --no-acl -F c -f "$FILE" 2>> "$LOG_FILE"; then
  log "백업 성공: $(basename "$FILE") ($(du -h "$FILE" | cut -f1))"
else
  log "백업 실패!"
  rm -f "$FILE"
  ts --alert "pg_dump 실패 — $(basename "$FILE") (로그: $LOG_FILE)"
  exit 1
fi

RC=0
ts "$FILE" || { log "S3 보관 실패!"; RC=1; }

find "$BACKUP_DIR" -name "${DBNAME}_*.dump" -mtime +$KEEP_LOCAL_DAYS -delete
log "서버 내 ${KEEP_LOCAL_DAYS}일 지난 백업 정리 완료"
exit $RC
