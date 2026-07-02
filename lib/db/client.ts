import "server-only"; // 클라이언트 번들에 섞이면 빌드 자체가 실패한다

import { createClient } from "@supabase/supabase-js";

// 데이터 창고 출입구(§8-4). 서버 전용: service_role 키는 RLS를 우회하므로
// 브라우저로 새면 전 테넌트 데이터가 열린다. 절대 클라이언트에서 import 금지.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다 (.env.local).",
  );
}

// 싱글턴(모듈 캐시). 격리는 RLS가 아니라 lib/db의 각 함수가 roaster_id로 강제한다(§8-4).
export const db = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
