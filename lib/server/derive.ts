import { z } from "zod";
import { flowStep, type FlowInput } from "../domain/flow";
import type { Move, Prescription } from "../domain/types";
import type { FeedbackPath } from "../db/schema";
import { ADJUSTMENT_STEPS } from "../config/adjustment-steps";

// ADR-001: 클라이언트가 계산한 처방은 신뢰하지 않는다. 답변(FlowInput)만 받아
// 서버에서 flowStep을 재실행해 경로·처방을 도출한다. 이 파일은 순수(도메인+설정만
// 의존, DB 접근 없음) — derive.test.ts로 검증한다.

// 경계 검증: 미지의 페이로드 → FlowInput. 모르는 키는 버린다(strip).
const flowInputSchema = z.object({
  satisfaction: z.enum(["good", "okay", "bad"]).optional(),
  time: z.enum(["short", "similar", "long"]).optional(),
  temp: z.enum(["high", "low", "similar", "unknown"]).optional(),
  taste: z.enum(["sour", "balanced", "bitter", "na"]).optional(),
  strength: z.enum(["strong", "medium", "light", "na"]).optional(),
  intensity: z.enum(["strong", "weak"]).optional(),
});

export type FeedbackDerivation = {
  prescription: Prescription;
  path: FeedbackPath;
  // feedback 테이블 컬럼과 1:1 (na는 컬럼에 없으므로 null로)
  record: {
    satisfaction: NonNullable<FlowInput["satisfaction"]>;
    time_answer: FlowInput["time"] | null;
    taste_answer: Exclude<FlowInput["taste"], "na" | undefined> | null;
    strength_answer: Exclude<FlowInput["strength"], "na" | undefined> | null;
    grid_cell: string | null;
    temp_answer: FlowInput["temp"] | null;
    intensity_answer: FlowInput["intensity"] | null;
    tree_leaf: string | null;
  };
};

export type DeriveResult =
  | { ok: true; derivation: FeedbackDerivation }
  | { ok: false; error: "invalid" | "incomplete" };

// 상태머신을 처음부터 재주행하며 "실제로 질문된 답"만 채택한다(경로 밖 필드 무시).
// 끝(done)에 도달하지 못하면 incomplete — 완주한 흐름만 기록한다.
export function deriveFeedback(raw: unknown): DeriveResult {
  const parsed = flowInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const answers = parsed.data as Record<string, string | undefined>;

  let used: FlowInput = {};
  for (let guard = 0; guard < 10; guard++) {
    const step = flowStep(used);
    if (step.kind === "done") {
      return { ok: true, derivation: toDerivation(used, step.prescription) };
    }
    const q = step.question;
    const answer = answers[q.id];
    if (answer === undefined) return { ok: false, error: "incomplete" };
    if (!(q.options as string[]).includes(answer)) return { ok: false, error: "invalid" };
    used = { ...used, [q.id]: answer } as FlowInput;
  }
  return { ok: false, error: "invalid" }; // 도달 불가 — 방어
}

function toDerivation(used: FlowInput, prescription: Prescription): FeedbackDerivation {
  const path: FeedbackPath =
    prescription.kind === "chatbot"
      ? "chatbot"
      : used.satisfaction === "good"
        ? "immediate"
        : used.time === "short" || used.time === "long"
          ? "tree"
          : "grid";

  const gridAnswered =
    used.taste !== undefined && used.taste !== "na" &&
    used.strength !== undefined && used.strength !== "na";

  return {
    prescription,
    path,
    record: {
      satisfaction: used.satisfaction!, // done 도달 = satisfaction 반드시 존재
      time_answer: used.time ?? null,
      taste_answer: used.taste === "na" ? null : (used.taste ?? null),
      strength_answer: used.strength === "na" ? null : (used.strength ?? null),
      grid_cell: gridAnswered ? `${used.taste}/${used.strength}` : null,
      temp_answer: used.temp ?? null,
      intensity_answer: used.intensity ?? null,
      tree_leaf:
        prescription.kind === "adjust" && prescription.source.path === "tree"
          ? prescription.source.leaf
          : null,
    },
  };
}

// ── 스냅샷(§8-1) ─────────────────────────────────────────────
// 조정 전/후 레시피 파라미터. recipe 행의 컬럼명과 동일한 snake_case(jsonb 보관물).
export type RecipeParams = {
  dose_g: number | null;
  water_g: number | null;
  water_temp_c: number | null;
  grind_text: string | null;
};

// moves를 수치 적용해 after_snapshot을 만든다. 분쇄는 표현 방식 [미결정](§6-4)이라
// 수치 적용을 보류하고 moves에 기호로만 남는다. temp reset은 기준(활성 레시피) 온도로.
export function applyMoves(
  before: RecipeParams,
  moves: Move[],
  baseTempC: number | null,
): RecipeParams {
  const after = { ...before };
  for (const m of moves) {
    const step = ADJUSTMENT_STEPS[m.variable][m.magnitude];
    if (m.variable === "water" && after.water_g !== null) {
      after.water_g += m.direction === "more" ? step : -step;
    } else if (m.variable === "temp") {
      if (m.direction === "reset") after.water_temp_c = baseTempC;
      else if (after.water_temp_c !== null)
        after.water_temp_c += m.direction === "up" ? step : -step;
    }
  }
  return after;
}
