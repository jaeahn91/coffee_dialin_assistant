# 다음 작업 (NEXT)

> 세션이 끊겨도 여기서 바로 이어받기 위한 메모. 끝난 항목은 지우거나 체크.

## 지금 할 일
- **🔴 마이그레이션 Supabase 적용 (비가역 — 사용자 확인 후)**: `supabase/migrations/0001_init.sql`을 SQL Editor 붙여넣기 또는 CLI로. 아직 **미적용**.
- **`/r/[code]` 라우트 + 실제 레시피 연결**: `lib/db/qr.ts`의 `getRecipeByQrCode(code)`로 `app/page.tsx`의 목업 `RECIPE` 교체. 깨진/폐기/미존재 코드 안내 분기 필요.
- **쓰기 repo들** (세션 생성·피드백 저장·조정 이력) — §5 흐름을 DB에 붙일 때 작성. 이번 버스트에선 의도적으로 제외.
- **챗봇 폴백 스텁** (§9 경계 — 룰은 AI 호출 안 함). 현재는 안내 문구만.
- **디자인/스타일링** 다듬기 (현재 최소 Tailwind).

## 결정 메모
- **QR URL 스킴**: `https://<도메인>/r/<code>`, `code`=추측불가 url-safe 토큰(봉지 유니크). roaster/bean은 URL에 안 박고 서버에서 해석(불투명 코드).
- **도메인**: 파일럿은 **Vercel 도메인 고정**. 실출시 시 변경 가능(옛 도메인 301 리다이렉트로 인쇄된 QR 구제). 커스텀 도메인 구매는 **실제 QR 인쇄 직전**에만 필요 — 임계경로 밖. 살 의향 있음.
- **RLS 자세**: deny-by-default(전 테이블 RLS on, anon/authenticated 정책 없음=접근 0). 서버가 `service_role`로만 접근, `lib/db`가 `roaster_id` 강제(§8-4). Supabase 프로젝트 "자동 RLS" 옵션도 켜둠(보조).

## 완료됨
- ✅ **`lib/db` 데이터 계층 골격 + 스키마 SQL** — `supabase/migrations/0001_init.sql`(9엔티티+enum+인덱스+RLS), `lib/db/client.ts`(server-only service_role 싱글턴), `lib/db/schema.ts`(행 타입, 도메인 enum 재사용), `lib/db/qr.ts`(`getRecipeByQrCode` 읽기 슬라이스). dep `@supabase/supabase-js` 추가. **SQL은 아직 미적용**.
- ✅ **§5 플로우 상태머신 + 사용자 UI** — `lib/domain/flow.ts`(`flowStep`, 순수) + `flow.test.ts`(13), `app/page.tsx`(레시피 카드→질문→처방, 뒤로/처음부터/도움받기). 카피: "커피 추출 도우미".
  - 라우팅: 좋아요→hold / **괜찮아요→C(맛+농도→격자, 시간·트리 skip)** / 아쉬워요→시간필터→짧·길이면 온도트리·비슷이면 격자 / 맛·농도 "해당없음"→챗봇.
- ✅ 도메인 룰 엔진 (`c4bf0ae`): grid/tree/invariants/describe.
- ✅ 개발 하네스 (`439c784`): `check` 스크립트·husky pre-commit·GitHub CI·CLAUDE.md.
- ✅ 컨텍스트 % 상태줄 + 40% `/compact` 권장 (`.claude/`, 개인 설정·미커밋).

## 현재 상태 스냅샷 (2026-06-30)
- 테스트 18 pass (불변식 5 + 흐름 13). `npm run check` 통과.
- Next.js 16 / Node 22 LTS. Supabase 프로젝트·신형 키(`.env.local`) 준비·검증 완료. `@supabase/supabase-js` 설치됨.
- DB: 스키마 SQL 작성 완료, **Supabase 미적용**. `lib/db`에서 쓰기 repo는 아직 없음(읽기 `getRecipeByQrCode`만).
- push 정책: 커밋은 자유, **push는 매번 확인 후**.
