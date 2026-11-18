package main

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// 이 Agent 가 조회해서는 안 되는 컬럼 (설계 문서 §2 D3 — 환자 식별 정보와 자유 문자열).
var forbiddenColumns = []string{
	"name", "patient_code", "ssn", "birthday", "phone_number", "guardian_phone_number", "address",
	"gender", "gendr", "age", "admdate", "doctor_id", "etc", "message", "mac_address",
}

// source.go 의 모든 쿼리 — 새 쿼리를 추가하면 여기에도 넣는다(아래 TestAllQueriesListed 가 빠진 것을 잡는다).
var allQueries = map[string]string{
	"sqlInfo": sqlInfo, "sqlStatusTables": sqlStatusTables, "sqlOrganizations": sqlOrganizations, "sqlWards": sqlWards,
	"sqlDeviceRegisters": sqlDeviceRegisters, "sqlMeasurementsSince": sqlMeasurementsSince,
	"sqlMeasurementsAll": sqlMeasurementsAll, "sqlMeasurementsByCode": sqlMeasurementsByCode,
	"sqlMeasurementDevices": sqlMeasurementDevices, "sqlMeasurementIndex": sqlMeasurementIndex,
	"sqlMeasurementCountSince": sqlMeasurementCountSince, "sqlMeasurementCountAll": sqlMeasurementCountAll,
	"sqlStatusPage": sqlStatusPage, "sqlStatusCount": sqlStatusCount, "sqlStatusMax": sqlStatusMax,
	"sqlBackupDay": sqlBackupDay, "sqlProbe": sqlProbe, "sqlActiveShards": sqlActiveShards,
}

func TestQueriesDoNotReadPatientColumns(t *testing.T) {
	for name, q := range allQueries {
		lower := strings.ToLower(q)
		for _, col := range forbiddenColumns {
			// 식별자 경계: organization_name 의 name 은 걸리지 않고, m.name / `name` / name, 은 걸린다
			re := regexp.MustCompile(`(^|[^a-z0-9_])` + regexp.QuoteMeta(col) + `([^a-z0-9_]|$)`)
			if re.MatchString(lower) {
				t.Errorf("%s 가 금지 컬럼 %q 을(를) 참조합니다", name, col)
			}
		}
		if regexp.MustCompile(`(?i)select\s+\*|[a-z]\.\*`).MatchString(q) {
			t.Errorf("%s 가 SELECT * 를 씁니다", name)
		}
		if regexp.MustCompile(`(?i)\b(insert|update|delete|replace|alter|drop|create|truncate|grant)\b`).MatchString(q) {
			t.Errorf("%s 에 조회가 아닌 문장이 있습니다", name)
		}
	}
}

// source.go 에 선언된 sql… 상수가 전부 검사 목록에 있는지 확인한다.
func TestAllQueriesListed(t *testing.T) {
	src, err := os.ReadFile("source.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range regexp.MustCompile(`(?m)^\s*(sql[A-Z]\w*)\s*=`).FindAllStringSubmatch(string(src), -1) {
		if _, ok := allQueries[m[1]]; !ok {
			t.Errorf("%s 가 검사 목록(allQueries)에 없습니다", m[1])
		}
	}
	// 쿼리는 source.go 에만 둔다
	files, _ := filepath.Glob("*.go")
	for _, f := range files {
		if f == "source.go" || strings.HasSuffix(f, "_test.go") {
			continue
		}
		b, _ := os.ReadFile(f)
		if regexp.MustCompile(`(?i)"\s*select\s|` + "`" + `\s*select\s`).Match(b) {
			t.Errorf("%s 에 쿼리가 있습니다 — source.go 로 옮기세요", f)
		}
	}
}

