#!/usr/bin/env bash
# thync-usage-agent 설치 (Ubuntu, systemd). root 로 실행한다:  sudo ./install.sh
#
# 하는 일
#   1) 전용 시스템 계정 thync-usage 생성 (셸 없음)
#   2) /opt/thync-usage-agent/ 에 실행 파일 배치
#   3) /etc/thync-usage-agent/agent.env 설정 틀 생성 (이미 있으면 그대로 둔다)
#   4) systemd 서비스·타이머 등록
# 타이머는 설정을 채우고 `check` 가 통과한 뒤에 직접 켠다 (아래 안내 참고).
# 다시 실행하면 실행 파일과 서비스 정의만 새것으로 바꾼다 (설정·타이머 상태는 유지).
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "root 로 실행하세요: sudo $0" >&2; exit 1; }
command -v systemctl >/dev/null || { echo "systemd 가 필요합니다" >&2; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
for f in thync-usage-agent thync-usage-agent.service thync-usage-agent.timer agent.env.example; do
  [[ -f "$HERE/$f" ]] || { echo "설치 묶음에 $f 가 없습니다" >&2; exit 1; }
done

if ! id thync-usage >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin thync-usage
  echo "계정 생성: thync-usage"
fi

install -d -m 0755 -o root -g root /opt/thync-usage-agent
install -m 0755 -o root -g root "$HERE/thync-usage-agent" /opt/thync-usage-agent/thync-usage-agent
[[ -f "$HERE/README.txt" ]] && install -m 0644 -o root -g root "$HERE/README.txt" /opt/thync-usage-agent/README.txt
[[ -f "$HERE/create-db-user.sql" ]] && install -m 0644 -o root -g root "$HERE/create-db-user.sql" /opt/thync-usage-agent/create-db-user.sql
[[ -f "$HERE/uninstall.sh" ]] && install -m 0755 -o root -g root "$HERE/uninstall.sh" /opt/thync-usage-agent/uninstall.sh

install -d -m 0750 -o root -g thync-usage /etc/thync-usage-agent
if [[ ! -f /etc/thync-usage-agent/agent.env ]]; then
  install -m 0640 -o root -g thync-usage "$HERE/agent.env.example" /etc/thync-usage-agent/agent.env
  echo "설정 틀 생성: /etc/thync-usage-agent/agent.env"
else
  chown root:thync-usage /etc/thync-usage-agent/agent.env
  chmod 0640 /etc/thync-usage-agent/agent.env
  echo "설정 유지: /etc/thync-usage-agent/agent.env"
fi

install -m 0644 -o root -g root "$HERE/thync-usage-agent.service" /etc/systemd/system/thync-usage-agent.service
install -m 0644 -o root -g root "$HERE/thync-usage-agent.timer" /etc/systemd/system/thync-usage-agent.timer
systemctl daemon-reload

echo
echo "설치 완료: $(/opt/thync-usage-agent/thync-usage-agent version)"
cat <<'GUIDE'

다음 순서로 마무리하세요.
  1) 조회 전용 DB 계정 만들기 (비밀번호를 정해 파일 안의 두 곳에 넣은 뒤):
       sudo mysql < /opt/thync-usage-agent/create-db-user.sql
  2) 설정 채우기 (수신 주소, 병원 토큰, DB 비밀번호):
       sudo nano /etc/thync-usage-agent/agent.env
  3) 점검 (아무것도 보내지 않는다):
       sudo -u thync-usage /opt/thync-usage-agent/thync-usage-agent check
  4) 타이머 켜기:
       sudo systemctl enable --now thync-usage-agent.timer
  5) 바로 한 번 실행해 보기 / 확인:
       sudo systemctl start thync-usage-agent.service
       systemctl status thync-usage-agent.service
       journalctl -u thync-usage-agent -n 50
       systemctl list-timers thync-usage-agent.timer
GUIDE
