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

// 없거나(폐기/오타) 활성 레시피가 없으면 null. 호출부가 안내 페이지로 분기.
export async function getRecipeByQrCode(code: string): Promise<ResolvedRecipe | null> {
  const { data: qrData, error: qrErr } = await db
    .from("qr_code")
    .select("id, roaster_id, bean_id, status")
    .eq("code", code)
    .eq("status", "active")
    .maybeSingle();
  if (qrErr) throw qrErr;
  if (!qrData) return null;
  const qr = qrData as Pick<QrCodeRow, "id" | "roaster_id" | "bean_id">;

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
  if (!beanData || !recipeData) return null;

  return {
    qrId: qr.id,
    roasterId: qr.roaster_id,
    bean: beanData as { id: string; name: string; intro: string | null },
    recipe: recipeData as RecipeRow,
  };
}
