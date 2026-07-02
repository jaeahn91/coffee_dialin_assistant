import { db } from "./client";

// 조회 이벤트(ADR-001 퍼널 1단): /r/[code] 렌더 시 1행. 실패해도 페이지를 막지 않는다.
export async function recordPageView(
  qrId: string,
  roasterId: string,
  userAgent: string | null,
): Promise<void> {
  const { error } = await db
    .from("page_view")
    .insert({ qr_id: qrId, roaster_id: roasterId, user_agent: userAgent });
  if (error) console.error("page_view 기록 실패:", error.message);
}
