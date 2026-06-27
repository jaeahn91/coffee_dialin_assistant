// PRD §5·§6 도메인 타입. 룰 엔진은 이 타입들만 다루며 DB·프레임워크·AI와 무관하다(§9 경계).

export type Taste = "sour" | "balanced" | "bitter"; // 신 / 균형 / 쓴 (추출 수율 축)
export type Strength = "strong" | "medium" | "light"; // 진함 / 적당 / 묽음 (농도 축)
export type TimeDeviation = "short" | "similar" | "long"; // 추출시간 사전필터: 짧 / 비슷 / 길
export type TempVsRecipe = "high" | "low" | "similar" | "unknown"; // 레시피 대비 물온도
export type Satisfaction = "good" | "okay" | "bad"; // 좋아요 / 괜찮아요 / 아쉬워요
export type TasteIntensity = "strong" | "weak"; // 트리 후속질문(신맛/쓴맛) 강/약

// 조정 폭. 구체 수치는 [미결정] 부록5 → lib/config/adjustment-steps.ts (튜닝 노브)
export type Magnitude = "slight" | "standard";

// 변수별 방향성 처방. temp의 "reset"은 기준점 복귀형(§6-3에서 거울상 예외).
export type GrindMove = { variable: "grind"; direction: "finer" | "coarser"; magnitude: Magnitude };
export type WaterMove = { variable: "water"; direction: "more" | "less"; magnitude: Magnitude };
export type TempMove = { variable: "temp"; direction: "up" | "down" | "reset"; magnitude: Magnitude };
export type Move = GrindMove | WaterMove | TempMove;

// 처방이 어느 규칙에서 나왔는지(§8-1 조정 이력의 "발화 규칙 ID"로 이어짐).
export type RuleSource =
  | { path: "grid"; cell: `${Taste}/${Strength}` }
  | { path: "tree"; leaf: string };

export type Prescription =
  | { kind: "hold" } // 유지
  | { kind: "adjust"; moves: Move[]; source: RuleSource }
  | { kind: "chatbot"; reason: string }; // 폴백 — 엔진은 AI를 호출하지 않고 경로만 넘긴다(§9)
