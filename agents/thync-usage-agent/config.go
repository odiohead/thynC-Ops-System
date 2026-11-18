package main

import (
	"bufio"
	"errors"
	"fmt"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
)

// 설정 파일 기본 위치. systemd 는 같은 파일을 EnvironmentFile 로 읽어 환경 변수로 넘긴다.
const defaultConfigPath = "/etc/thync-usage-agent/agent.env"

// Config 는 Agent 설정 전체다 (설계 문서 §5.2).
type Config struct {
	Endpoint string // 수신 주소 (…/api/usage-ingest/v1)
	Token    string // 병원 토큰
	ServerID string // 이 서버의 이름 (병원 안에서 유일)

	DBHost     string
	DBPort     int
	DBName     string
	DBUser     string
	DBPassword string

	OrgInclude []string // 비어 있으면 전부
	OrgExclude []string

	StatusBatchRows  int // 상태 이력 1회 전송 행 수
	StatusMaxBatches int // 1회 실행당 상태 이력 전송 횟수 상한
	MeasurementPage  int // 측정 1회 전송 건수
}

var configKeys = []string{
	"USAGE_ENDPOINT", "USAGE_TOKEN", "USAGE_SERVER_ID",
	"DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD",
	"ORG_INCLUDE", "ORG_EXCLUDE",
	"STATUS_BATCH_ROWS", "STATUS_MAX_BATCHES", "MEASUREMENT_PAGE_ROWS",
}

// parseEnvFile 은 KEY=VALUE 줄을 읽는다. 주석(#), 빈 줄, export 접두, 따옴표를 처리한다.
func parseEnvFile(path string) (map[string]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	out := map[string]string{}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		i := strings.IndexByte(line, '=')
		if i <= 0 {
			continue
		}
		key := strings.TrimSpace(line[:i])
		val := strings.TrimSpace(line[i+1:])
		if len(val) >= 2 && (val[0] == '"' && val[len(val)-1] == '"' || val[0] == '\'' && val[len(val)-1] == '\'') {
			val = val[1 : len(val)-1]
		}
		out[key] = val
	}
	return out, sc.Err()
}

// loadConfig 는 설정 파일을 읽고, 같은 이름의 환경 변수가 있으면 그 값을 우선한다.
// path 가 비어 있으면 기본 위치의 파일을 (있을 때만) 읽는다.
func loadConfig(path string) (*Config, error) {
	values := map[string]string{}
	if path != "" {
		v, err := parseEnvFile(path)
		if err != nil {
			return nil, fmt.Errorf("설정 파일을 읽을 수 없습니다: %w", err)
		}
		values = v
	} else if v, err := parseEnvFile(defaultConfigPath); err == nil {
		values = v
	}
	for _, k := range configKeys {
		if v, ok := os.LookupEnv(k); ok {
			values[k] = v
		}
	}
	return configFromValues(values)
}

var serverIDBad = regexp.MustCompile(`[^\w.:@-]`)

func configFromValues(v map[string]string) (*Config, error) {
	get := func(key, def string) string {
		if s, ok := v[key]; ok && strings.TrimSpace(s) != "" {
			return strings.TrimSpace(s)
		}
		return def
	}
	c := &Config{
		Endpoint:   strings.TrimRight(get("USAGE_ENDPOINT", ""), "/"),
		Token:      get("USAGE_TOKEN", ""),
		ServerID:   get("USAGE_SERVER_ID", ""),
		DBHost:     get("DB_HOST", "127.0.0.1"),
		DBName:     get("DB_NAME", "thync"),
		DBUser:     get("DB_USER", ""),
		DBPassword: v["DB_PASSWORD"],
		OrgInclude: splitList(v["ORG_INCLUDE"]),
	}
	// ORG_EXCLUDE 를 빈 값으로 명시하면 제외 없음, 아예 없으면 기본값
	if raw, ok := v["ORG_EXCLUDE"]; ok {
		c.OrgExclude = splitList(raw)
	} else {
		c.OrgExclude = []string{"REF_ORG"}
	}

	var errs []string
	intOf := func(key string, def, min, max int) int {
		s := get(key, "")
		if s == "" {
			return def
		}
		n, err := strconv.Atoi(s)
		if err != nil || n < min || n > max {
			errs = append(errs, fmt.Sprintf("%s: %d~%d 사이의 숫자여야 합니다", key, min, max))
			return def
		}
		return n
	}
	c.DBPort = intOf("DB_PORT", 3306, 1, 65535)
	c.StatusBatchRows = intOf("STATUS_BATCH_ROWS", 5000, 100, 5000)
	c.StatusMaxBatches = intOf("STATUS_MAX_BATCHES", 40, 1, 10000)
	c.MeasurementPage = intOf("MEASUREMENT_PAGE_ROWS", 500, 10, 2000)

	if c.ServerID == "" {
		h, _ := os.Hostname()
		c.ServerID = h
	}
	c.ServerID = serverIDBad.ReplaceAllString(c.ServerID, "-")
	if len(c.ServerID) > 100 {
		c.ServerID = c.ServerID[:100]
	}
	if c.ServerID == "" {
		errs = append(errs, "USAGE_SERVER_ID: 서버 이름을 정할 수 없습니다")
	}

	if c.Endpoint == "" {
		errs = append(errs, "USAGE_ENDPOINT: 수신 주소가 없습니다")
	} else if err := checkEndpoint(c.Endpoint); err != nil {
		errs = append(errs, "USAGE_ENDPOINT: "+err.Error())
	}
	if c.Token == "" {
		errs = append(errs, "USAGE_TOKEN: 병원 토큰이 없습니다")
	}
	if c.DBUser == "" {
		errs = append(errs, "DB_USER: DB 계정이 없습니다")
	}
	if len(errs) > 0 {
		return nil, errors.New(strings.Join(errs, "\n"))
	}
	return c, nil
}

// checkEndpoint 는 HTTPS 주소만 받는다. 로컬 검증을 위해 localhost 만 http 를 허용한다.
func checkEndpoint(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return errors.New("주소 형식이 아닙니다")
	}
	switch u.Scheme {
	case "https":
		return nil
	case "http":
		h := u.Hostname()
		if h == "localhost" || h == "127.0.0.1" || h == "::1" {
			return nil
		}
		return errors.New("https 주소여야 합니다 (http 는 localhost 만 허용)")
	default:
		return errors.New("https 주소여야 합니다")
	}
}

func splitList(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// maskToken 은 로그·점검 출력용으로 토큰 앞 8자만 남긴다.
func maskToken(t string) string {
	if len(t) <= 8 {
		return "****"
	}
	return t[:8] + "…"
}
