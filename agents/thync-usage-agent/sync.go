package main

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"time"
)

// runOptions 는 수동 재전송 옵션이다 (설계 문서 §6.3).
type runOptions struct {
	Full       bool   // 측정을 처음부터 전부 다시 보낸다
	StatusFrom *int64 // 상태 이력을 이 번호부터 다시 보낸다
}

const (
	indexPageRows      = 5000
	resendChunk        = 500
	maxReconcileRounds = 20
)

// syncRun 은 한 번의 수집·전송이다 (설계 문서 §5.3).
type syncRun struct {
	cfg      *Config
	src      *Source
	cli      *Client
	hs       *handshakeRes
	runID    int64
	pushRows int
	sent     map[string]int64
	complete []string
	notes    map[string]any
}

func runSync(ctx context.Context, cfg *Config, opts runOptions) error {
	started := time.Now()
	src, err := openSource(ctx, cfg)
	if err != nil {
		return err
	}
	defer src.Close()
	info, err := src.Info(ctx)
	if err != nil {
		return fmt.Errorf("DB 정보를 읽을 수 없습니다: %w", err)
	}
	years, err := src.StatusYears(ctx)
	if err != nil {
		return fmt.Errorf("상태 이력 테이블 목록을 읽을 수 없습니다: %w", err)
	}

	cli := newClient(cfg)
	host, _ := os.Hostname()
	req := handshakeReq{
		ServerID: cfg.ServerID, Hostname: host, AgentVersion: version,
		DBVersion: info.Version, DBTimeZone: info.TimeZone, DBNow: info.Now,
		StatusYears: years, Full: opts.Full,
	}
	if opts.StatusFrom != nil {
		to := *opts.StatusFrom - 1 // "이 번호부터" = 받은 번호를 그 앞으로 되돌린다
		if to < 0 {
			to = 0
		}
		req.RewindStatusTo = &to
	}
	hs, err := cli.handshake(ctx, req)
	if err != nil {
		return err
	}
	if hs.RunID == nil {
		return fmt.Errorf("수신 서버가 실행 번호를 주지 않았습니다")
	}
	since := "전체"
	if hs.MeasurementsSince != nil {
		since = *hs.MeasurementsSince + " 이후"
	}
	logf("시작: 병원 %s, 서버 %s, 실행 #%d, 측정 %s, 대조 %v", hs.HospitalCode, cfg.ServerID, *hs.RunID, since, hs.Reconcile)

	r := &syncRun{cfg: cfg, src: src, cli: cli, hs: hs, runID: *hs.RunID, sent: map[string]int64{}, notes: map[string]any{}}
	r.pushRows = hs.Limits.PushRows
	if r.pushRows <= 0 || r.pushRows > 5000 {
		r.pushRows = 5000
	}

	runErr := r.all(ctx, years)

	fin := finishReq{RunID: r.runID, Status: "ok", Complete: r.complete}
	fin.Stats = map[string]any{"sent": r.sent, "duration_ms": time.Since(started).Milliseconds()}
	for k, v := range r.notes {
		fin.Stats[k] = v
	}
	if runErr != nil {
		fin.Status = "failed"
		fin.Error = runErr.Error()
	}
	// 실패도 알린다 — 전체 시간 제한에 걸렸더라도 보고는 따로 시도한다
	finCtx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	if err := cli.finish(finCtx, fin); err != nil {
		if runErr == nil {
			return fmt.Errorf("결과 보고 실패: %w", err)
		}
		logf("결과 보고도 실패했습니다: %v", err)
	}
	if runErr != nil {
		return runErr
	}
	logf("완료: %d초, 전송 %v", int(time.Since(started).Seconds()), r.sent)
	return nil
}

func (r *syncRun) all(ctx context.Context, years []int) error {
	if err := r.fullDatasets(ctx); err != nil {
		return err
	}
	if err := r.measurements(ctx); err != nil {
		return err
	}
	if missing, err := r.src.MissingStatusYears(ctx, years); err == nil && len(missing) > 0 {
		r.notes["status_tables_missing"] = missing
		logf("경고: 진행 중인 측정의 연도 %v 에 해당하는 기기 상태 이력 테이블이 보이지 않습니다 — DB 계정의 조회 권한을 확인하세요 (create-db-user.sql)", missing)
	}
	if r.hs.StatusPaused {
		r.notes["status_paused"] = true
		logf("기기 상태 이력: 수신 서버가 용량 상한으로 수신을 멈춘 상태 — 건너뜁니다 (병원 DB 에 그대로 있으므로 나중에 이어집니다)")
	} else if err := r.deviceStatus(ctx, years); err != nil {
		return err
	}
	if r.hs.Reconcile {
		if err := r.reconcile(ctx, years); err != nil {
			return err
		}
	}
	return nil
}

