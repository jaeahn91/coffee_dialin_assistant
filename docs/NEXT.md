# 다음 작업 (NEXT)

> 세션이 끊겨도 여기서 바로 이어받기 위한 메모. 끝난 항목은 지우거나 체크.

## 지금 할 일 (파일럿 임계 경로 순)
- **QR 발급 도구**: base64url 21자 코드 N장 생성 + 인쇄용 QR 이미지(`qrcode` 패키지 후보). `scripts/seed-e2e.mjs`의 `newQrCode()`가 규격 구현체 — 발급 스크립트로 분리(대시보드는 Phase C).
- **Vercel 배포**: QR에 인쇄될 URL 확정의 선행 조건. env 3종 설정.
- **스타일링·카피 다듬기**: 도움받기 화면 카피("조금 더 여쭤볼게요"가 스텁과 불일치 — 검증 finding), 완료 화면 뒤로 버튼 노출 재검토.
- **시드 데이터 정리**: 파일럿 시작 전 '시드 테스트 로스터리' 행 삭제(cascade로 전부 정리됨).
- **파일럿 로스터 확인 항목**: 언스페셜티 링크 노출 동의, §9 템플릿 참조 그라인더 힌트, 조정 후 µm 목표 병기 여부 (ADR-002 이연 목록).
- **재스캔 시 직전 조정 반영 표시**: 세션 사슬의 after_snapshot을 표시 레시피에 반영(§8-5). 현재는 항상 기준 레시피 표시(ADR-001 알려진 한계).
- **챗봇 폴백 스텁** (§9 경계 — 룰은 AI 호출 안 함). 현재는 안내 문구만. bail 중도이탈 기록도 이때 재검토.
- **디자인/스타일링** 다듬기 (현재 최소 Tailwind).

## 결정 메모
- **QR URL 스킴**: `https://<도메인>/r/<code>`, `code`=추측불가 url-safe 토큰(봉지 유니크). roaster/bean은 URL에 안 박고 서버에서 해석(불투명 코드).
- **도메인**: 파일럿은 **Vercel 도메인 고정**. 실출시 시 변경 가능(옛 도메인 301 리다이렉트로 인쇄된 QR 구제). 커스텀 도메인 구매는 **실제 QR 인쇄 직전**에만 필요 — 임계경로 밖. 살 의향 있음.
- **RLS 자세**: deny-by-default(전 테이블 RLS on, anon/authenticated 정책 없음=접근 0). 서버가 `service_role`로만 접근, `lib/db`가 `roaster_id` 강제(§8-4). Supabase 프로젝트 "자동 RLS" 옵션도 켜둠(보조).
- **보안 리뷰 결정 (2026-07-02)**:
  - 스키마: 부모 `unique(id, roaster_id)` + 자식 복합 FK로 테넌트 간 참조를 DB 레벨에서 차단(0001에 반영, PG15+).
  - `lib/db/client.ts`는 `server-only` import로 클라이언트 번들 유입 시 빌드 실패.
  - QR 토큰 규격: `crypto.getRandomValues` 기반 base64url **21자(≈126비트)** — 열거 불가가 1차 방어.
  - 쓰기 시 처방은 **서버에서 `flowStep` 재도출**(클라이언트 계산 불신), 경계에서 enum 검증(zod).
  - 대시보드(Phase C): 손님 경로=service_role+앱 스코프 유지 / 로스터 경로=Supabase Auth+RLS(`with check` 필수, `current_roaster_id()` 함수로 통일). 미들웨어 단독 인증 금지(레이아웃+액션 이중 확인).
  - 레시피 발행은 Postgres RPC로 원자 처리(활성 off + `max(version)+1`). 원두는 하드삭제 대신 status 소프트 처리.
- **알려진 취약점 경고(무시 중)**: `npm audit`의 postcss moderate 2건은 Next.js 내장 사본 문제. `audit fix --force`는 next를 9.x로 다운그레이드하므로 **절대 실행 금지** — Next 패치 릴리스 대기. 실위험 낮음(사용자 제어 CSS 없음).

