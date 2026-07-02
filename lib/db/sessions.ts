import { db } from "./client";
import { DAILY_SESSION_CAP } from "../config/limits";
import type { RecipeParams } from "../server/derive";

// 세션 시작(ADR-001): 첫 답변 시 호출. 검증·상한·§8-5 사슬 연결은 RPC가 원자 처리.

export type StartSessionResult =
  | { ok: true; sessionId: string }
  | { ok: false; reason: "qr_not_available" | "recipe_not_ready" | "daily_session_cap" | "unknown" };

const KNOWN_REASONS = ["qr_not_available", "recipe_not_ready", "daily_session_cap"] as const;

export async function startBrewSession(code: string): Promise<StartSessionResult> {
  const { data, error } = await db.rpc("start_brew_session", {
    p_code: code,
    p_daily_cap: DAILY_SESSION_CAP,
  });
  if (error) {
    const known = KNOWN_REASONS.find((r) => error.message.includes(r));
    if (known) return { ok: false, reason: known };
    console.error("start_brew_session 실패:", error.message);
    return { ok: false, reason: "unknown" };
  }
  return { ok: true, sessionId: data as string };
}

// 세션의 표시 기준선(§8-5, ADR-002 사슬 누적): 이 세션이 이은 직전 조정의
// after_snapshot. 없으면 null = 기준(활성) 레시피가 표시됐던 세션.
export async function getSessionBaseline(sessionId: string): Promise<RecipeParams | null> {
  const { data: session, error } = await db
    .from("brew_session")
    .select("prev_adjustment_id")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw error;
  if (!session?.prev_adjustment_id) return null;

  const { data: adj, error: adjErr } = await db
    .from("adjustment")
    .select("after_snapshot")
    .eq("id", session.prev_adjustment_id)
    .maybeSingle();
  if (adjErr) throw adjErr;
  return (adj?.after_snapshot as RecipeParams) ?? null;
}
