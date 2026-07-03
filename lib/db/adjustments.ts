import type { Move } from "../domain/types";
import { db } from "./client";

// 경계 가드(ADR-003)용 읽기 슬라이스: 이 QR 사슬의 최근 조정 moves(최신순).
// trailingGrindRun(lib/server/derive)이 분쇄 반복 상한을 검사하는 데 쓴다.
export async function recentMovesForQr(qrId: string, limit: number): Promise<Move[][]> {
  const { data, error } = await db.rpc("recent_moves_for_qr", {
    p_qr_id: qrId,
    p_limit: limit,
  });
  if (error) throw error;
  return (data as Move[][] | null) ?? [];
}
