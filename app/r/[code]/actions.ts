"use server";

import { recordFeedback } from "@/lib/db/feedback";
import { getRecipeByQrCode } from "@/lib/db/qr";
import { getSessionBaseline, startBrewSession, type StartSessionResult } from "@/lib/db/sessions";
import type { Move } from "@/lib/domain/types";
import { applyMoves, deriveFeedback, type RecipeParams } from "@/lib/server/derive";

// ADR-001 씸 계약: 액션은 "인자 → lib 호출 → 결과 매핑" 래퍼로만 유지한다.
// 로직이 자라면 lib/server 또는 lib/db로 내린다.

export async function startSessionAction(code: string): Promise<StartSessionResult> {
  if (typeof code !== "string" || code.length === 0 || code.length > 128)
    return { ok: false, reason: "qr_not_available" };
  return startBrewSession(code);
}

export type SubmitResult =
  // applied: 이번 기록으로 생긴 조정(없으면 null). 카드가 재조회 없이 최신 사슬을 반영할 수 있게
  // 서버가 기록한 것과 동일한 after/moves를 그대로 돌려준다(표시용 — 신뢰 원천은 어차피 서버).
  | { ok: true; applied: { after: RecipeParams; moves: Move[] } | null }
  | {
      ok: false;
      reason: "invalid" | "incomplete" | "qr" | "session_not_found" | "already_recorded" | "unknown";
    };

export async function submitFeedbackAction(
  code: string,
  sessionId: string,
  rawInput: unknown,
): Promise<SubmitResult> {
  const derived = deriveFeedback(rawInput);
  if (!derived.ok) return { ok: false, reason: derived.error };

  // 스냅샷 기준 파라미터: 세션이 표시한 활성 레시피. sessionId는 서버 발급 uuid라
  // 자기 세션 외에는 알 수 없다(코드-세션 불일치는 자해만 가능).
  const resolved = await getRecipeByQrCode(code);
  if (resolved.status !== "ok") return { ok: false, reason: "qr" };

  const { prescription } = derived.derivation;
  let snapshots: { before: RecipeParams; after: RecipeParams } | null = null;
  if (prescription.kind === "adjust") {
    // 사슬 누적(§8-5, ADR-002): before = 이 세션이 표시했던 레시피 = 직전 조정의
    // after_snapshot(없으면 기준 레시피). temp reset의 기준점만 항상 활성 레시피.
    const baseParams: RecipeParams = {
      dose_g: resolved.recipe.dose_g,
      water_g: resolved.recipe.water_g,
      water_temp_c: resolved.recipe.water_temp_c,
      grind_text: resolved.recipe.grind_text,
    };
    const before = (await getSessionBaseline(sessionId)) ?? baseParams;
    snapshots = {
      before,
      after: applyMoves(before, prescription.moves, resolved.recipe.water_temp_c),
    };
  }

  const result = await recordFeedback(sessionId, derived.derivation, snapshots);
  if (!result.ok) return { ok: false, reason: result.reason };
  return {
    ok: true,
    applied:
      snapshots && prescription.kind === "adjust"
        ? { after: snapshots.after, moves: prescription.moves }
        : null,
  };
}
