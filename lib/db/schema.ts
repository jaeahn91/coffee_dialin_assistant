// DB 9개 테이블의 행 타입 (supabase/migrations/0001_init.sql 과 1:1).
// enum은 lib/domain/types.ts를 재사용해 DB와 룰 엔진이 같은 단어를 쓰게 한다.
// jsonb 칸(rule_source/moves)도 도메인 타입과 동형으로 둔다(§8-1).
// 나중에 `supabase gen types`로 자동 생성 타입으로 교체할 수 있다.

import type {
  Move,
  RuleSource,
  Satisfaction,
  Strength,
  Taste,
  TasteIntensity,
  TempVsRecipe,
  TimeDeviation,
} from "@/lib/domain/types";

export type FeedbackPath = "grid" | "tree" | "chatbot" | "immediate"; // 경로 유형(§8-1)
export type QrStatus = "active" | "void";
export type BeanStatus = "selling" | "paused";

export type RoasterRow = {
  id: string;
  name: string;
  auth_user_id: string | null;
  created_at: string;
};

export type BeanRow = {
  id: string;
  roaster_id: string;
  name: string;
  intro: string | null;
  status: BeanStatus;
  created_at: string;
};

export type BatchRow = {
  id: string;
  roaster_id: string;
  bean_id: string;
  roasted_on: string | null;
  created_at: string;
};

export type RecipeRow = {
  id: string;
  roaster_id: string;
  bean_id: string;
  version: number;
  is_active: boolean;
  dripper: string | null;
  dose_g: number | null;
  water_g: number | null;
  water_temp_c: number | null;
  brew_time_min_s: number | null;
  brew_time_max_s: number | null;
  grind_text: string | null;
  pour_text: string | null;
  created_at: string;
};

export type QrCodeRow = {
  id: string;
  roaster_id: string;
  bean_id: string;
  batch_id: string | null;
  code: string;
  status: QrStatus;
  issued_at: string;
};

export type BrewSessionRow = {
  id: string;
  roaster_id: string;
  qr_id: string;
  recipe_id: string;
  prev_adjustment_id: string | null;
  device_token: string | null;
  started_at: string;
};

export type FeedbackRow = {
  id: string;
  roaster_id: string;
  session_id: string;
  satisfaction: Satisfaction;
  time_answer: TimeDeviation | null;
  path: FeedbackPath;
  taste_answer: Taste | null;
  strength_answer: Strength | null;
  grid_cell: string | null;
  temp_answer: TempVsRecipe | null;
  intensity_answer: TasteIntensity | null;
  tree_leaf: string | null;
  chatbot_text: string | null;
  chatbot_structured: unknown;
  created_at: string;
};

export type AdjustmentRow = {
  id: string;
  roaster_id: string;
  session_id: string;
  feedback_id: string;
  rule_source: RuleSource;
  moves: Move[];
  before_snapshot: unknown; // 조정 전 레시피 파라미터 스냅샷
  after_snapshot: unknown; // 조정 후 — 다음 세션의 표시 레시피
  created_at: string;
};

export type DeviceTokenRow = {
  token: string;
  roaster_id: string;
  first_seen_at: string;
  last_seen_at: string;
};