func TestOrgCond(t *testing.T) {
	s := &Source{exclude: []string{"REF_ORG"}}
	cond, args := s.orgCond("m.organization_code")
	if cond != "m.organization_code NOT IN (?)" || len(args) != 1 {
		t.Errorf("제외만: %q %v", cond, args)
	}
	s = &Source{include: []string{"A", "B"}, exclude: []string{"REF_ORG"}}
	cond, args = s.orgCond("o.organization_code")
	if cond != "o.organization_code NOT IN (?) AND o.organization_code IN (?,?)" || len(args) != 3 {
		t.Errorf("제외+포함: %q %v", cond, args)
	}
	s = &Source{}
	if cond, args = s.orgCond("x"); cond != "1 = 1" || args != nil {
		t.Errorf("조건 없음: %q %v", cond, args)
	}
}

func TestConfig(t *testing.T) {
	base := map[string]string{
		"USAGE_ENDPOINT": "https://dev.ops.example.com/api/usage-ingest/v1/",
		"USAGE_TOKEN":    "tua_0123456789abcdef0123456789abcdef",
		"DB_USER":        "thync_usage_ro",
		"DB_PASSWORD":    "p@ss w0rd",
	}
	c, err := configFromValues(base)
	if err != nil {
		t.Fatal(err)
	}
	if c.Endpoint != "https://dev.ops.example.com/api/usage-ingest/v1" {
		t.Errorf("끝의 / 를 떼야 합니다: %s", c.Endpoint)
	}
	if c.DBHost != "127.0.0.1" || c.DBPort != 3306 || c.DBName != "thync" {
		t.Errorf("DB 기본값: %+v", c)
	}
	if len(c.OrgExclude) != 1 || c.OrgExclude[0] != "REF_ORG" {
		t.Errorf("ORG_EXCLUDE 기본값: %v", c.OrgExclude)
	}
	if c.StatusBatchRows != 5000 || c.StatusMaxBatches != 40 || c.ServerID == "" {
		t.Errorf("기본값: %+v", c)
	}

	with := func(k, v string) map[string]string {
		m := map[string]string{}
		for kk, vv := range base {
			m[kk] = vv
		}
		m[k] = v
		return m
	}
	if _, err := configFromValues(with("USAGE_ENDPOINT", "http://dev.ops.example.com/api")); err == nil {
		t.Error("http 주소는 거부해야 합니다")
	}
	if _, err := configFromValues(with("USAGE_ENDPOINT", "http://localhost:3110/api/usage-ingest/v1")); err != nil {
		t.Errorf("localhost 는 http 허용: %v", err)
	}
	if _, err := configFromValues(with("USAGE_TOKEN", "")); err == nil {
		t.Error("토큰이 없으면 거부해야 합니다")
	}
	if c, _ := configFromValues(with("ORG_EXCLUDE", "")); c == nil || len(c.OrgExclude) != 0 {
		t.Error("ORG_EXCLUDE 를 비우면 제외 없음")
	}
	if c, _ := configFromValues(with("USAGE_SERVER_ID", "본관 서버#1")); c == nil || regexp.MustCompile(`[^\w.:@-]`).MatchString(c.ServerID) {
		t.Errorf("서버 이름은 허용 문자만: %v", c)
	}
	if _, err := configFromValues(with("STATUS_BATCH_ROWS", "999999")); err == nil {
		t.Error("범위를 벗어난 숫자는 거부해야 합니다")
	}
}

func TestParseEnvFile(t *testing.T) {
	p := filepath.Join(t.TempDir(), "agent.env")
	content := "# 주석\n\nUSAGE_TOKEN=\"tua_abc\"\nexport DB_USER=ro\nDB_PASSWORD='a=b#c'\nORG_INCLUDE = A, B \n"
	if err := os.WriteFile(p, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	v, err := parseEnvFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if v["USAGE_TOKEN"] != "tua_abc" || v["DB_USER"] != "ro" || v["DB_PASSWORD"] != "a=b#c" || v["ORG_INCLUDE"] != "A, B" {
		t.Errorf("파싱 결과: %v", v)
	}
	if got := maskToken("tua_0123456789"); got != "tua_0123…" {
		t.Errorf("maskToken: %s", got)
	}
}