// fullDatasets 는 양이 적은 종류(기관·병동·기기 등록)를 매번 전체 보낸다.
func (r *syncRun) fullDatasets(ctx context.Context) error {
	orgs, err := r.src.Organizations(ctx)
	if err != nil {
		return fmt.Errorf("기관 조회 실패: %w", err)
	}
	if err := pushChunks(ctx, r, "organizations", orgs); err != nil {
		return err
	}
	wards, err := r.src.Wards(ctx)
	if err != nil {
		return fmt.Errorf("병동 조회 실패: %w", err)
	}
	if err := pushChunks(ctx, r, "wards", wards); err != nil {
		return err
	}
	regs, err := r.src.DeviceRegisters(ctx)
	if err != nil {
		return fmt.Errorf("기기 등록 조회 실패: %w", err)
	}
	return pushChunks(ctx, r, "device_registers", regs)
}

// pushChunks 는 한 종류의 전체 행을 나눠 보내고, 다 보냈음을 기록한다.
func pushChunks[T any](ctx context.Context, r *syncRun, dataset string, rows []T) error {
	for i := 0; i < len(rows); i += r.pushRows {
		end := i + r.pushRows
		if end > len(rows) {
			end = len(rows)
		}
		if _, err := r.cli.push(ctx, r.runID, dataset, nil, rows[i:end]); err != nil {
			return err
		}
	}
	r.sent[dataset] += int64(len(rows))
	r.complete = append(r.complete, dataset)
	return nil
}

func (r *syncRun) pushMeasurements(ctx context.Context, rows []MeasurementRow, counter string) error {
	if len(rows) == 0 {
		return nil
	}
	res, err := r.cli.push(ctx, r.runID, "measurements", nil, rows)
	if err != nil {
		return err
	}
	r.sent[counter] += int64(len(rows))
	r.sent["measurement_devices"] += int64(res.Devices)
	if res.DevicesRemoved > 0 {
		r.sent["devices_removed"] += int64(res.DevicesRemoved)
	}
	return nil
}

// measurements 는 측정 변동분(첫 실행·--full 이면 전체)을 번호 순서로 나눠 보낸다. 측정마다 붙은 기기를 묶어 보낸다.
func (r *syncRun) measurements(ctx context.Context) error {
	since := ""
	if r.hs.MeasurementsSince != nil {
		since = *r.hs.MeasurementsSince
	}
	var after int64
	for {
		page, err := r.src.MeasurementsPage(ctx, after, since, r.cfg.MeasurementPage)
		if err != nil {
			return fmt.Errorf("측정 조회 실패: %w", err)
		}
		if len(page) == 0 {
			break
		}
		if err := r.pushMeasurements(ctx, page, "measurements"); err != nil {
			return err
		}
		after = page[len(page)-1].id
		if len(page) < r.cfg.MeasurementPage {
			break
		}
	}
	r.complete = append(r.complete, "measurements")
	return nil
}

// deviceStatus 는 연도 테이블마다 받은 번호 다음부터 보낸다. 한 번 실행에 보낼 횟수에 상한이 있어, 밀린 양이 많으면 여러 번에 나눠 따라잡는다.
func (r *syncRun) deviceStatus(ctx context.Context, years []int) error {
	batches := 0
	behind := false
	for _, year := range years {
		y := year
		cursor := r.hs.StatusCursors[strconv.Itoa(year)].LastID
		for {
			if batches >= r.cfg.StatusMaxBatches {
				behind = true
				break
			}
			page, err := r.src.StatusPage(ctx, year, cursor, r.cfg.StatusBatchRows)
			if err != nil {
				return fmt.Errorf("기기 상태 이력 조회 실패 (%d): %w", year, err)
			}
			if len(page) == 0 {
				break
			}
			res, err := r.cli.push(ctx, r.runID, "device_status", &y, page)
			if err != nil {
				return err
			}
			if res.Paused {
				r.notes["status_paused"] = true
				return nil
			}
			batches++
			r.sent["device_status"] += int64(len(page))
			cursor = page[len(page)-1].ID
			if len(page) < r.cfg.StatusBatchRows {
				break
			}
		}
	}
	if behind {
		r.notes["status_behind"] = true
		logf("기기 상태 이력: 이번 실행의 전송 상한(%d회)에 도달 — 남은 분량은 다음 실행에 이어집니다", r.cfg.StatusMaxBatches)
	}
	return nil
}

