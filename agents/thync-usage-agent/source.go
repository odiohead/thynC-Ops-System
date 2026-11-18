package main

import (
	"context"
	"database/sql"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
)

// Source 는 병원 서버의 제품 DB(thync, MySQL)를 조회 전용으로 읽는다.
//
// 원칙 (설계 문서 §2 D3, §5.4)
//   - SELECT 만 한다. 세션을 읽기 전용으로 두고, 쿼리마다 실행 시간 상한을 건다.
//   - 조회 컬럼은 이 파일에 고정한다. SELECT * 를 쓰지 않는다.
//   - 환자 식별 컬럼(이름·환자코드·주민번호·연락처·주소·생년월일·성별·나이)과 자유 문자열(etc, message)은 조회하지 않는다.
//     source_test.go 가 이 파일의 모든 쿼리를 검사한다.
//   - 시각은 변환하지 않고 DB 에 있는 문자열 그대로 보낸다.
type Source struct {
	db      *sql.DB
	conn    *sql.Conn
	include []string
	exclude []string
}

const queryTimeoutMs = 120000

func openSource(ctx context.Context, c *Config) (*Source, error) {
	mc := mysql.NewConfig()
	mc.User = c.DBUser
	mc.Passwd = c.DBPassword
	mc.Net = "tcp"
	mc.Addr = fmt.Sprintf("%s:%d", c.DBHost, c.DBPort)
	mc.DBName = c.DBName
	mc.Timeout = 10 * time.Second
	mc.ReadTimeout = 3 * time.Minute
	mc.WriteTimeout = 30 * time.Second
	mc.ParseTime = false                // 시각은 문자열 그대로
	mc.InterpolateParams = true         // 텍스트 프로토콜 — 값이 MySQL 표기 그대로 온다
	mc.Collation = "utf8mb4_general_ci" // 한글 기관명·병동명
	connector, err := mysql.NewConnector(mc)
	if err != nil {
		return nil, err
	}
	db := sql.OpenDB(connector)
	db.SetMaxOpenConns(1)
	conn, err := db.Conn(ctx)
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("DB 접속 실패: %w", err)
	}
	for _, stmt := range []string{
		"SET SESSION TRANSACTION READ ONLY",
		fmt.Sprintf("SET SESSION max_execution_time = %d", queryTimeoutMs),
	} {
		if _, err := conn.ExecContext(ctx, stmt); err != nil {
			conn.Close()
			db.Close()
			return nil, fmt.Errorf("세션 설정 실패 (%s): %w", stmt, err)
		}
	}
	return &Source{db: db, conn: conn, include: c.OrgInclude, exclude: c.OrgExclude}, nil
}

func (s *Source) Close() {
	if s.conn != nil {
		s.conn.Close()
	}
	if s.db != nil {
		s.db.Close()
	}
}

// ── 쿼리 (조회 컬럼 고정) ──────────────────────────────────────────────

