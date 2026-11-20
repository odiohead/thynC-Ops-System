package main

// 등록 — 설치 스크립트(install.sh)가 부르는 명령.
//
//   thync-usage-agent enroll-check --endpoint 주소 --hospital 병원코드
//   thync-usage-agent enroll       --endpoint 주소 --hospital 병원코드 --server 서버이름
//
// 수신부에 "이 병원에 이 이름의 서버를 등록한다"고 요청하고, 그 서버 전용 키를 받는다.
// 병원이 운영관리시스템에 등록되어 있고 서버 자리가 남아 있을 때만 키가 나온다.
// 결과는 셸이 읽기 쉽게 `이름=값` 줄로 표준 출력에 쓴다. 제품 DB 는 건드리지 않는다.
//
// 종료 코드: 0 성공 · 3 등록되지 않은 병원 · 4 자리 없음 · 5 이미 있는 서버 이름 · 6 차단된 서버 · 1 그 밖의 실패

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

type enrollCheckRes struct {
	HospitalCode      string   `json:"hospital_code"`
	HospitalName      *string  `json:"hospital_name"`
	ExpectedServers   int      `json:"expected_servers"`
	RegisteredServers []string `json:"registered_servers"`
	SlotsLeft         int      `json:"slots_left"`
}

type enrollRes struct {
	HospitalCode      string  `json:"hospital_code"`
	HospitalName      *string `json:"hospital_name"`
	ServerID          string  `json:"server_id"`
	ServerKey         string  `json:"server_key"`
	ExpectedServers   int     `json:"expected_servers"`
	RegisteredServers int     `json:"registered_servers"`
}

type enrollErr struct {
	Status  int
	Code    string
	Message string
}

func (e *enrollErr) Error() string { return e.Message }

// enrollExitCode 는 수신부의 사유 코드를 설치 스크립트가 구분할 종료 코드로 바꾼다.
func enrollExitCode(code string) int {
	switch code {
	case "not_registered":
		return 3
	case "no_slot":
		return 4
	case "name_taken":
		return 5
	case "blocked":
		return 6
	}
	return 1
}

// enrollPost 는 인증 없이 JSON 을 보내고 응답을 out 에 푼다. 거부되면 *enrollErr.
func enrollPost(ctx context.Context, endpoint, path string, in any, out any) error {
	raw, err := json.Marshal(in)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(endpoint, "/")+path, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "thync-usage-agent/"+version)
	res, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return fmt.Errorf("수신 서버에 연결할 수 없습니다 (%s): %w", endpoint, err)
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("응답을 읽을 수 없습니다: %w", err)
	}
	if res.StatusCode >= 200 && res.StatusCode < 300 {
		if err := json.Unmarshal(data, out); err != nil {
			return fmt.Errorf("응답 형식이 올바르지 않습니다 (%s): %w", path, err)
		}
		return nil
	}
	var e struct {
		Error string `json:"error"`
		Code  string `json:"code"`
	}
	_ = json.Unmarshal(data, &e)
	msg := e.Error
	if msg == "" {
		msg = fmt.Sprintf("수신 서버가 요청을 거부했습니다 (%s → HTTP %d)", path, res.StatusCode)
	}
	return &enrollErr{Status: res.StatusCode, Code: e.Code, Message: msg}
}

// shellValue 는 `이름=값` 줄에 넣을 값에서 줄바꿈을 없앤다 (셸은 줄 단위로 읽는다).
func shellValue(s string) string {
	return strings.NewReplacer("\r", " ", "\n", " ").Replace(s)
}

// runEnroll 은 enroll-check / enroll 명령을 처리하고 종료 코드를 돌려준다.
func runEnroll(cmd string, args []string) int {
	fs := flag.NewFlagSet(cmd, flag.ExitOnError)
	endpoint := fs.String("endpoint", os.Getenv("USAGE_ENDPOINT"), "수신 주소 (…/api/usage-ingest/v1)")
	hospital := fs.String("hospital", "", "병원코드")
	server := fs.String("server", "", "서버 이름 (병원 안에서 유일)")
	_ = fs.Parse(args)
	if strings.TrimSpace(*endpoint) == "" || strings.TrimSpace(*hospital) == "" {
		fmt.Fprintln(os.Stderr, "--endpoint 와 --hospital 이 필요합니다")
		return 2
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	fail := func(err error) int {
		fmt.Fprintln(os.Stderr, err.Error())
		if e, ok := err.(*enrollErr); ok {
			return enrollExitCode(e.Code)
		}
		return 1
	}
	name := func(p *string) string {
		if p == nil {
			return ""
		}
		return shellValue(*p)
	}

	if cmd == "enroll-check" {
		var out enrollCheckRes
		if err := enrollPost(ctx, *endpoint, "/enroll/check", map[string]any{"hospital_code": strings.TrimSpace(*hospital)}, &out); err != nil {
			return fail(err)
		}
		fmt.Printf("hospital_code=%s\n", shellValue(out.HospitalCode))
		fmt.Printf("hospital_name=%s\n", name(out.HospitalName))
		fmt.Printf("expected_servers=%d\n", out.ExpectedServers)
		fmt.Printf("registered_servers=%d\n", len(out.RegisteredServers))
		fmt.Printf("slots_left=%d\n", out.SlotsLeft)
		fmt.Printf("server_names=%s\n", shellValue(strings.Join(out.RegisteredServers, ", ")))
		return 0
	}

	if strings.TrimSpace(*server) == "" {
		fmt.Fprintln(os.Stderr, "--server 가 필요합니다")
		return 2
	}
	if serverIDBad.MatchString(*server) {
		fmt.Fprintln(os.Stderr, "서버 이름에는 영문·숫자와 . _ : @ - 만 쓸 수 있습니다")
		return 2
	}
	host, _ := os.Hostname()
	var out enrollRes
	err := enrollPost(ctx, *endpoint, "/enroll", map[string]any{
		"hospital_code": strings.TrimSpace(*hospital),
		"server_id":     strings.TrimSpace(*server),
		"hostname":      host,
		"agent_version": version,
	}, &out)
	if err != nil {
		return fail(err)
	}
	fmt.Printf("hospital_code=%s\n", shellValue(out.HospitalCode))
	fmt.Printf("hospital_name=%s\n", name(out.HospitalName))
	fmt.Printf("server_id=%s\n", shellValue(out.ServerID))
	fmt.Printf("server_key=%s\n", shellValue(out.ServerKey))
	fmt.Printf("registered_servers=%d\n", out.RegisteredServers)
	fmt.Printf("expected_servers=%d\n", out.ExpectedServers)
	return 0
}
