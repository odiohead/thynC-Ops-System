package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Client 는 수신부(/api/usage-ingest/v1)와 통신한다.
// 본문은 gzip 으로 압축한 JSON 이고, 병원 토큰을 Authorization 헤더로 보낸다.
type Client struct {
	base  string
	token string
	http  *http.Client
	ua    string
}

func newClient(c *Config) *Client {
	return &Client{
		base:  c.Endpoint,
		token: c.Token,
		http:  &http.Client{Timeout: 90 * time.Second},
		ua:    "thync-usage-agent/" + version,
	}
}

// 다시 시도해도 되는 실패 (연결 오류, 5xx, 429)
type retryable struct{ err error }

func (r retryable) Error() string { return r.err.Error() }

var retryWaits = []time.Duration{2 * time.Second, 5 * time.Second, 15 * time.Second}

// post 는 요청을 보내고 응답 JSON 을 out 에 푼다. 일시적인 실패는 간격을 늘려 가며 다시 시도한다.
// 모든 저장이 멱등이라 같은 요청이 두 번 가도 결과가 같다.
func (c *Client) post(ctx context.Context, path string, in any, out any) error {
	raw, err := json.Marshal(in)
	if err != nil {
		return err
	}
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	if _, err := zw.Write(raw); err != nil {
		return err
	}
	if err := zw.Close(); err != nil {
		return err
	}
	body := buf.Bytes()

	var last error
	for attempt := 0; ; attempt++ {
		last = c.do(ctx, http.MethodPost, path, body, out)
		var r retryable
		if last == nil || !errors.As(last, &r) || attempt >= len(retryWaits) {
			return last
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(retryWaits[attempt]):
		}
	}
}

func (c *Client) do(ctx context.Context, method, path string, body []byte, out any) error {
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, reader)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", c.ua)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Content-Encoding", "gzip")
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	res, err := c.http.Do(req)
	if err != nil {
		return retryable{fmt.Errorf("수신 서버에 연결할 수 없습니다: %w", err)}
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, 32<<20))
	if err != nil {
		return retryable{fmt.Errorf("응답을 읽을 수 없습니다: %w", err)}
	}
	if res.StatusCode >= 200 && res.StatusCode < 300 {
		if out == nil {
			return nil
		}
		if err := json.Unmarshal(data, out); err != nil {
			return fmt.Errorf("응답 형식이 올바르지 않습니다 (%s): %w", path, err)
		}
		return nil
	}
	var e struct {
		Error string `json:"error"`
	}
	_ = json.Unmarshal(data, &e)
	msg := e.Error
	if msg == "" {
		msg = strings.TrimSpace(string(data))
		if len(msg) > 200 {
			msg = msg[:200]
		}
	}
	err = fmt.Errorf("수신 서버가 요청을 거부했습니다 (%s → HTTP %d): %s", path, res.StatusCode, msg)
	if res.StatusCode >= 500 || res.StatusCode == http.StatusTooManyRequests {
		return retryable{err}
	}
	return err
}

// ── 요청·응답 ──────────────────────────────────────────────────────────

type handshakeReq struct {
	ServerID       string `json:"server_id"`
	Hostname       string `json:"hostname"`
	AgentVersion   string `json:"agent_version"`
	DBVersion      string `json:"db_version"`
	DBTimeZone     string `json:"db_time_zone"`
	DBNow          string `json:"db_now"`
	StatusYears    []int  `json:"status_years"`
	Full           bool   `json:"full,omitempty"`
	RewindStatusTo *int64 `json:"rewind_status_to,omitempty"`
	DryRun         bool   `json:"dry_run,omitempty"`
}

type statusCursor struct {
	LastID     int64 `json:"last_id"`
	VerifiedID int64 `json:"verified_id"`
}

type handshakeRes struct {
	RunID             *int64                  `json:"run_id"`
	HospitalCode      string                  `json:"hospital_code"`
	MeasurementsSince *string                 `json:"measurements_since"`
	StatusCursors     map[string]statusCursor `json:"status_cursors"`
	Reconcile         bool                    `json:"reconcile"`
	StatusPaused      bool                    `json:"status_paused"`
	Limits            struct {
		PushRows int `json:"push_rows"`
	} `json:"limits"`
	Version string `json:"version"`
}

type pushReq struct {
	RunID   int64  `json:"run_id"`
	Dataset string `json:"dataset"`
	Year    *int   `json:"year,omitempty"`
	Rows    any    `json:"rows"`
}

type pushRes struct {
	Accepted       int      `json:"accepted"`
	Inserted       int      `json:"inserted"`
	Cursor         *int64   `json:"cursor"`
	Paused         bool     `json:"paused"`
	Devices        int      `json:"devices"`
	DevicesRemoved int      `json:"devices_removed"`
	ResendCodes    []string `json:"resend_codes"`
	MissingTotal   int      `json:"missing_total"`
	GoneMarked     int      `json:"gone_marked"`
	GoneSkipped    int      `json:"gone_skipped"`
	Results        []struct {
		Year     int   `json:"year"`
		Source   int64 `json:"source"`
		Received int64 `json:"received"`
		OK       bool  `json:"ok"`
	} `json:"results"`
}

type finishReq struct {
	RunID    int64          `json:"run_id"`
	Status   string         `json:"status"`
	Stats    map[string]any `json:"stats"`
	Error    string         `json:"error,omitempty"`
	Complete []string       `json:"complete"`
}

func (c *Client) handshake(ctx context.Context, req handshakeReq) (*handshakeRes, error) {
	var res handshakeRes
	if err := c.post(ctx, "/handshake", req, &res); err != nil {
		return nil, err
	}
	return &res, nil
}

func (c *Client) push(ctx context.Context, runID int64, dataset string, year *int, rows any) (*pushRes, error) {
	var res pushRes
	if err := c.post(ctx, "/push", pushReq{RunID: runID, Dataset: dataset, Year: year, Rows: rows}, &res); err != nil {
		return nil, err
	}
	return &res, nil
}

func (c *Client) finish(ctx context.Context, req finishReq) error {
	return c.post(ctx, "/finish", req, nil)
}

// health 는 수신부 상태 확인 주소(…/api/usage-ingest/health)를 부른다. 인증하지 않는다.
func (c *Client) health(ctx context.Context) (string, error) {
	base := strings.TrimSuffix(c.base, "/v1")
	saved := c.base
	c.base = base
	defer func() { c.base = saved }()
	var res struct {
		OK      bool   `json:"ok"`
		Version string `json:"version"`
	}
	if err := c.do(ctx, http.MethodGet, "/health", nil, &res); err != nil {
		return "", err
	}
	if !res.OK {
		return "", errors.New("수신 서버가 정상 상태가 아닙니다")
	}
	return res.Version, nil
}