const (
	sqlInfo = `SELECT VERSION(), @@session.time_zone, @@system_time_zone, DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s')`

	sqlStatusTables = `SELECT table_name FROM information_schema.tables
WHERE table_schema = DATABASE() AND table_name LIKE 'device\_status\_info\_%'`

	sqlOrganizations = `SELECT o.organization_code, o.organization_name, o.organization_type, o.` + "`level`" + `, o.expiration, o.date_time
FROM organization o
WHERE %s
ORDER BY o.organization_id`

	sqlWards = `SELECT w.ward_code, w.organization_code, w.ward, w.deactivate,
       COUNT(b.sickbed_id),
       COALESCE(SUM(CASE WHEN b.sickbed_id IS NOT NULL AND IFNULL(b.deactivate, 0) = 0 THEN 1 ELSE 0 END), 0)
FROM ward w
LEFT JOIN sickbed b ON b.ward_code = w.ward_code
WHERE %s
GROUP BY w.ward_id, w.ward_code, w.organization_code, w.ward, w.deactivate
ORDER BY w.ward_id`

	sqlDeviceRegisters = `SELECT r.serial_number, r.organization_code, r.device_type, r.device_code, r.ward_code, r.premium,
       r.device_return_status, r.total_use_time, r.total_use_count, r.date_time
FROM device_register r
WHERE r.serial_number IS NOT NULL AND r.serial_number <> '' AND %s
ORDER BY r.device_register_id`

	measurementColumns = `m.measurement_id, m.measurement_code, m.parent_measurement_code, m.parent_type, m.` + "`lead`" + `,
       m.organization_code, m.ward_code, m.sickroom_code, m.sickbed_code, m.measurement_type, m.measurement_status,
       m.patient_status, m.start_date_time, m.end_date_time, m.duration, m.elapsed_time, m.date_time, m.modify_date_time, m.shard`

	// 변동분: 진행 중이거나, 시작·종료·수정·생성 시각 중 하나가 기준 시각 이후
	sqlMeasurementsSince = `SELECT ` + measurementColumns + `
FROM measurement_info m
WHERE m.measurement_id > ? AND %s
  AND (m.measurement_status = 2 OR m.start_date_time >= ? OR m.end_date_time >= ? OR m.modify_date_time >= ? OR m.date_time >= ?)
ORDER BY m.measurement_id
LIMIT ?`

	sqlMeasurementsAll = `SELECT ` + measurementColumns + `
FROM measurement_info m
WHERE m.measurement_id > ? AND %s
ORDER BY m.measurement_id
LIMIT ?`

	sqlMeasurementsByCode = `SELECT ` + measurementColumns + `
FROM measurement_info m
WHERE m.measurement_code IN (%s) AND %s
ORDER BY m.measurement_id`

	sqlMeasurementDevices = `SELECT di.measurement_code, di.device_info_id, di.device_type, di.serial_number, di.device_code, di.` + "`lead`" + `, di.date_time,
       CASE WHEN dr.serial_number IS NULL THEN NULL ELSE IFNULL(dr.premium, 0) END
FROM device_info di
LEFT JOIN device_register dr ON dr.serial_number = di.serial_number
WHERE di.measurement_code IN (%s)
ORDER BY di.device_info_id`

	sqlMeasurementIndex = `SELECT m.measurement_id, m.measurement_code, m.measurement_status, m.modify_date_time
FROM measurement_info m
WHERE m.measurement_id > ? AND %s
ORDER BY m.measurement_id
LIMIT ?`

	sqlMeasurementCountSince = `SELECT COUNT(*)
FROM measurement_info m
WHERE %s
  AND (m.measurement_status = 2 OR m.start_date_time >= ? OR m.end_date_time >= ? OR m.modify_date_time >= ? OR m.date_time >= ?)`

	sqlMeasurementCountAll = `SELECT COUNT(*), COALESCE(SUM(CASE WHEN m.measurement_status = 2 THEN 1 ELSE 0 END), 0)
FROM measurement_info m
WHERE %s`

	// 상태 이력은 번호 순서로 읽는다. 측정을 조인하는 것은 기관 조건 때문이다 (상태 이력에는 기관코드가 없다).
	sqlStatusPage = `SELECT d.device_status_info_id, d.measurement_code, d.device_type, d.serial_number, d.status, d.battery_value,
       d.device_kind, d.date_time
FROM %s d
STRAIGHT_JOIN measurement_info m ON m.measurement_code = d.measurement_code
WHERE d.device_status_info_id > ? AND %s
ORDER BY d.device_status_info_id
LIMIT ?`

	sqlStatusCount = `SELECT COUNT(*)
FROM %s d
STRAIGHT_JOIN measurement_info m ON m.measurement_code = d.measurement_code
WHERE d.device_status_info_id > ? AND d.device_status_info_id <= ? AND %s`

	sqlStatusMax = `SELECT COALESCE(MAX(d.device_status_info_id), 0) FROM %s d`

	sqlBackupDay = `SELECT MIN(g.backup_day), MAX(g.backup_day) FROM global_setting g`

	// 진행 중인 측정이 속한 연도 — 그 연도의 상태 이력 테이블이 보이는지 확인하는 데 쓴다
	sqlActiveShards = `SELECT DISTINCT m.shard
FROM measurement_info m
WHERE m.measurement_status = 2 AND %s`
)

// 권한 점검용 — 테이블마다 한 줄도 읽지 않는 조회를 해 본다.
var requiredTables = []string{"organization", "ward", "sickbed", "device_register", "measurement_info", "device_info", "global_setting"}

const sqlProbe = `SELECT 1 FROM %s LIMIT 0`

var statusTableRe = regexp.MustCompile(`^device_status_info_(\d{4})$`)

func statusTable(year int) string { return fmt.Sprintf("device_status_info_%04d", year) }