## 완료됨
- ✅ **재스캔 조정 반영 + 분쇄도 표현 결정 (2026-07-02, ADR-002)** — 분쇄도는 수정값이 아니라 권유 이력으로 표시(자기교정 비대칭 근거), 물·온도·도징은 after_snapshot 절대값 표시(기준 병기). `recipe.grind_um` 선택 병기 + 언스페셜티 나침반 링크(0003 적용됨, `latest_adjustment_for_qr` 읽기 RPC). **사슬 누적 수정**: before_snapshot = 직전 조정의 after_snapshot(§8-5 정합) — 브라우저 클릭 주행으로 250→260→270 누적 검증.
- ✅ **마이그레이션 적용 + E2E 실주행 (2026-07-02)** — PostgreSQL 17.6에 0001+0002 적용(`scripts/db-apply.mjs`, SUPABASE_DB_URL 경유). `scripts/seed-e2e.mjs`로 RPC 10개 검증 전부 통과: §8-5 사슬 연결, 원자 기록, hold는 조정 없음, 중복 차단, 일일 상한, 미존재 코드 거절, **복합 FK 교차 테넌트 차단 실증**. dev 서버로 랜딩/실QR(시드 데이터 렌더)/미존재 3상태 + page_view 기록 확인. devDep `pg` 추가.
- ✅ **쓰기 경로 B+ 구현 (2026-07-02, ADR-001)** — `docs/ADR-001_write-path.md`(결정·트리거·씸 계약·보류 목록). `0002_rpc.sql`(start_brew_session·record_feedback, 원자 기록+사슬+상한, anon 실행권한 회수), `0001`에 `page_view` 추가(퍼널 1단). `lib/server/derive.ts`(zod+flowStep 서버 재주행, 경로 밖 필드 무시, applyMoves 스냅샷) + 테스트 12. `lib/db` sessions/feedback/page-views. `app/r/[code]/`(서버 페이지+상태별 안내, Flow 클라이언트, 얇은 액션 2개). 루트는 랜딩으로 교체. dep `zod`. 테스트 35, 빌드 통과. **DB 미적용이라 RPC는 실행 미검증**.
- ✅ **보안 리뷰 Phase A (2026-07-02)** — 0001 스키마에 복합 FK 테넌트 강제 반영(미적용 SQL이라 무비용), `client.ts`에 `server-only`, `qr.ts`가 `QrResolution` 상태 유니온 반환(폐기/미존재/미준비 구분), `describe.test.ts`로 §9 고정 템플릿 잠금(테스트 23개). dep `server-only` 추가.
- ✅ **`lib/db` 데이터 계층 골격 + 스키마 SQL** — `supabase/migrations/0001_init.sql`(9엔티티+enum+인덱스+RLS), `lib/db/client.ts`(server-only service_role 싱글턴), `lib/db/schema.ts`(행 타입, 도메인 enum 재사용), `lib/db/qr.ts`(`getRecipeByQrCode` 읽기 슬라이스). dep `@supabase/supabase-js` 추가. **SQL은 아직 미적용**.
- ✅ **§5 플로우 상태머신 + 사용자 UI** — `lib/domain/flow.ts`(`flowStep`, 순수) + `flow.test.ts`(13), `app/page.tsx`(레시피 카드→질문→처방, 뒤로/처음부터/도움받기). 카피: "커피 추출 도우미".
  - 라우팅: 좋아요→hold / **괜찮아요→C(맛+농도→격자, 시간·트리 skip)** / 아쉬워요→시간필터→짧·길이면 온도트리·비슷이면 격자 / 맛·농도 "해당없음"→챗봇.
- ✅ 도메인 룰 엔진 (`c4bf0ae`): grid/tree/invariants/describe.
- ✅ 개발 하네스 (`439c784`): `check` 스크립트·husky pre-commit·GitHub CI·CLAUDE.md.
- ✅ 컨텍스트 % 상태줄 + 40% `/compact` 권장 (`.claude/`, 개인 설정·미커밋).

## 현재 상태 스냅샷 (2026-07-02)
- 테스트 35 pass + DB E2E 10 체크 통과. `npm run check`·`next build` 통과.
- **DB 적용됨**: PostgreSQL 17.6 (서울 리전 aws-1-ap-northeast-2). 시드 데이터('시드 테스트 로스터리') 존재.
- `.env.local` 3개 값: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`(sb_secret), `SUPABASE_DB_URL`(마이그레이션용, **비밀번호는 percent-encoding 필수** — `#`·`@` 등이 env 파싱·URL 파싱을 깨뜨림).
- 이 노트북(NB-26062424)에는 Node v22.23.1을 유저 스코프로 설치함(`%LOCALAPPDATA%\Programs\node-v22.23.1-win-x64`, 유저 PATH 등록).
- push 정책: 커밋은 자유, **push는 매번 확인 후**.
