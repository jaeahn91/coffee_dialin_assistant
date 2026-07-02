# 다음 작업 (NEXT)

> 세션이 끊겨도 여기서 바로 이어받기 위한 메모. 끝난 항목은 지우거나 체크.

## 지금 할 일
- **🔴 마이그레이션 Supabase 적용 (비가역 — 사용자 확인 후)**: `supabase/migrations/0001_init.sql`을 SQL Editor 붙여넣기 또는 CLI로. 아직 **미적용**. 복합 FK의 `on delete set null (컬럼)` 문법 때문에 **PostgreSQL 15+ 필요**(Supabase 신규 프로젝트는 충족) — 적용 시 에러 나면 버전부터 확인.
- **Phase B(쓰기 경로) 방식 선택 대기**: 사용자에게 2~3안 제시함(2026-07-02 세션) — A안 다중 insert / B안 RPC 원자 기록(권장) / C안 route handler + 이벤트 로그. 세션 생성 시점(첫 답변 vs 페이지 로드)도 미결정.
- **`/r/[code]` 라우트 + 실제 레시피 연결**: `getRecipeByQrCode(code)`가 `QrResolution`(ok/void/not_found/not_ready)을 반환하도록 선반영됨 — 라우트에서 상태별 안내 UI만 붙이면 됨.
- **쓰기 repo들** (세션 생성·피드백 저장·조정 이력) — Phase B 방식 확정 후 작성.
- **챗봇 폴백 스텁** (§9 경계 — 룰은 AI 호출 안 함). 현재는 안내 문구만.
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
- ✅ **보안 리뷰 Phase A (2026-07-02)** — 0001 스키마에 복합 FK 테넌트 강제 반영(미적용 SQL이라 무비용), `client.ts`에 `server-only`, `qr.ts`가 `QrResolution` 상태 유니온 반환(폐기/미존재/미준비 구분), `describe.test.ts`로 §9 고정 템플릿 잠금(테스트 23개). dep `server-only` 추가.
- ✅ **`lib/db` 데이터 계층 골격 + 스키마 SQL** — `supabase/migrations/0001_init.sql`(9엔티티+enum+인덱스+RLS), `lib/db/client.ts`(server-only service_role 싱글턴), `lib/db/schema.ts`(행 타입, 도메인 enum 재사용), `lib/db/qr.ts`(`getRecipeByQrCode` 읽기 슬라이스). dep `@supabase/supabase-js` 추가. **SQL은 아직 미적용**.
- ✅ **§5 플로우 상태머신 + 사용자 UI** — `lib/domain/flow.ts`(`flowStep`, 순수) + `flow.test.ts`(13), `app/page.tsx`(레시피 카드→질문→처방, 뒤로/처음부터/도움받기). 카피: "커피 추출 도우미".
  - 라우팅: 좋아요→hold / **괜찮아요→C(맛+농도→격자, 시간·트리 skip)** / 아쉬워요→시간필터→짧·길이면 온도트리·비슷이면 격자 / 맛·농도 "해당없음"→챗봇.
- ✅ 도메인 룰 엔진 (`c4bf0ae`): grid/tree/invariants/describe.
- ✅ 개발 하네스 (`439c784`): `check` 스크립트·husky pre-commit·GitHub CI·CLAUDE.md.
- ✅ 컨텍스트 % 상태줄 + 40% `/compact` 권장 (`.claude/`, 개인 설정·미커밋).

## 현재 상태 스냅샷 (2026-07-02)
- 테스트 23 pass (불변식 5 + 흐름 13 + §9 템플릿 5). `npm run check` 통과.
- Next.js 16 / Node 22 LTS. Supabase 프로젝트·신형 키(`.env.local`) 준비·검증 완료. `@supabase/supabase-js` 설치됨.
- DB: 스키마 SQL 작성 완료(복합 FK 보강 포함), **Supabase 미적용**. `lib/db`에서 쓰기 repo는 아직 없음(읽기 `getRecipeByQrCode`만).
- 이 노트북(NB-26062424)에는 Node가 없어서 v22.23.1을 유저 스코프로 설치함(`%LOCALAPPDATA%\Programs\node-v22.23.1-win-x64`, 유저 PATH 등록). 새 셸에서 `node -v`로 확인.
- push 정책: 커밋은 자유, **push는 매번 확인 후**.
