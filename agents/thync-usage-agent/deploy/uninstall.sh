#!/usr/bin/env bash
# thync-usage-agent 제거. root 로 실행한다:  sudo ./uninstall.sh [--purge]
#   기본: 타이머·서비스·실행 파일을 지운다. 설정(/etc/thync-usage-agent)과 계정은 남긴다.
#   --purge: 설정과 전용 계정까지 지운다. DB 계정(thync_usage_ro)은 직접 지운다:
#            sudo mysql -e "DROP USER 'thync_usage_ro'@'localhost', 'thync_usage_ro'@'127.0.0.1'"
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "root 로 실행하세요: sudo $0" >&2; exit 1; }

systemctl disable --now thync-usage-agent.timer 2>/dev/null || true
systemctl stop thync-usage-agent.service 2>/dev/null || true
rm -f /etc/systemd/system/thync-usage-agent.service /etc/systemd/system/thync-usage-agent.timer
systemctl daemon-reload
rm -rf /opt/thync-usage-agent
echo "제거: 타이머·서비스·실행 파일"

if [[ "${1:-}" == "--purge" ]]; then
  rm -rf /etc/thync-usage-agent
  id thync-usage >/dev/null 2>&1 && userdel thync-usage
  echo "제거: 설정과 계정"
else
  echo "설정(/etc/thync-usage-agent)과 계정(thync-usage)은 남겼습니다. 함께 지우려면 --purge"
fi
