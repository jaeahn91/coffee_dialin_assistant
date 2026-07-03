import { z } from "zod";
import { flowStep, type FlowInput } from "../domain/flow";
import type { GrindMove, Move, Prescription } from "../domain/types";
import type { FeedbackPath } from "../db/schema";
import {
  ADJUSTMENT_STEPS,
  WATER_STEP_DOSE_RATIO,
  WATER_STEP_FALLBACK_G,
} from "../config/adjustment-steps";
import {
  GRIND_RUN_LIMIT,
  TEMP_LIMIT_C,
  WATER_LIMIT_FRACTION,
} from "../config/adjustment-limits";

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

// 경계 가드가 무효화한 변수 — 화면에서 LIMIT_NOTICES[변수] 고정 문구로 안내한다.
export type LimitedVariable = "grind" | "water" | "temp";

export type GuardedApply = {
  after: RecipeParams;
  moves: Move[]; // 실제 채택된 move(기록·표시용). 경계에서 무효화된 move는 빠진다.
  limited: LimitedVariable[];
};

// 사슬(최신순 moves 이력)의 끝쪽 같은 방향 분쇄 권유 런. 분쇄가 아닌 조정은 런을 끊지
// 않는다(그라인더 위치는 그대로) — 반대 방향 분쇄 권유가 나와야 런이 끝난다(ADR-003).
// 격자·트리는 처방당 분쇄 move를 최대 1개만 내므로 find로 충분하다.
export function trailingGrindRun(
  history: Move[][],
): { direction: GrindMove["direction"]; length: number } | null {
  let direction: GrindMove["direction"] | null = null;
  let length = 0;
  for (const moves of history) {
    const g = moves.find((m): m is GrindMove => m.variable === "grind");
    if (!g) continue;
    if (direction === null) {
      direction = g.direction;
      length = 1;
    } else if (g.direction === direction) {
      length += 1;
    } else {
      break;
    }
  }
  return direction === null ? null : { direction, length };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// moves를 수치 적용해 after_snapshot을 만들되, 경계 가드(ADR-003)를 강제한다:
//   온도 — 절대 80~100°C 클램프(스텝이 경계를 넘으면 경계값까지만, 이미 경계면 무효화).
//   물량 — 스텝 = 원두량 × 비율(1:15 → 1:15.5), 경계 = 기준(활성 레시피) 물량 ±20%.
//   분쇄 — 수치 적용은 계속 보류(§6-4 미결정, ADR-002). 대신 사슬에서 같은 방향 권유가
//          GRIND_RUN_LIMIT회 연속이면 무효화(µm 경계의 횟수 근사).
// temp reset은 기준점 복귀형이라 경계와 무관. 역방향 move는 경계에서도 항상 허용되므로
// 거울상 불변식(§6-3)은 유지된다.
export function applyMoves(
  before: RecipeParams,
  moves: Move[],
  base: { tempC: number | null; waterG: number | null },
  grindHistory: Move[][], // 이 QR 사슬의 최근 moves, 최신순
): GuardedApply {
  const after = { ...before };
  const adopted: Move[] = [];
  const limited: LimitedVariable[] = [];
  const run = trailingGrindRun(grindHistory);

  for (const m of moves) {
    if (m.variable === "grind") {
      if (run && run.direction === m.direction && run.length >= GRIND_RUN_LIMIT) {
        limited.push("grind");
      } else {
        adopted.push(m); // 수치 미적용 — 기호로만 남는다
      }
      continue;
    }

    if (m.variable === "water") {
      if (after.water_g === null) {
        adopted.push(m); // 수치 미상 — 기호만 기록(기존 동작 유지)
        continue;
      }
      const step =
        before.dose_g !== null
          ? before.dose_g * WATER_STEP_DOSE_RATIO[m.magnitude]
          : WATER_STEP_FALLBACK_G[m.magnitude];
      const target = after.water_g + (m.direction === "more" ? step : -step);
      const next = round1(
        base.waterG === null
          ? target
          : Math.min(
              Math.max(target, base.waterG * (1 - WATER_LIMIT_FRACTION)),
              base.waterG * (1 + WATER_LIMIT_FRACTION),
            ),
      );
      if (next === after.water_g) {
        limited.push("water");
      } else {
        after.water_g = next;
        adopted.push(m);
      }
      continue;
    }

    // temp
    if (m.direction === "reset") {
      after.water_temp_c = base.tempC;
      adopted.push(m);
      continue;
    }
    if (after.water_temp_c === null) {
      adopted.push(m); // 수치 미상 — 기호만 기록(기존 동작 유지)
      continue;
    }
    const step = ADJUSTMENT_STEPS.temp[m.magnitude];
    const target = after.water_temp_c + (m.direction === "up" ? step : -step);
    const next = Math.min(Math.max(target, TEMP_LIMIT_C.min), TEMP_LIMIT_C.max);
    if (next === after.water_temp_c) {
      limited.push("temp");
    } else {
      after.water_temp_c = next;
      adopted.push(m);
    }
  }
  return { after, moves: adopted, limited };
}