// orgCond 는 기관 조건절을 만든다. ORG_EXCLUDE 는 제외, ORG_INCLUDE 가 있으면 그 기관만.
func (s *Source) orgCond(col string) (string, []any) {
	var parts []string
	var args []any
	if len(s.exclude) > 0 {
		parts = append(parts, col+" NOT IN ("+placeholders(len(s.exclude))+")")
		for _, v := range s.exclude {
			args = append(args, v)
		}
	}
	if len(s.include) > 0 {
		parts = append(parts, col+" IN ("+placeholders(len(s.include))+")")
		for _, v := range s.include {
			args = append(args, v)
		}
	}
	if len(parts) == 0 {
		return "1 = 1", nil
	}
	return strings.Join(parts, " AND "), args
}

func placeholders(n int) string {
	if n <= 0 {
		return ""
	}
	return strings.TrimSuffix(strings.Repeat("?,", n), ",")
}

// ── 전송 행 ────────────────────────────────────────────────────────────

type OrganizationRow struct {
	OrganizationCode string  `json:"organization_code"`
	OrganizationName *string `json:"organization_name"`
	OrganizationType *int64  `json:"organization_type"`
	Level            *int64  `json:"level"`
	Expiration       *int64  `json:"expiration"`
	SourceCreatedAt  *string `json:"source_created_at"`
}

type WardRow struct {
	WardCode         string  `json:"ward_code"`
	OrganizationCode *string `json:"organization_code"`
	WardName         *string `json:"ward_name"`
	Deactivate       *int64  `json:"deactivate"`
	BedCount         *int64  `json:"bed_count"`
	BedActiveCount   *int64  `json:"bed_active_count"`
}

type DeviceRegisterRow struct {
	SerialNumber     string  `json:"serial_number"`
	OrganizationCode *string `json:"organization_code"`
	DeviceType       *int64  `json:"device_type"`
	DeviceCode       *string `json:"device_code"`
	WardCode         *string `json:"ward_code"`
	Premium          *int64  `json:"premium"`
	ReturnStatus     *int64  `json:"return_status"`
	TotalUseTime     *int64  `json:"total_use_time"`
	TotalUseCount    *int64  `json:"total_use_count"`
	RegisteredAt     *string `json:"registered_at"`
}

type MeasurementDevice struct {
	DeviceInfoID *int64  `json:"device_info_id"`
	DeviceType   *int64  `json:"device_type"`
	SerialNumber *string `json:"serial_number"`
	DeviceCode   *string `json:"device_code"`
	Lead         *string `json:"lead"`
	AttachedAt   *string `json:"attached_at"`
	Premium      *int64  `json:"premium"`
}

type MeasurementRow struct {
	id                    int64
	MeasurementCode       string              `json:"measurement_code"`
	ParentMeasurementCode *string             `json:"parent_measurement_code"`
	ParentType            *int64              `json:"parent_type"`
	Lead                  *int64              `json:"lead"`
	OrganizationCode      *string             `json:"organization_code"`
	WardCode              *string             `json:"ward_code"`
	SickroomCode          *string             `json:"sickroom_code"`
	SickbedCode           *string             `json:"sickbed_code"`
	MeasurementType       *string             `json:"measurement_type"`
	MeasurementStatus     *int64              `json:"measurement_status"`
	PatientStatus         *int64              `json:"patient_status"`
	StartAt               *string             `json:"start_at"`
	EndAt                 *string             `json:"end_at"`
	DurationHours         *int64              `json:"duration_hours"`
	ElapsedSeconds        *int64              `json:"elapsed_seconds"`
	SourceCreatedAt       *string             `json:"source_created_at"`
	SourceModifiedAt      *string             `json:"source_modified_at"`
	Shard                 *string             `json:"shard"`
	Devices               []MeasurementDevice `json:"devices"`
}

type MeasurementIndexRow struct {
	id                int64
	MeasurementCode   string  `json:"measurement_code"`
	MeasurementStatus *int64  `json:"measurement_status"`
	SourceModifiedAt  *string `json:"source_modified_at"`
}

type StatusRow struct {
	ID              int64   `json:"id"`
	MeasurementCode string  `json:"measurement_code"`
	DeviceType      *int64  `json:"device_type"`
	SerialNumber    *string `json:"serial_number"`
	Status          *int64  `json:"status"`
	BatteryValue    *int64  `json:"battery_value"`
	DeviceKind      *int64  `json:"device_kind"`
	EventAt         *string `json:"event_at"`
}

