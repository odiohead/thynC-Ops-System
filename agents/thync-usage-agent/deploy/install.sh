#!/usr/bin/env bash
# thync-usage-agent 설치 (Ubuntu, systemd). root 로 실행한다.
#
# 보통은 운영관리시스템에서 내려받아 실행한다 (수신 주소가 자동으로 들어간다):
#   wget -qO install.sh https://<운영관리시스템>/api/usage-ingest/agent/install.sh && sudo bash install.sh
# 묶음을 직접 풀었으면:
#   sudo ./install.sh --endpoint https://<운영관리시스템>/api/usage-ingest/v1
#
# 묻는 것은 병원코드와 서버 이름(기본값 = 호스트명) 둘이다. 나머지는 스크립트가 한다.
#   1) 전용 시스템 계정 thync-usage 생성, 실행 파일·서비스·타이머 배치
#   2) 병원코드 확인 — 운영관리시스템 [사용량 > 에이전트 관리]에 등록된 병원이어야 한다
#   3) 제품 DB 에 조회 전용 계정 생성 (이미 있으면 비밀번호만 새로 맞춘다)
#   4) 서버 등록 — 이 서버 전용 키를 받아 설정 파일에 저장
#   5) 점검(check) → 타이머 켜기 → 첫 실행
# 이미 설치된 서버에서 다시 실행하면 실행 파일과 서비스 정의만 새것으로 바꾼다(설정·키는 그대로).
#
# 옵션
#   --endpoint URL      수신 주소 (…/api/usage-ingest/v1)
#   --hospital CODE     병원코드 (주면 묻지 않는다)
#   --server NAME       서버 이름 (주면 묻지 않는다. 기본값 호스트명)
#   --yes               확인 질문에 모두 예
#   --db-name NAME      제품 DB 이름 (기본 thync)
#   --no-db-user        DB 계정을 만들지 않는다 — DB_USER·DB_PASSWORD 환경 변수로 이미 있는 계정을 준다
#   --no-service        시스템 계정·systemd 를 건드리지 않는다 (컨테이너·검증용. 타이머도 켜지 않는다)
#   DESTDIR=경로        파일을 이 경로 아래에 놓는다 (검증용)
set -euo pipefail

ENDPOINT="${USAGE_ENDPOINT:-}"
HOSPITAL=""
SERVER=""
YES=0
DB_NAME="${DB_NAME:-thync}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-thync_usage_ro}"
DB_PASSWORD="${DB_PASSWORD:-}"
MAKE_DB_USER=1
SERVICE=1
DESTDIR="${DESTDIR:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --endpoint) ENDPOINT="$2"; shift 2 ;;
    --hospital) HOSPITAL="$2"; shift 2 ;;
    --server) SERVER="$2"; shift 2 ;;
    --db-name) DB_NAME="$2"; shift 2 ;;
    --yes|-y) YES=1; shift ;;
    --no-db-user) MAKE_DB_USER=0; shift ;;
    --no-service) SERVICE=0; shift ;;
    -h|--help) sed -n '2,28p' "$0"; exit 0 ;;
    *) echo "알 수 없는 옵션: $1" >&2; exit 2 ;;
  esac
done

die() { echo "오류: $*" >&2; exit 1; }
step() { echo; echo "▶ $*"; }
# 스크립트가 파이프로 들어와도(wget … | sudo bash) 질문은 터미널에서 받는다
HAS_TTY=0
if { : < /dev/tty; } 2>/dev/null; then HAS_TTY=1; fi
ask() { # ask "질문" "기본값" → 답을 표준 출력에
  local answer=""
  [[ $HAS_TTY -eq 1 ]] || die "입력을 받을 터미널이 없습니다 — --hospital · --server · --yes 옵션으로 값을 주세요"
  # 입력이 끊기면(터미널 닫힘) 멈춘다 — 빈 답으로 같은 질문을 되풀이하지 않게
  read -r -p "$1" answer < /dev/tty || die "입력을 받지 못했습니다 — 다시 실행하세요"
  echo "${answer:-$2}"
}
confirm() { # confirm "질문" → 예면 0
  if [[ $YES -eq 1 ]]; then echo "$1 → 예 (--yes)"; return 0; fi
  local a
  a="$(ask "$1 [Y/n] " "y")"
  [[ "$a" =~ ^[Yy] ]]
}
value_of() { sed -n "s/^$1=//p" <<<"$2" | head -n 1; }

