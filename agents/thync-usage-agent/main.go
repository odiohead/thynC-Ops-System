// thync-usage-agent — thynC 사용량 수집 Agent.
//
// 병원 서버의 제품 DB(thync)를 조회 전용으로 읽어, 사용량 판단에 필요한 원본 행
// (측정·측정 기기·기기 상태 이력·기기 등록·병동·기관)을 운영관리시스템 수신부로 보낸다.
// 계산은 하지 않는다. 환자 식별 정보는 조회하지 않는다.
//
// 상주하지 않는다. systemd 타이머가 주기적으로 `run` 을 실행하고, 실행이 끝나면 종료한다.
// 설계: projects/usage_collection_design.md
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"
)

// 빌드 때 -ldflags "-X main.version=…" 으로 채운다.
var version = "dev"

const usageText = `thync-usage-agent %s — thynC 사용량 수집 Agent

사용법:
  thync-usage-agent run   [--config 파일] [--full] [--status-from 번호]
  thync-usage-agent check [--config 파일]
  thync-usage-agent enroll-check --endpoint 주소 --hospital 병원코드
  thync-usage-agent enroll       --endpoint 주소 --hospital 병원코드 --server 서버이름
  thync-usage-agent version

  run      한 번 수집해서 보낸다 (systemd 타이머가 호출)
             --full               측정을 처음부터 전부 다시 보낸다
             --status-from 번호   기기 상태 이력을 이 번호부터 다시 보낸다 (0 = 처음부터)
  check    DB 접속·권한과 수신 서버 접속을 점검하고, 보낼 양을 보여 준다 (보내지 않는다)
  enroll   이 서버를 병원에 등록하고 서버 키를 받는다 (설치 스크립트가 호출 — 병원이 운영관리시스템에
           등록되어 있고 서버 자리가 남아 있어야 한다). enroll-check 는 병원코드만 확인한다

설정은 %s 에서 읽는다. 같은 이름의 환경 변수가 있으면 그 값을 쓴다.
`

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintf(os.Stderr, usageText, version, defaultConfigPath)
		os.Exit(2)
	}
	cmd := os.Args[1]
	switch cmd {
	case "version", "--version", "-v":
		fmt.Println(version)
		return
	case "help", "--help", "-h":
		fmt.Printf(usageText, version, defaultConfigPath)
		return
	case "enroll", "enroll-check":
		os.Exit(runEnroll(cmd, os.Args[2:]))
	case "run", "check":
	default:
		fmt.Fprintf(os.Stderr, "알 수 없는 명령: %s\n\n", cmd)
		fmt.Fprintf(os.Stderr, usageText, version, defaultConfigPath)
		os.Exit(2)
	}

	fs := flag.NewFlagSet(cmd, flag.ExitOnError)
	configPath := fs.String("config", "", "설정 파일 경로")
	full := fs.Bool("full", false, "측정을 처음부터 전부 다시 보낸다")
	statusFrom := fs.Int64("status-from", -1, "기기 상태 이력을 이 번호부터 다시 보낸다")
	_ = fs.Parse(os.Args[2:])

	cfg, err := loadConfig(*configPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "설정 오류:\n%v\n", err)
		os.Exit(2)
	}

	// 한 번의 실행에 시간 상한을 둔다. 끊기면 다음 실행이 이어서 보낸다.
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Minute)
	defer cancel()
	ctx, stop := signal.NotifyContext(ctx, syscall.SIGTERM, syscall.SIGINT)
	defer stop()

	if cmd == "check" {
		if !runCheck(ctx, cfg) {
			os.Exit(1)
		}
		return
	}
	opts := runOptions{Full: *full}
	if *statusFrom >= 0 {
		opts.StatusFrom = statusFrom
	}
	if err := runSync(ctx, cfg, opts); err != nil {
		fmt.Fprintf(os.Stderr, "실패: %v\n", err)
		os.Exit(1)
	}
}
