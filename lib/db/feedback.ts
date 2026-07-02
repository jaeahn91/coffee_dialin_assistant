import { db } from "./client";
import type { FeedbackDerivation, RecipeParams } from "../server/derive";

// 피드백 기록(ADR-001): 도출된 결과를 record_feedback RPC로 원자 기록.
// 처방 계산은 lib/server/derive.ts(서버 재도출)가 이미 끝냈다 — 여기는 매핑만.

export type RecordFeedbackResult =
  | { ok: true; feedbackId: string; adjustmentId: string | null }
  | { ok: false; reason: "session_not_found" | "already_recorded" | "unknown" };

export async function recordFeedback(
  sessionId: string,
  derivation: FeedbackDerivation,
  snapshots: { before: RecipeParams; after: RecipeParams } | null,
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
    p_moves: isAdjust ? prescription.moves : null,
    p_before_snapshot: isAdjust ? snapshots?.before : null,
    p_after_snapshot: isAdjust ? snapshots?.after : null,
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
