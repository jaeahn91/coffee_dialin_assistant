import { headers } from "next/headers";
import { recordPageView } from "@/lib/db/page-views";
import { getRecipeByQrCode } from "@/lib/db/qr";
import { describeMove } from "@/lib/domain/describe";
import Flow, { type AdjustedParams, type RecipeDisplay } from "./flow";

// QR 진입점(§5): 코드 해석 → 상태별 안내 or 흐름 시작. 항상 동적 렌더(코드별 페이지).

const NOTICE: Record<"void" | "not_found" | "not_ready", { title: string; body: string }> = {
  not_found: {
    title: "코드를 찾을 수 없어요",
    body: "주소가 정확한지 확인해 주세요. 봉지의 QR 코드를 다시 스캔하면 가장 정확해요.",
  },
  void: {
    title: "더 이상 사용되지 않는 코드예요",
    body: "이 QR 코드는 로스터리에서 회수했어요. 새로 구매하신 봉지의 QR 코드를 이용해 주세요.",
  },
  not_ready: {
    title: "레시피 준비 중이에요",
    body: "이 원두의 추천 레시피가 아직 등록되지 않았어요. 잠시 후 다시 확인해 주세요.",
  },
};

export default async function RecipePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const resolved = await getRecipeByQrCode(code);

  if (resolved.status !== "ok") {
    const notice = NOTICE[resolved.status];
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-5 py-10">
        <h1 className="text-xl font-semibold">{notice.title}</h1>
        <p className="text-sm opacity-70">{notice.body}</p>
      </main>
    );
  }

  // 퍼널 1단(ADR-001): 스캔 기록. 세션은 첫 답변 시에야 생긴다.
  const userAgent = (await headers()).get("user-agent");
  await recordPageView(resolved.qrId, resolved.roasterId, userAgent);

  const recipe: RecipeDisplay = {
    beanName: resolved.bean.name,
    beanIntro: resolved.bean.intro,
    dripper: resolved.recipe.dripper,
    dose_g: resolved.recipe.dose_g,
    water_g: resolved.recipe.water_g,
    water_temp_c: resolved.recipe.water_temp_c,
    brew_time_min_s: resolved.recipe.brew_time_min_s,
    brew_time_max_s: resolved.recipe.brew_time_max_s,
    grind_text: resolved.recipe.grind_text,
    grind_um: resolved.recipe.grind_um,
  };

  // ADR-002: 물량·온도·도징은 사슬의 최신 after_snapshot을 절대값으로 표시.
  // 분쇄도는 수치를 수정하지 않는다 — 대신 최근 솔루션(모든 move)을 §9 템플릿
  // 한 줄로 보여준다. 물·온도는 숫자에도 반영되지만 "왜 바뀌었는지"의 설명을 겸한다.
  const last = resolved.lastAdjustment;
  const adjusted: AdjustedParams | null = last
    ? {
        dose_g: last.after_snapshot.dose_g,
        water_g: last.after_snapshot.water_g,
        water_temp_c: last.after_snapshot.water_temp_c,
      }
    : null;
  const lastSolution = last?.moves.map(describeMove).join(" + ") || null;

  return <Flow code={code} recipe={recipe} adjusted={adjusted} lastSolution={lastSolution} />;
}