func nstr(v sql.NullString) *string {
	if !v.Valid {
		return nil
	}
	s := v.String
	return &s
}

func nint(v sql.NullInt64) *int64 {
	if !v.Valid {
		return nil
	}
	n := v.Int64
	return &n
}

// ── 조회 ────────────────────────────────────────────────────────────────

type SourceInfo struct {
	Version  string
	TimeZone string
	Now      string
}

func (s *Source) Info(ctx context.Context) (*SourceInfo, error) {
	var version, sessionTZ, systemTZ, now string
	if err := s.conn.QueryRowContext(ctx, sqlInfo).Scan(&version, &sessionTZ, &systemTZ, &now); err != nil {
		return nil, err
	}
	tz := sessionTZ
	if sessionTZ == "SYSTEM" {
		tz = "SYSTEM(" + systemTZ + ")"
	}
	return &SourceInfo{Version: version, TimeZone: tz, Now: now}, nil
}

// StatusYears 는 있는 상태 이력 테이블의 연도를 오름차순으로 돌려준다.
func (s *Source) StatusYears(ctx context.Context) ([]int, error) {
	rows, err := s.conn.QueryContext(ctx, sqlStatusTables)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var years []int
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		if m := statusTableRe.FindStringSubmatch(name); m != nil {
			y, _ := strconv.Atoi(m[1])
			years = append(years, y)
		}
	}
	sort.Ints(years)
	return years, rows.Err()
}