[[ $EUID -eq 0 ]] || die "root 로 실행하세요: sudo bash $0"
HERE="$(cd "$(dirname "$0")" && pwd)"
for f in thync-usage-agent thync-usage-agent.service thync-usage-agent.timer create-db-user.sql; do
  [[ -f "$HERE/$f" ]] || die "설치 묶음에 $f 가 없습니다"
done
if [[ $SERVICE -eq 1 ]]; then
  command -v systemctl >/dev/null || die "systemd 가 필요합니다"
fi
[[ "$DB_NAME" =~ ^[A-Za-z0-9_]+$ ]] || die "DB 이름에는 영문·숫자·_ 만 쓸 수 있습니다: $DB_NAME"
[[ "$DB_USER" =~ ^[A-Za-z0-9_]+$ ]] || die "DB 계정 이름에는 영문·숫자·_ 만 쓸 수 있습니다: $DB_USER"

BIN_DIR="$DESTDIR/opt/thync-usage-agent"
CONF_DIR="$DESTDIR/etc/thync-usage-agent"
UNIT_DIR="$DESTDIR/etc/systemd/system"
BIN="$BIN_DIR/thync-usage-agent"
CONF="$CONF_DIR/agent.env"
RUN_AS=(env)
OWNER_GROUP="root"

# ── 1) 계정·파일·서비스 ─────────────────────────────────────────────────
step "실행 파일과 서비스 배치"
if [[ $SERVICE -eq 1 ]]; then
  if ! id thync-usage >/dev/null 2>&1; then
    useradd --system --no-create-home --shell /usr/sbin/nologin thync-usage
    echo "  계정 생성: thync-usage"
  fi
  OWNER_GROUP="thync-usage"
  RUN_AS=(sudo -u thync-usage env)
fi
install -d -m 0755 "$BIN_DIR" "$UNIT_DIR"
install -m 0755 "$HERE/thync-usage-agent" "$BIN"
for f in README.txt create-db-user.sql agent.env.example; do
  [[ -f "$HERE/$f" ]] && install -m 0644 "$HERE/$f" "$BIN_DIR/$f"
done
[[ -f "$HERE/uninstall.sh" ]] && install -m 0755 "$HERE/uninstall.sh" "$BIN_DIR/uninstall.sh"
install -d -m 0750 -g "$OWNER_GROUP" "$CONF_DIR"
install -m 0644 "$HERE/thync-usage-agent.service" "$UNIT_DIR/thync-usage-agent.service"
install -m 0644 "$HERE/thync-usage-agent.timer" "$UNIT_DIR/thync-usage-agent.timer"
[[ $SERVICE -eq 1 ]] && systemctl daemon-reload
echo "  $("$BIN" version) → $BIN"

finish() {
  step "점검"
  if ! "${RUN_AS[@]}" "$BIN" check --config "$CONF"; then
    echo
    die "점검에서 문제가 나왔습니다. 위 내용을 고친 뒤 이 스크립트를 다시 실행하세요 (등록과 설정은 저장되어 있습니다: $CONF)"
  fi
  if [[ $SERVICE -eq 1 ]]; then
    step "타이머 켜기 · 첫 실행"
    systemctl enable --now thync-usage-agent.timer >/dev/null
    systemctl start --no-block thync-usage-agent.service
    echo "  1시간마다 실행됩니다. 첫 실행은 쌓인 기록을 보내느라 오래 걸릴 수 있습니다."
    echo "  진행 확인: journalctl -u thync-usage-agent -f"
  fi
  echo
  echo "설치 완료."
}

# 이미 키가 들어 있는 설정이 있으면 등록을 다시 하지 않는다 (업그레이드·재실행)
if [[ -f "$CONF" ]] && grep -Eq '^USAGE_TOKEN=.+' "$CONF"; then
  chown "root:$OWNER_GROUP" "$CONF" && chmod 0640 "$CONF"
  echo "  기존 설정 유지: $CONF (등록을 다시 하지 않습니다)"
  finish
  exit 0
