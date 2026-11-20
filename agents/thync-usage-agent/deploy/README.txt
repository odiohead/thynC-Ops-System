thync-usage-agent — thynC 사용량 수집 Agent

무엇을 하나
  이 서버의 thynC DB 에서 사용량 판단에 필요한 기록을 읽어 씨어스 운영관리시스템으로 보낸다.
  한 시간에 한 번 실행되고, 끝나면 종료한다. 상주하지 않는다.

보내는 것
  기관·병동(병상 수)·등록 기기(종류, 시리얼, 구독형 여부)
  측정(측정코드, 병동, 시작·종료 시각, 상태)과 측정에 붙은 기기
  기기 상태 이력(연결·부착·탈락 시각, 배터리)

보내지 않는 것
  환자 이름, 환자번호, 주민번호, 연락처, 주소, 생년월일, 성별, 나이
  생체 신호, 진료 기록, 사용자 계정

서버에 하는 일
  DB 는 조회만 한다(전용 조회 계정, 필요한 테이블만). 파일을 쓰지 않는다. 포트를 열지 않는다.
  밖으로 나가는 통신은 설정한 수신 주소로의 HTTPS 하나뿐이다.

설치
  1) 운영관리시스템 [사용량 > 에이전트 관리]에서 병원을 등록하고 서버 대수를 적는다.
  2) 이 서버에서:
       wget -qO install.sh https://ops.seersthync.com/api/usage-ingest/agent/install.sh && sudo bash install.sh
     병원코드와 서버 이름(기본값 = 호스트명)만 입력한다. 나머지는 스크립트가 한다 —
     실행 파일·서비스 배치, 조회 전용 DB 계정 생성, 서버 등록(이 서버 전용 키 발급), 점검, 타이머 켜기, 첫 실행.
  같은 병원에 서버가 여러 대면 서버마다 같은 병원코드로 설치하고 서버 이름만 다르게 한다.
  다시 실행하면 실행 파일만 새것으로 바꾼다(설정과 키는 그대로).
  서버를 새로 깔아 키를 잃었으면, 에이전트 관리에서 그 서버의 '재등록 허용'을 누른 뒤 같은 이름으로 다시 설치한다.

파일
  /opt/thync-usage-agent/thync-usage-agent        실행 파일
  /etc/thync-usage-agent/agent.env                설정 (수신 주소, 이 서버의 키, DB 계정)
  /etc/systemd/system/thync-usage-agent.service   서비스
  /etc/systemd/system/thync-usage-agent.timer     타이머

자주 쓰는 명령
  점검(보내지 않음)     sudo -u thync-usage /opt/thync-usage-agent/thync-usage-agent check
  지금 한 번 실행       sudo systemctl start thync-usage-agent.service
  최근 실행 결과        systemctl status thync-usage-agent.service
  로그                  journalctl -u thync-usage-agent -n 100
  다음 실행 시각        systemctl list-timers thync-usage-agent.timer
  잠시 멈추기           sudo systemctl disable --now thync-usage-agent.timer
  다시 켜기             sudo systemctl enable --now thync-usage-agent.timer

수신 주소를 바꿀 때 (개발 서버 ↔ 운영 서버)
  키는 수신 서버마다 다르다. agent.env 를 지우고(또는 USAGE_TOKEN 줄을 비우고) 새 주소의 install.sh 로 다시 설치하면
  새 서버에 등록되어 키를 다시 받는다. 병원 토큰(tua_…)을 쓰는 서버는 USAGE_ENDPOINT 와 USAGE_TOKEN 을 함께 바꾼다.

다시 보내야 할 때 (현장에서)
  측정 전체            sudo -u thync-usage /opt/thync-usage-agent/thync-usage-agent run --full
  상태 이력 처음부터   sudo -u thync-usage /opt/thync-usage-agent/thync-usage-agent run --status-from 0
  보통은 필요 없다. 전송이 끊겼다 살아나면 끊긴 지점부터 스스로 이어 보낸다.
