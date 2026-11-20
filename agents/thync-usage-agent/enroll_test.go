package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestEnrollPost(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var in map[string]any
		_ = json.NewDecoder(r.Body).Decode(&in)
		w.Header().Set("Content-Type", "application/json")
		if r.Header.Get("Authorization") != "" {
			t.Errorf("등록 요청에 Authorization 헤더가 붙으면 안 된다")
		}
		switch {
		case r.URL.Path == "/v1/enroll/check" && in["hospital_code"] == "HOSP-1":
			_, _ = w.Write([]byte(`{"hospital_code":"HOSP-1","hospital_name":"가나병원","expected_servers":2,"registered_servers":["a"],"slots_left":1}`))
		case r.URL.Path == "/v1/enroll" && in["server_id"] == "full":
			w.WriteHeader(http.StatusConflict)
			_, _ = w.Write([]byte(`{"error":"자리가 없습니다","code":"no_slot"}`))
		case r.URL.Path == "/v1/enroll":
			_, _ = w.Write([]byte(`{"hospital_code":"HOSP-1","hospital_name":null,"server_id":"b","server_key":"tuk_abc","expected_servers":2,"registered_servers":2}`))
		default:
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":"등록되지 않은 병원코드입니다","code":"not_registered"}`))
		}
	}))
	defer srv.Close()
	ctx := context.Background()
	base := srv.URL + "/v1/" // 끝의 / 는 떼고 붙인다

	var chk enrollCheckRes
	if err := enrollPost(ctx, base, "/enroll/check", map[string]any{"hospital_code": "HOSP-1"}, &chk); err != nil {
		t.Fatal(err)
	}
	if chk.HospitalName == nil || *chk.HospitalName != "가나병원" || chk.SlotsLeft != 1 || len(chk.RegisteredServers) != 1 {
		t.Errorf("확인 응답: %+v", chk)
	}

	var out enrollRes
	if err := enrollPost(ctx, base, "/enroll", map[string]any{"hospital_code": "HOSP-1", "server_id": "b"}, &out); err != nil {
		t.Fatal(err)
	}
	if out.ServerKey != "tuk_abc" || out.HospitalName != nil || out.RegisteredServers != 2 {
		t.Errorf("등록 응답: %+v", out)
	}

	for server, want := range map[string]int{"full": 4} {
		err := enrollPost(ctx, base, "/enroll", map[string]any{"hospital_code": "HOSP-1", "server_id": server}, &out)
		e, ok := err.(*enrollErr)
		if !ok || enrollExitCode(e.Code) != want || e.Message != "자리가 없습니다" {
			t.Errorf("%s: 거부 사유가 종료 코드 %d 로 가야 한다: %v", server, want, err)
		}
	}
	err := enrollPost(ctx, base, "/enroll/check", map[string]any{"hospital_code": "NOPE"}, &chk)
	if e, ok := err.(*enrollErr); !ok || enrollExitCode(e.Code) != 3 {
		t.Errorf("등록되지 않은 병원은 종료 코드 3: %v", err)
	}
	if enrollExitCode("name_taken") != 5 || enrollExitCode("blocked") != 6 || enrollExitCode("") != 1 {
		t.Errorf("종료 코드 표")
	}
	if shellValue("a\nb\rc") != "a b c" {
		t.Errorf("셸 값에서 줄바꿈 제거")
	}
}
