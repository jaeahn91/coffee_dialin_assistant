# 다음 작업 (NEXT)

> 세션이 끊겨도 여기서 바로 이어받기 위한 메모. 끝난 항목은 지우거나 체크.

## 지금 할 일 — (다음 후보 중 택1)
- **`lib/db` 데이터 접근 계층 + Supabase 9엔티티 스키마 + RLS** (셋업 5단계, 키는 `.env.local`에 준비됨). 테넌트 격리(`roaster_id`) 검토 필요.
- **실제 레시피 연결**: 지금 `app/page.tsx`의 `RECIPE`는 목업. QR→로스터 레시피 로딩으로 교체.
- **챗봇 폴백 스텁** (§9 경계 — 룰은 AI 호출 안 함). 현재는 안내 문구만.
- **디자인/스타일링** 다듬기 (현재 최소 Tailwind).

## 완료됨
- ✅ **§5 플로우 상태머신 + 사용자 UI** — `lib/domain/flow.ts`(`flowStep`, 순수) + `flow.test.ts`(13), `app/page.tsx`(레시피 카드→질문→처방, 뒤로/처음부터/도움받기). 카피: "커피 추출 도우미".
  - 라우팅: 좋아요→hold / **괜찮아요→C(맛+농도→격자, 시간·트리 skip)** / 아쉬워요→시간필터→짧·길이면 온도트리·비슷이면 격자 / 맛·농도 "해당없음"→챗봇.
- ✅ 도메인 룰 엔진 (`c4bf0ae`): grid/tree/invariants/describe.
- ✅ 개발 하네스 (`439c784`): `check` 스크립트·husky pre-commit·GitHub CI·CLAUDE.md.
- ✅ 컨텍스트 % 상태줄 + 40% `/compact` 권장 (`.claude/`, 개인 설정·미커밋).

## 현재 상태 스냅샷 (2026-06-27)
- 테스트 18 pass (불변식 5 + 흐름 13). `npm run check` 통과. CI 녹색.
- Next.js 16 / Node 22 LTS. Supabase 프로젝트·신형 키(`.env.local`) 준비·검증 완료.
- push 정책: 커밋은 자유, **push는 매번 확인 후**.
