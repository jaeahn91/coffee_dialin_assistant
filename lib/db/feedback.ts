import { db } from "./client";
import type { FeedbackDerivation, RecipeParams } from "../server/derive";
import type { Move } from "../domain/types";

// 피드백 기록(ADR-001): 도출된 결과를 record_feedback RPC로 원자 기록.
// 처방 계산은 lib/server/derive.ts(서버 재도출)가 이미 끝냈다 — 여기는 매핑만.
// adjustment.moves는 경계 가드(ADR-003)를 통과해 실제 채택된 move만 기록한다.
// 가드가 무효화한 move는 저장하지 않는다 — rule_source가 있으니 발화 규칙의 기대
// moves와의 차이로 사후 도출 가능.

export type RecordFeedbackResult =
  | { ok: true; feedbackId: string; adjustmentId: string | null }
  | { ok: false; reason: "session_not_found" | "already_recorded" | "unknown" };

export async function recordFeedback(
  sessionId: string,
  derivation: FeedbackDerivation,
  adjustment: { before: RecipeParams; after: RecipeParams; moves: Move[] } | null,
): Promise<RecordFeedbackResult> {
  const { prescription, path, record } = derivation;
  const isAdjust = prescription.kind === "adjust";

  const { data, error } = await db.rpc("record_feedback", {
    p_session_id: sessionId,
    p_satisfaction: record.satisfaction,
    p_path: path,
    p_time_answer: record.time_answer,
    p_taste_answer: record.taste_answer,
    p_strength_answer: record.strength_answer,
    p_grid_cell: record.grid_cell,
    p_temp_answer: record.temp_answer,
    p_intensity_answer: record.intensity_answer,
    p_tree_leaf: record.tree_leaf,
    p_rule_source: isAdjust ? prescription.source : null,
    p_moves: isAdjust ? adjustment?.moves : null,
    p_before_snapshot: isAdjust ? adjustment?.before : null,
    p_after_snapshot: isAdjust ? adjustment?.after : null,
  });

  if (error) {
    if (error.message.includes("feedback_already_recorded"))
      return { ok: false, reason: "already_recorded" };
    if (error.message.includes("session_not_found"))
      return { ok: false, reason: "session_not_found" };
    console.error("record_feedback 실패:", error.message);
    return { ok: false, reason: "unknown" };
  }

  const result = data as { feedback_id: string; adjustment_id: string | null };
  return { ok: true, feedbackId: result.feedback_id, adjustmentId: result.adjustment_id };
}
