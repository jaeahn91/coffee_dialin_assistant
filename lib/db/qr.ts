import { db } from "./client";
import type { QrCodeRow, RecipeRow } from "./schema";

// 계층의 첫 슬라이스: QR code → 원두 + 활성 레시피.
// §5 흐름을 실제 레시피에 붙일 때(목업 RECIPE 교체)의 진입점. /r/[code] 라우트가 호출한다.

export type ResolvedRecipe = {
  qrId: string;
  roasterId: string;
  bean: { id: string; name: string; intro: string | null };
  recipe: RecipeRow;
};

// 손님에게 다른 안내가 필요한 세 가지 실패를 구분한다:
//   void      — 로스터가 폐기한 코드 (예: 회수된 봉지)
//   not_found — 존재하지 않는 코드 (오타·위조)
//   not_ready — QR은 유효하나 원두/활성 레시피가 아직 없음
export type QrResolution =
  | ({ status: "ok" } & ResolvedRecipe)
  | { status: "void" }
  | { status: "not_found" }
  | { status: "not_ready" };

export async function getRecipeByQrCode(code: string): Promise<QrResolution> {
  const { data: qrData, error: qrErr } = await db
    .from("qr_code")
    .select("id, roaster_id, bean_id, status")
    .eq("code", code)
    .maybeSingle();
  if (qrErr) throw qrErr;
  if (!qrData) return { status: "not_found" };
  const qr = qrData as Pick<QrCodeRow, "id" | "roaster_id" | "bean_id" | "status">;
  if (qr.status !== "active") return { status: "void" };

  const [{ data: beanData, error: beanErr }, { data: recipeData, error: recipeErr }] =
    await Promise.all([
      db.from("bean").select("id, name, intro").eq("id", qr.bean_id).maybeSingle(),
      db
        .from("recipe")
        .select("*")
        .eq("bean_id", qr.bean_id)
        .eq("is_active", true)
        .maybeSingle(),
    ]);
  if (beanErr) throw beanErr;
  if (recipeErr) throw recipeErr;
  if (!beanData || !recipeData) return { status: "not_ready" };

  return {
    status: "ok",
    qrId: qr.id,
    roasterId: qr.roaster_id,
    bean: beanData as { id: string; name: string; intro: string | null },
    recipe: recipeData as RecipeRow,
  };
}
