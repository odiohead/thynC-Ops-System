package main

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"
)

// runCheck 는 설치 직후나 문제가 있을 때 현장에서 돌려 보는 점검이다.
// DB 와 수신 서버 어디에도 쓰지 않는다. 문제가 하나라도 있으면 false.
func runCheck(ctx context.Context, cfg *Config) bool {
	ok := true
	fail := func(format string, args ...any) {
		ok = false
		fmt.Printf("  [실패] "+format+"\n", args...)
	}
	pass := func(format string, args ...any) { fmt.Printf("  [정상] "+format+"\n", args...) }
	note := func(format string, args ...any) { fmt.Printf("         "+format+"\n", args...) }

	fmt.Printf("thync-usage-agent %s\n\n", version)
	fmt.Println("설정")
	note("수신 주소 %s", cfg.Endpoint)
	note("토큰 %s", maskToken(cfg.Token))
	note("서버 이름 %s", cfg.ServerID)
	note("DB %s@%s:%d/%s", cfg.DBUser, cfg.DBHost, cfg.DBPort, cfg.DBName)
	if len(cfg.OrgInclude) > 0 {
		note("보낼 기관 %s", strings.Join(cfg.OrgInclude, ", "))
	}
	note("제외 기관 %s", orDash(strings.Join(cfg.OrgExclude, ", ")))

	fmt.Println("\n제품 DB")
	src, err := openSource(ctx, cfg)
	var years []int
	var info *SourceInfo
	if err != nil {
		fail("%v", err)
	} else {
		defer src.Close()
		if info, err = src.Info(ctx); err != nil {
			fail("DB 정보를 읽을 수 없습니다: %v", err)
		} else {
			pass("접속 — MySQL %s, 시간대 %s, 현재 시각 %s", info.Version, info.TimeZone, info.Now)
		}
		denied := 0
		for _, t := range requiredTables {
			if err := src.Probe(ctx, t); err != nil {
				denied++
				fail("테이블 %s 를 읽을 수 없습니다: %v", t, err)
			}
		}
		if years, err = src.StatusYears(ctx); err != nil {
			fail("상태 이력 테이블 목록을 읽을 수 없습니다: %v", err)
		} else if len(years) == 0 {
			fail("기기 상태 이력 테이블(device_status_info_<연도>)이 보이지 않습니다 — 권한을 확인하세요")
		}
		for _, y := range years {
			if err := src.Probe(ctx, statusTable(y)); err != nil {
				denied++
				fail("테이블 %s 를 읽을 수 없습니다: %v", statusTable(y), err)
			}
		}
		if missing, err := src.MissingStatusYears(ctx, years); err == nil && len(missing) > 0 {
			fail("진행 중인 측정의 연도 %v 에 해당하는 기기 상태 이력 테이블이 보이지 않습니다 — 조회 권한을 확인하세요 (create-db-user.sql)", missing)
		}
		if denied == 0 && len(years) > 0 {
			pass("조회 권한 — 테이블 %d개 + 상태 이력 %d개 연도", len(requiredTables), len(years))
		}
		if orgs, err := src.Organizations(ctx); err == nil {
			names := make([]string, 0, len(orgs))
			for _, o := range orgs {
				n := o.OrganizationCode
				if o.OrganizationName != nil {
					n += "(" + *o.OrganizationName + ")"
				}
				names = append(names, n)
			}
			if len(orgs) == 0 {
				fail("보낼 기관이 없습니다 — ORG_INCLUDE / ORG_EXCLUDE 를 확인하세요")
			} else {
				pass("기관 %d개: %s", len(orgs), strings.Join(names, ", "))
			}
		}
		if total, active, err := src.MeasurementCounts(ctx); err == nil {
			pass("측정 %d건 (진행 중 %d건)", total, active)
		}
		if regs, err := src.DeviceRegisters(ctx); err == nil {
			premium := 0
			for _, r := range regs {
				if r.Premium != nil && *r.Premium == 1 {
					premium++
				}
			}
			pass("등록 기기 %d대 (구독형 %d대)", len(regs), premium)
		}
		if min, max, err := src.BackupDays(ctx); err == nil && min.Valid {
			if min.Int64 == max.Int64 {
				note("데이터 보관 기한 %d일 — 이보다 오래 전송이 끊기면 그사이 종료된 측정의 기기 정보는 다시 받을 수 없습니다", min.Int64)
			} else {
				note("데이터 보관 기한 %d~%d일", min.Int64, max.Int64)
			}
		}
	}

	fmt.Println("\n수신 서버")
	cli := newClient(cfg)
	if v, err := cli.health(ctx); err != nil {
		fail("%v", err)
	} else {
		pass("접속 — 수신부 %s", v)
	}
	var hs *handshakeRes
	if info != nil {
		host, _ := os.Hostname()
		hs, err = cli.handshake(ctx, handshakeReq{
			ServerID: cfg.ServerID, Hostname: host, AgentVersion: version,
			DBVersion: info.Version, DBTimeZone: info.TimeZone, DBNow: info.Now,
			StatusYears: years, DryRun: true,
		})
		if err != nil {
			fail("%v", err)
		} else {
			pass("토큰 확인 — 병원 %s", hs.HospitalCode)
			if hs.StatusPaused {
				note("수신 서버가 용량 상한으로 기기 상태 이력 수신을 멈춘 상태입니다")
			}
		}
	}

	if src != nil && hs != nil {
		fmt.Println("\n다음 실행에서 보낼 양")
		if hs.MeasurementsSince == nil {
			total, _, _ := src.MeasurementCounts(ctx)
			note("측정: 전체 %d건 (첫 실행)", total)
		} else if n, err := src.MeasurementCountSince(ctx, *hs.MeasurementsSince); err == nil {
			note("측정: %s 이후 변동분 %d건", *hs.MeasurementsSince, n)
		}
		for _, y := range years {
			cur := hs.StatusCursors[strconv.Itoa(y)].LastID
			max, err := src.StatusMaxID(ctx, y)
			if err != nil {
				continue
			}
			line := fmt.Sprintf("기기 상태 이력 %d: 받은 번호 %d, 병원 마지막 번호 %d", y, cur, max)
			if max > cur {
				if n, err := src.StatusCount(ctx, y, cur, max); err == nil {
					runs := (n + int64(cfg.StatusBatchRows*cfg.StatusMaxBatches) - 1) / int64(cfg.StatusBatchRows*cfg.StatusMaxBatches)
					line += fmt.Sprintf(" — 남은 %d행 (약 %d회 실행에 걸쳐 전송)", n, runs)
				} else {
					line += " — 남은 행 수는 세지 못했습니다(시간 상한)"
				}
			} else {
				line += " — 남은 것 없음"
			}
			note("%s", line)
		}
		note("대조: %s", map[bool]string{true: "이번 실행에 포함", false: "최근 23시간 안에 완료"}[hs.Reconcile])
	}

	fmt.Println()
	if ok {
		fmt.Println("점검 통과. 아무것도 보내지 않았습니다.")
	} else {
		fmt.Println("점검 실패. 위 [실패] 항목을 확인하세요.")
	}
	return ok
}

func orDash(s string) string {
	if s == "" {
		return "없음"
	}
	return s
}
