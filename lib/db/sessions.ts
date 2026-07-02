import { db } from "./client";
import { DAILY_SESSION_CAP } from "../config/limits";

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