func (s *Source) Organizations(ctx context.Context) ([]OrganizationRow, error) {
	cond, args := s.orgCond("o.organization_code")
	rows, err := s.conn.QueryContext(ctx, fmt.Sprintf(sqlOrganizations, cond), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []OrganizationRow
	for rows.Next() {
		var code string
		var name, created sql.NullString
		var typ, level, exp sql.NullInt64
		if err := rows.Scan(&code, &name, &typ, &level, &exp, &created); err != nil {
			return nil, err
		}
		out = append(out, OrganizationRow{code, nstr(name), nint(typ), nint(level), nint(exp), nstr(created)})
	}
	return out, rows.Err()
}

func (s *Source) Wards(ctx context.Context) ([]WardRow, error) {
	cond, args := s.orgCond("w.organization_code")
	rows, err := s.conn.QueryContext(ctx, fmt.Sprintf(sqlWards, cond), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []WardRow
	for rows.Next() {
		var code string
		var org, name sql.NullString
		var deact, beds, active sql.NullInt64
		if err := rows.Scan(&code, &org, &name, &deact, &beds, &active); err != nil {
			return nil, err
		}
		out = append(out, WardRow{code, nstr(org), nstr(name), nint(deact), nint(beds), nint(active)})
	}
	return out, rows.Err()
}

func (s *Source) DeviceRegisters(ctx context.Context) ([]DeviceRegisterRow, error) {
	cond, args := s.orgCond("r.organization_code")
	rows, err := s.conn.QueryContext(ctx, fmt.Sprintf(sqlDeviceRegisters, cond), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DeviceRegisterRow
	for rows.Next() {
		var serial string
		var org, code, ward, reg sql.NullString
		var typ, premium, ret, useTime, useCount sql.NullInt64
		if err := rows.Scan(&serial, &org, &typ, &code, &ward, &premium, &ret, &useTime, &useCount, &reg); err != nil {
			return nil, err
		}
		out = append(out, DeviceRegisterRow{serial, nstr(org), nint(typ), nstr(code), nstr(ward), nint(premium), nint(ret), nint(useTime), nint(useCount), nstr(reg)})
	}
	return out, rows.Err()
}

func scanMeasurements(rows *sql.Rows) ([]MeasurementRow, error) {
	defer rows.Close()
	var out []MeasurementRow
	for rows.Next() {
		var m MeasurementRow
		var parent, org, ward, room, bed, mtype, start, end, created, modified, shard sql.NullString
		var ptype, lead, status, pstatus, duration, elapsed sql.NullInt64
		if err := rows.Scan(&m.id, &m.MeasurementCode, &parent, &ptype, &lead, &org, &ward, &room, &bed, &mtype, &status,
			&pstatus, &start, &end, &duration, &elapsed, &created, &modified, &shard); err != nil {
			return nil, err
		}
		m.ParentMeasurementCode, m.ParentType, m.Lead = nstr(parent), nint(ptype), nint(lead)
		m.OrganizationCode, m.WardCode, m.SickroomCode, m.SickbedCode = nstr(org), nstr(ward), nstr(room), nstr(bed)
		m.MeasurementType, m.MeasurementStatus, m.PatientStatus = nstr(mtype), nint(status), nint(pstatus)
		m.StartAt, m.EndAt, m.DurationHours, m.ElapsedSeconds = nstr(start), nstr(end), nint(duration), nint(elapsed)
		m.SourceCreatedAt, m.SourceModifiedAt, m.Shard = nstr(created), nstr(modified), nstr(shard)
		m.Devices = []MeasurementDevice{}
		out = append(out, m)
	}
	return out, rows.Err()
}

// MeasurementsPage 는 번호(afterID) 다음부터 limit 건을 읽는다. since 가 비어 있으면 전체, 있으면 변동분만.
func (s *Source) MeasurementsPage(ctx context.Context, afterID int64, since string, limit int) ([]MeasurementRow, error) {
	cond, orgArgs := s.orgCond("m.organization_code")
	args := []any{afterID}
	args = append(args, orgArgs...)
	var query string
	if since == "" {
		query = fmt.Sprintf(sqlMeasurementsAll, cond)
	} else {
		query = fmt.Sprintf(sqlMeasurementsSince, cond)
		args = append(args, since, since, since, since)
	}
	args = append(args, limit)
	rows, err := s.conn.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	out, err := scanMeasurements(rows)
	if err != nil {
		return nil, err
	}
	return out, s.attachDevices(ctx, out)
}

// MeasurementsByCode 는 지정한 측정만 읽는다 (대조에서 빠졌다고 나온 측정의 재전송).
func (s *Source) MeasurementsByCode(ctx context.Context, codes []string) ([]MeasurementRow, error) {
	if len(codes) == 0 {
		return nil, nil
	}
	cond, orgArgs := s.orgCond("m.organization_code")
	args := make([]any, 0, len(codes)+len(orgArgs))
	for _, c := range codes {
		args = append(args, c)
	}
	args = append(args, orgArgs...)
	rows, err := s.conn.QueryContext(ctx, fmt.Sprintf(sqlMeasurementsByCode, placeholders(len(codes)), cond), args...)
	if err != nil {
		return nil, err
	}
	out, err := scanMeasurements(rows)
	if err != nil {
		return nil, err
	}
	return out, s.attachDevices(ctx, out)
}

// attachDevices 는 측정마다 지금 붙어 있는 기기 전체를 채운다.
func (s *Source) attachDevices(ctx context.Context, ms []MeasurementRow) error {
	if len(ms) == 0 {
		return nil
	}
	index := make(map[string]int, len(ms))
	args := make([]any, 0, len(ms))
	for i := range ms {
		index[ms[i].MeasurementCode] = i
		args = append(args, ms[i].MeasurementCode)
	}
	rows, err := s.conn.QueryContext(ctx, fmt.Sprintf(sqlMeasurementDevices, placeholders(len(ms))), args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var code string
		var serial, dcode, lead, attached sql.NullString
		var id, typ, premium sql.NullInt64
		if err := rows.Scan(&code, &id, &typ, &serial, &dcode, &lead, &attached, &premium); err != nil {
			return err
		}
		if i, ok := index[code]; ok {
			ms[i].Devices = append(ms[i].Devices, MeasurementDevice{nint(id), nint(typ), nstr(serial), nstr(dcode), nstr(lead), nstr(attached), nint(premium)})
		}
	}
	return rows.Err()
}

func (s *Source) MeasurementIndexPage(ctx context.Context, afterID int64, limit int) ([]MeasurementIndexRow, error) {
	cond, orgArgs := s.orgCond("m.organization_code")
	args := []any{afterID}
	args = append(args, orgArgs...)
	args = append(args, limit)
	rows, err := s.conn.QueryContext(ctx, fmt.Sprintf(sqlMeasurementIndex, cond), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []MeasurementIndexRow
	for rows.Next() {
		var r MeasurementIndexRow
		var status sql.NullInt64
		var modified sql.NullString
		if err := rows.Scan(&r.id, &r.MeasurementCode, &status, &modified); err != nil {
			return nil, err
		}
		r.MeasurementStatus, r.SourceModifiedAt = nint(status), nstr(modified)
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Source) StatusPage(ctx context.Context, year int, afterID int64, limit int) ([]StatusRow, error) {
	cond, orgArgs := s.orgCond("m.organization_code")
	args := []any{afterID}
	args = append(args, orgArgs...)
	args = append(args, limit)
	rows, err := s.conn.QueryContext(ctx, fmt.Sprintf(sqlStatusPage, statusTable(year), cond), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []StatusRow
	for rows.Next() {
		var r StatusRow
		var serial, at sql.NullString
		var typ, status, battery, kind sql.NullInt64
		if err := rows.Scan(&r.ID, &r.MeasurementCode, &typ, &serial, &status, &battery, &kind, &at); err != nil {
			return nil, err
		}
		r.DeviceType, r.SerialNumber, r.Status, r.BatteryValue, r.DeviceKind, r.EventAt = nint(typ), nstr(serial), nint(status), nint(battery), nint(kind), nstr(at)
		out = append(out, r)
	}
	return out, rows.Err()
}

// StatusCount 는 번호 구간 (fromID, toID] 의 행 수다 (대조용).
func (s *Source) StatusCount(ctx context.Context, year int, fromID, toID int64) (int64, error) {
	cond, orgArgs := s.orgCond("m.organization_code")
	args := []any{fromID, toID}
	args = append(args, orgArgs...)
	var n int64
	err := s.conn.QueryRowContext(ctx, fmt.Sprintf(sqlStatusCount, statusTable(year), cond), args...).Scan(&n)
	return n, err
}

func (s *Source) StatusMaxID(ctx context.Context, year int) (int64, error) {
	var n int64
	err := s.conn.QueryRowContext(ctx, fmt.Sprintf(sqlStatusMax, statusTable(year))).Scan(&n)
	return n, err
}

// MeasurementCounts 는 점검 출력용이다: 전체 건수, 진행 중 건수.
func (s *Source) MeasurementCounts(ctx context.Context) (total, active int64, err error) {
	cond, args := s.orgCond("m.organization_code")
	err = s.conn.QueryRowContext(ctx, fmt.Sprintf(sqlMeasurementCountAll, cond), args...).Scan(&total, &active)
	return
}

func (s *Source) MeasurementCountSince(ctx context.Context, since string) (int64, error) {
	cond, args := s.orgCond("m.organization_code")
	args = append(args, since, since, since, since)
	var n int64
	err := s.conn.QueryRowContext(ctx, fmt.Sprintf(sqlMeasurementCountSince, cond), args...).Scan(&n)
	return n, err
}

// MissingStatusYears 는 진행 중인 측정의 연도 중, 상태 이력 테이블이 보이지 않는 연도다.
// 테이블이 없거나 조회 권한이 없으면 이 Agent 에게는 보이지 않는다 — 그 연도의 상태 이력을 보내지 못한다는 뜻이다.
func (s *Source) MissingStatusYears(ctx context.Context, visible []int) ([]int, error) {
	cond, args := s.orgCond("m.organization_code")
	rows, err := s.conn.QueryContext(ctx, fmt.Sprintf(sqlActiveShards, cond), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	have := map[int]bool{}
	for _, y := range visible {
		have[y] = true
	}
	var missing []int
	for rows.Next() {
		var shard sql.NullString
		if err := rows.Scan(&shard); err != nil {
			return nil, err
		}
		if y, err := strconv.Atoi(shard.String); err == nil && y >= 2000 && y <= 2100 && !have[y] {
			missing = append(missing, y)
		}
	}
	sort.Ints(missing)
	return missing, rows.Err()
}

// BackupDays 는 데이터 보관 기한 설정의 최소·최대값이다 (점검 출력용).
func (s *Source) BackupDays(ctx context.Context) (min, max sql.NullInt64, err error) {
	err = s.conn.QueryRowContext(ctx, sqlBackupDay).Scan(&min, &max)
	return
}

// Probe 는 테이블을 읽을 권한이 있는지 확인한다.
func (s *Source) Probe(ctx context.Context, table string) error {
	rows, err := s.conn.QueryContext(ctx, fmt.Sprintf(sqlProbe, table))
	if err != nil {
		return err
	}
	return rows.Close()
}