fi

# ── 2) 병원코드 확인 ────────────────────────────────────────────────────
[[ -n "$ENDPOINT" ]] || ENDPOINT="$(ask "수신 주소 (예: https://ops.seersthync.com/api/usage-ingest/v1): " "")"
ENDPOINT="${ENDPOINT%/}"
[[ "$ENDPOINT" =~ ^https?://[^[:space:]]+$ ]] || die "수신 주소가 올바르지 않습니다: $ENDPOINT"

step "병원 확인"
TRIES=0
while :; do
  TRIES=$((TRIES + 1))
  [[ $TRIES -le 5 ]] || die "병원코드를 확인하지 못했습니다 — 운영관리시스템 [사용량 > 에이전트 관리]에서 병원코드를 확인한 뒤 다시 실행하세요"
  [[ -n "$HOSPITAL" ]] || HOSPITAL="$(ask "병원코드 (예: HOSP-000038): " "")"
  HOSPITAL="$(tr -d '[:space:]' <<<"$HOSPITAL")"
  if [[ -z "$HOSPITAL" ]]; then continue; fi
  set +e
  CHECK="$("$BIN" enroll-check --endpoint "$ENDPOINT" --hospital "$HOSPITAL")"
  rc=$?
  set -e
  if [[ $rc -ne 0 ]]; then
    # 다시 물을 수 없으면(자동 실행) 여기서 멈춘다
    if [[ $YES -eq 1 || $HAS_TTY -eq 0 ]]; then exit 1; fi
    HOSPITAL=""
    continue
  fi
  NAME="$(value_of hospital_name "$CHECK")"
  echo "  $(value_of registered_servers "$CHECK")/$(value_of expected_servers "$CHECK")대 등록됨$( [[ -n "$(value_of server_names "$CHECK")" ]] && echo " ($(value_of server_names "$CHECK"))" )"
  if confirm "  ${NAME:-병원명 미등록}(${HOSPITAL})에 등록합니다. 맞습니까?"; then break; fi
  HOSPITAL=""
done

DEFAULT_SERVER="$(hostname)"
[[ -n "$SERVER" ]] || { [[ $YES -eq 1 ]] && SERVER="$DEFAULT_SERVER" || SERVER="$(ask "서버 이름 [${DEFAULT_SERVER}]: " "$DEFAULT_SERVER")"; }
[[ "$SERVER" =~ ^[A-Za-z0-9_.:@-]{1,100}$ ]] || die "서버 이름에는 영문·숫자와 . _ : @ - 만 쓸 수 있습니다: $SERVER"

# ── 3) 조회 전용 DB 계정 ────────────────────────────────────────────────
# 등록(4)보다 먼저 한다 — DB 준비가 안 되면 서버 자리를 쓰지 않고 멈춘다.
MYSQL_OPTS=()
MYCNF=""
cleanup() { [[ -n "$MYCNF" ]] && rm -f "$MYCNF"; return 0; }
trap cleanup EXIT

if [[ $MAKE_DB_USER -eq 1 ]]; then
  step "제품 DB 조회 전용 계정 ($DB_USER)"
  command -v mysql >/dev/null || die "mysql 명령이 없습니다 — 제품 DB 가 있는 서버에서 실행하세요 (다른 서버의 DB 를 쓰려면 --no-db-user)"
  if ! mysql -N -B -e 'SELECT 1' >/dev/null 2>&1; then
    echo "  root 로 바로 접속되지 않습니다. MySQL 관리자 계정을 입력하세요 (계정을 만들 때만 쓰고 저장하지 않습니다)."
    ADMIN_USER="$(ask "  MySQL 관리자 계정 [root]: " "root")"
    [[ $HAS_TTY -eq 1 ]] || die "MySQL 관리자 비밀번호를 받을 터미널이 없습니다 — 계정을 직접 만든 뒤 --no-db-user 로 실행하세요"
    read -r -s -p "  비밀번호: " ADMIN_PASS < /dev/tty; echo
    MYCNF="$(mktemp)"; chmod 0600 "$MYCNF"
    printf '[client]\nuser=%s\npassword="%s"\nhost=%s\nport=%s\n' "$ADMIN_USER" "${ADMIN_PASS//\"/\\\"}" "$DB_HOST" "$DB_PORT" > "$MYCNF"
    MYSQL_OPTS=(--defaults-extra-file="$MYCNF")
    mysql "${MYSQL_OPTS[@]}" -N -B -e 'SELECT 1' >/dev/null 2>&1 || die "MySQL 에 접속할 수 없습니다 — 계정을 직접 만든 뒤 --no-db-user 로 다시 실행하세요 ($BIN_DIR/create-db-user.sql)"
  fi
  [[ "$(mysql "${MYSQL_OPTS[@]}" -N -B -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${DB_NAME}' AND table_name='measurement_info'")" == "1" ]] \
    || die "DB '${DB_NAME}' 에 measurement_info 테이블이 없습니다 — 제품 DB 이름이 다르면 --db-name 으로 알려 주세요"
  # 영문 대소문자·숫자·기호를 모두 넣는다 (MySQL 비밀번호 정책 대비). sed·SQL·설정 파일에서 특별한 뜻이 없는 글자만 쓴다
  DB_PASSWORD="Tu$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 26)_9k"
  # 새 계정을 만들고 정해진 테이블의 SELECT 만 준다. 다른 계정·테이블·설정은 건드리지 않는다
  sed -e "s/여기에_비밀번호/${DB_PASSWORD}/g" -e "s/thync_usage_ro/${DB_USER}/g" -e "s/ ON thync\\./ ON ${DB_NAME}./g" "$HERE/create-db-user.sql" \
    | mysql "${MYSQL_OPTS[@]}" >/dev/null || die "DB 계정을 만들지 못했습니다"
  echo "  계정 준비 완료 (조회 권한만)"
else
  [[ -n "$DB_PASSWORD" ]] || die "--no-db-user 를 쓰면 DB_USER·DB_PASSWORD 환경 변수로 조회 계정을 알려 줘야 합니다"
fi

# ── 4) 서버 등록 → 설정 저장 ────────────────────────────────────────────
step "서버 등록 ($HOSPITAL / $SERVER)"
set +e
ENROLL="$("$BIN" enroll --endpoint "$ENDPOINT" --hospital "$HOSPITAL" --server "$SERVER")"
rc=$?
set -e
[[ $rc -eq 0 ]] || exit 1
KEY="$(value_of server_key "$ENROLL")"
[[ -n "$KEY" ]] || die "서버 키를 받지 못했습니다"

# 직접 준 비밀번호에 특별한 글자가 있으면 따옴표로 감싼다 (스크립트가 만든 비밀번호는 해당 없음)
DB_PASSWORD_LINE="$DB_PASSWORD"
[[ "$DB_PASSWORD" =~ ^[A-Za-z0-9_.-]+$ ]] || DB_PASSWORD_LINE="\"${DB_PASSWORD//\"/}\""
umask 077
cat > "$CONF" <<CONFEOF
# thync-usage-agent 설정 — install.sh 가 만들었다 ($(date '+%Y-%m-%d %H:%M'))
# 병원 ${HOSPITAL} $(value_of hospital_name "$ENROLL") / 서버 ${SERVER}
USAGE_ENDPOINT=${ENDPOINT}
# 이 서버 전용 키 — 다른 서버에 복사해 쓰지 않는다 (서버 이름과 묶여 있다)
USAGE_TOKEN=${KEY}
USAGE_SERVER_ID=${SERVER}

DB_HOST=${DB_HOST}
DB_PORT=${DB_PORT}
DB_NAME=${DB_NAME}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASSWORD_LINE}

# 그 밖의 항목(ORG_INCLUDE · ORG_EXCLUDE · STATUS_BATCH_ROWS …)은 ${BIN_DIR#"$DESTDIR"}/agent.env.example 참고
CONFEOF
chown "root:$OWNER_GROUP" "$CONF" && chmod 0640 "$CONF"
echo "  등록 완료 — $(value_of registered_servers "$ENROLL")/$(value_of expected_servers "$ENROLL")대, 설정 저장: $CONF"

# ── 5) 점검 → 타이머 → 첫 실행 ──────────────────────────────────────────
finish