// reconcile 은 하루 한 번 병원 쪽과 중앙 쪽을 맞춰 본다 (설계 문서 §6.2).
func (r *syncRun) reconcile(ctx context.Context, years []int) error {
	// 1) 측정 전체 목록(코드·상태·수정 시각)을 보낸다
	var after int64
	for {
		page, err := r.src.MeasurementIndexPage(ctx, after, indexPageRows)
		if err != nil {
			return fmt.Errorf("측정 목록 조회 실패: %w", err)
		}
		if len(page) == 0 {
			break
		}
		if _, err := r.cli.push(ctx, r.runID, "measurement_index", nil, page); err != nil {
			return err
		}
		r.sent["measurement_index"] += int64(len(page))
		after = page[len(page)-1].id
		if len(page) < indexPageRows {
			break
		}
	}

	// 2) 중앙이 없거나 다르다고 알려 준 측정만 다시 보낸다
	settled := false
	lastMissing := -1
	for round := 0; round < maxReconcileRounds; round++ {
		res, err := r.cli.push(ctx, r.runID, "reconcile_measurements", nil, []struct{}{})
		if err != nil {
			return err
		}
		if round == 0 {
			if res.MissingTotal > 0 || res.GoneMarked > 0 || res.GoneSkipped > 0 {
				logf("대조(측정): 다시 보낼 측정 %d건, 병원에서 사라진 측정 %d건", res.MissingTotal, res.GoneMarked)
			}
			if res.GoneSkipped > 0 {
				logf("대조(측정): 사라진 것으로 보이는 측정이 %d건으로 너무 많아 표시하지 않았습니다 — 기관 설정(ORG_INCLUDE/ORG_EXCLUDE)을 확인하세요", res.GoneSkipped)
			}
		}
		if len(res.ResendCodes) == 0 {
			settled = true
			break
		}
		if lastMissing >= 0 && res.MissingTotal >= lastMissing {
			break // 줄지 않는다 — 대조하는 사이에 바뀐 측정일 수 있다. 다음 대조에서 다시 본다
		}
		lastMissing = res.MissingTotal
		for i := 0; i < len(res.ResendCodes); i += resendChunk {
			end := i + resendChunk
			if end > len(res.ResendCodes) {
				end = len(res.ResendCodes)
			}
			rows, err := r.src.MeasurementsByCode(ctx, res.ResendCodes[i:end])
			if err != nil {
				return fmt.Errorf("측정 재조회 실패: %w", err)
			}
			if err := r.pushMeasurements(ctx, rows, "measurements_resent"); err != nil {
				return err
			}
		}
	}

	// 3) 상태 이력: 지난 대조 이후 구간의 행 수를 보낸다. 중앙의 행 수가 모자라면 중앙이 수신 위치를 되돌린다
	if !r.hs.StatusPaused {
		type check struct {
			Year   int   `json:"year"`
			FromID int64 `json:"from_id"`
			ToID   int64 `json:"to_id"`
			Count  int64 `json:"count"`
		}
		var checks []check
		for _, year := range years {
			c := r.hs.StatusCursors[strconv.Itoa(year)]
			if c.LastID <= c.VerifiedID {
				continue
			}
			n, err := r.src.StatusCount(ctx, year, c.VerifiedID, c.LastID)
			if err != nil {
				logf("대조(상태 이력 %d): 행 수를 세지 못했습니다 — 다음 대조에서 다시 봅니다: %v", year, err)
				settled = false
				continue
			}
			checks = append(checks, check{year, c.VerifiedID, c.LastID, n})
		}
		if len(checks) > 0 {
			res, err := r.cli.push(ctx, r.runID, "status_check", nil, checks)
			if err != nil {
				return err
			}
			for _, x := range res.Results {
				if !x.OK {
					logf("대조(상태 이력 %d): 병원 %d행, 중앙 %d행 — 그 구간부터 다시 보냅니다", x.Year, x.Source, x.Received)
				}
			}
		}
	}
	if settled {
		r.complete = append(r.complete, "reconcile")
	} else {
		r.notes["reconcile_incomplete"] = true
	}
	return nil
}

func logf(format string, args ...any) {
	fmt.Printf(format+"\n", args...)
}
