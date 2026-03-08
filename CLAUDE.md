# thynC Operations System - CLAUDE.md

## 프로젝트 개요
thynC 구축 및 운영을 위한 데이터 관리 시스템

## 기술 스택
- Next.js 14 (App Router), TypeScript, Tailwind CSS
- Node.js 20
- Prisma ORM + PostgreSQL
- JWT 인증 (httpOnly 쿠키)
- PM2 (프로세스 관리)
- Nginx (웹서버)

## 서버 환경
- OS: Ubuntu 22.04 (AWS EC2)
- DEV:  https://dev.ops.seersthync.com (포트 3001, PM2 프로세스명: thync-dev)
- PROD: https://ops.seersthync.com     (포트 3000, PM2 프로세스명: thync-prod)

## ⚠️ 서버 실행 규칙 (중요)
- 절대 직접 `npm run start`, `nohup`, `node` 등으로 서버를 실행하지 마세요.
- 빌드 및 재시작은 반드시 PM2를 사용하세요:
  npm run build
  pm2 restart thync-dev

## 환경변수 (.env)
- `.env` 파일은 git에 포함되지 않습니다. 직접 수정 필요.
- DEV `.env` 주요 항목:
  - DATABASE_URL="postgresql://thync:thync1234@localhost:5432/thync_ops_dev"
  - JWT_SECRET="thync-ops-dev-secret-key"
  - NEXT_PUBLIC_APP_NAME="thynC Operations System : DEV"
- PROD `.env` 주요 항목:
  - DATABASE_URL="postgresql://thync:thync1234@localhost:5432/thync_ops"
  - JWT_SECRET="thync-ops-prod-secret-key"
  - NEXT_PUBLIC_APP_NAME="thynC Operations System"

## 데이터베이스
- PostgreSQL (로컬)
- DEV DB: thync_ops_dev
- PROD DB: thync_ops
- DB 유저: thync / thync1234

## 디렉토리 구조
- DEV:  /home/ubuntu/thynC-Ops-System/thynC-Ops-DEV
- PROD: /home/ubuntu/thynC-Ops-System/thynC-Ops-PROD

## 인증
- JWT 기반 자체 인증 (httpOnly 쿠키)
- 기본 admin 계정: admin@thync.com / admin1234
- 역할: ADMIN / USER
- 미들웨어(middleware.ts)로 모든 페이지 인증 보호

## Git 워크플로우
- 개발은 DEV에서 작업 후 git push
- PROD 반영 시:
  cd /home/ubuntu/thynC-Ops-System/thynC-Ops-PROD
  git pull origin main
  npm run build
  pm2 restart thync-prod

## 코딩 컨벤션
- 컴포넌트: PascalCase
- 파일명: kebab-case
- API 라우트: /app/api/ 하위
- 페이지: /app/ 하위
