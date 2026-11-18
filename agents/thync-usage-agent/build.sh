#!/usr/bin/env bash
# thync-usage-agent 빌드 — 병원 서버(Ubuntu, amd64)용 정적 실행 파일 하나를 만든다.
#   ./build.sh            → dist/thync-usage-agent + 설치 묶음 dist/thync-usage-agent-<버전>.tar.gz
# Go 도구가 필요하다 (go.mod 의 go 버전 이상). 병원 서버에는 Go 가 필요 없다.
set -euo pipefail
cd "$(dirname "$0")"
VERSION="${VERSION:-$(cat VERSION)}"
mkdir -p dist
go vet ./...
go test ./...
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o dist/thync-usage-agent .
PKG="thync-usage-agent-${VERSION}"
rm -rf "dist/${PKG}" && mkdir -p "dist/${PKG}"
cp dist/thync-usage-agent deploy/* "dist/${PKG}/"
chmod +x "dist/${PKG}"/*.sh
tar -C dist -czf "dist/${PKG}.tar.gz" "${PKG}"
rm -rf "dist/${PKG}"
echo "빌드 완료: dist/thync-usage-agent (${VERSION}), dist/${PKG}.tar.gz"
sha256sum dist/thync-usage-agent "dist/${PKG}.tar.gz"
