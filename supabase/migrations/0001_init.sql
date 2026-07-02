-- 0001_init.sql — 커피 추출 도우미 초기 스키마 (PRD §8 데이터 모델 v0)
--
-- 멀티테넌트: roaster를 제외한 모든 테이블에 roaster_id가 들어간다(§8-4).
-- 격리 강제 위치: 파일럿은 "애플리케이션 레벨"로 시작한다(§8-4). 서버(Next.js)가
--   service_role 키로 접근하고 lib/db가 항상 roaster_id로 스코프한다.
-- RLS 자세: 모든 테이블에 RLS를 켜되 anon/authenticated용 정책은 두지 않는다
--   = deny-by-default(접근 0). service_role은 RLS를 우회하므로 서버 경로만 열린다.
--   로스터 대시보드를 만들 때 authenticated 정책을 추가한다(아래 주석 참고).
-- 테넌트 정합성(2026-07-02 보안 리뷰): 부모 테이블이 unique (id, roaster_id)를 노출하고
--   자식은 (fk, roaster_id) 복합 FK로 참조한다. 앱이 roaster_id 필터를 빠뜨려도
--   테넌트 간 참조(예: A 세션에 B 피드백, 타 테넌트 조정을 잇는 세션 사슬)를 DB가 거부한다.
--   nullable FK의 "on delete set null (컬럼)" 문법은 PostgreSQL 15+ 필요.

create extension if not exists pgcrypto; -- gen_random_uuid()

-- ─────────────────────────────────────────────────────────────
-- 1. 열거형 — lib/domain/types.ts 와 1:1 (도메인 룰 엔진과 표현이 어긋나지 않게)
-- ─────────────────────────────────────────────────────────────
create type satisfaction   as enum ('good','okay','bad');                 -- 좋아요/괜찮아요/아쉬워요
create type time_deviation  as enum ('short','similar','long');            -- 추출시간 필터
create type temp_vs_recipe  as enum ('high','low','similar','unknown');    -- 레시피 대비 물온도
create type taste           as enum ('sour','balanced','bitter');          -- 맛 축
create type strength        as enum ('strong','medium','light');           -- 농도 축
create type taste_intensity as enum ('strong','weak');                     -- 트리 후속질문 강/약
create type feedback_path   as enum ('grid','tree','chatbot','immediate'); -- 경로 유형(§8-1)
create type qr_status       as enum ('active','void');                     -- QR 상태
create type bean_status     as enum ('selling','paused');                  -- 원두 판매 상태

-- ─────────────────────────────────────────────────────────────
-- 2. 테넌트 루트
-- ─────────────────────────────────────────────────────────────
create table roaster (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  auth_user_id uuid unique references auth.users(id) on delete set null, -- 파일럿 최소 로그인: Supabase Auth 매핑(선택)
  created_at   timestamptz not null default now()
);

create table bean (
  id         uuid primary key default gen_random_uuid(),
  roaster_id uuid not null references roaster(id) on delete cascade,
  name       text not null,
  intro      text,                                       -- 소개 텍스트(선택)
  status     bean_status not null default 'selling',
  created_at timestamptz not null default now(),
  unique (id, roaster_id)                                -- 자식 복합 FK의 참조 대상
);

create table batch ( -- 같은 원두의 로스팅 회차(선택 사용)
  id         uuid primary key default gen_random_uuid(),
  roaster_id uuid not null references roaster(id) on delete cascade,
  bean_id    uuid not null,
  roasted_on date,
  created_at timestamptz not null default now(),
  unique (id, roaster_id),
  foreign key (bean_id, roaster_id) references bean (id, roaster_id) on delete cascade
);

-- 레시피는 불변 버전으로 저장(§8-1). 수정 = 새 버전 행 + 활성 포인터 이동.
-- 옛 버전은 그 버전을 참조한 세션·피드백 때문에 그대로 남는다.
create table recipe (
  id            uuid primary key default gen_random_uuid(),
  roaster_id    uuid not null references roaster(id) on delete cascade,
  bean_id       uuid not null,
  version       int  not null,
  is_active     boolean not null default true,
  dripper       text,        -- 드리퍼 종류·모델(§4-1)
  dose_g        numeric,     -- 도징(원두 g)
  water_g       numeric,     -- 물량(g)
  water_temp_c  numeric,     -- 물온도(°C)
  brew_time_min_s int,       -- 목표 추출시간 범위 하한(초)
  brew_time_max_s int,       -- 목표 추출시간 범위 상한(초)
  grind_text    text,        -- 분쇄도: 표현 방식 [미결정](§6-4) → 텍스트 보관
  pour_text     text,        -- 붓기 안내: 프로토콜 [미결정](§4-1) → 텍스트 보관
  created_at    timestamptz not null default now(),
  unique (bean_id, version),
  unique (id, roaster_id),
  foreign key (bean_id, roaster_id) references bean (id, roaster_id) on delete cascade
);
-- 활성 레시피는 원두당 정확히 1개 (활성 포인터)
create unique index recipe_one_active_per_bean on recipe (bean_id) where is_active;

-- QR코드: 봉지 단위 유니크 발급(§8-3). 코드 1장 = 1행. bean 필수, batch 선택.
create table qr_code (
  id         uuid primary key default gen_random_uuid(),
  roaster_id uuid not null references roaster(id) on delete cascade,
  bean_id    uuid not null,          -- 필수
  batch_id   uuid,                   -- 선택
  code       text not null unique,   -- URL 스킴 /r/<code> 의 토큰(봉지 유니크, 추측 불가)
  status     qr_status not null default 'active',
  issued_at  timestamptz not null default now(),
  unique (id, roaster_id),
  foreign key (bean_id, roaster_id)  references bean (id, roaster_id)  on delete cascade,
  foreign key (batch_id, roaster_id) references batch (id, roaster_id) on delete set null (batch_id)
);

-- 추출 세션: QR 접속 한 번(§8-1). prev_adjustment_id FK는 adjustment 생성 후 추가(순환 참조).
create table brew_session (
  id                 uuid primary key default gen_random_uuid(),
  roaster_id         uuid not null references roaster(id) on delete cascade,
  qr_id              uuid not null,
  recipe_id          uuid not null,                        -- 세션에 표시된 기준 레시피 버전
  prev_adjustment_id uuid,                                 -- 같은 사슬 직전 조정(§8-5) — FK 아래에서
  device_token       text,                                 -- 보조 연속성(선택, 느슨한 참조)
  started_at         timestamptz not null default now(),
  unique (id, roaster_id),
  foreign key (qr_id, roaster_id)     references qr_code (id, roaster_id) on delete cascade,
  foreign key (recipe_id, roaster_id) references recipe (id, roaster_id)
);

-- 피드백: 세션의 응답 묶음(§8-1). 세션과 분리 — 스캔만 하고 미응답한 세션을 셀 수 있어야 퍼널이 보인다.
-- 세션:피드백 = 1:0..1 (session_id unique).
create table feedback (
  id          uuid primary key default gen_random_uuid(),
  roaster_id  uuid not null references roaster(id) on delete cascade,
  session_id  uuid not null unique,
  satisfaction satisfaction not null,
  time_answer  time_deviation,        -- 추출시간 필터 답
  path         feedback_path not null,
  -- 격자 경로
  taste_answer    taste,
  strength_answer strength,
  grid_cell       text,               -- 격자 칸 ID (예: 'sour/strong')
  -- 트리 경로
  temp_answer      temp_vs_recipe,
  intensity_answer taste_intensity,   -- 추가 질문(신/쓴 강약)
  tree_leaf        text,              -- 트리 잎 ID
  -- 챗봇 경로
  chatbot_text       text,            -- 자유 서술 원문
  chatbot_structured jsonb,           -- 챗봇이 구조화한 결과(선택)
  created_at   timestamptz not null default now(),
  unique (id, roaster_id),
  foreign key (session_id, roaster_id) references brew_session (id, roaster_id) on delete cascade
);

-- 조정 이력: §6-3 수렴 메커니즘의 전제(§8-1). 피드백 1건 → 처방 1건(feedback_id unique).
-- moves/스냅샷은 lib/domain의 Move[]·레시피 파라미터와 동형이 되도록 jsonb로 보관.
create table adjustment (
  id          uuid primary key default gen_random_uuid(),
  roaster_id  uuid not null references roaster(id) on delete cascade,
  session_id  uuid not null,
  feedback_id uuid not null unique,
  rule_source jsonb not null,                 -- 발화 규칙 ID: {path:'grid',cell} | {path:'tree',leaf} | {path:'chatbot'}
  moves       jsonb not null default '[]'::jsonb, -- 변수×방향×폭 (폭 정의 [미결정] 부록5 — 칸만)
  before_snapshot jsonb not null,             -- 조정 전 레시피 파라미터
  after_snapshot  jsonb not null,             -- 조정 후 — 다음 세션의 표시 레시피
  created_at  timestamptz not null default now(),
  unique (id, roaster_id),
  foreign key (session_id, roaster_id)  references brew_session (id, roaster_id) on delete cascade,
  foreign key (feedback_id, roaster_id) references feedback (id, roaster_id) on delete cascade
);

-- 순환 참조 해소: 세션 → 직전 조정(§8-5, 반전 감지의 연결 고리)
alter table brew_session
  add constraint brew_session_prev_adjustment_fk
  foreign key (prev_adjustment_id, roaster_id) references adjustment (id, roaster_id)
  on delete set null (prev_adjustment_id);

-- 디바이스 토큰(§8-1): 로스터 단위로 끊어 발급(§8-4). 같은 기기라도 로스터마다 다른 토큰.
create table device_token (
  token         text not null,
  roaster_id    uuid not null references roaster(id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  primary key (roaster_id, token)
);

-- ─────────────────────────────────────────────────────────────
-- 3. 인덱스 — §8-5 세션 사슬 조회(qr_id 1순위, device_token+bean 보조) + 테넌트 필터
-- ─────────────────────────────────────────────────────────────
create index bean_roaster_idx        on bean (roaster_id);
create index recipe_bean_idx         on recipe (bean_id);
create index qr_code_roaster_idx     on qr_code (roaster_id);
create index brew_session_qr_idx     on brew_session (qr_id, started_at);
create index brew_session_device_idx on brew_session (roaster_id, device_token);
create index feedback_roaster_idx    on feedback (roaster_id);
create index adjustment_session_idx  on adjustment (session_id);

-- ─────────────────────────────────────────────────────────────
-- 4. RLS — 전 테이블 활성 + deny-by-default (정책 없음 = anon/authenticated 접근 0).
--    MVP는 서버가 service_role로 접근(§8-4 앱레벨 강제). service_role은 RLS 우회.
-- ─────────────────────────────────────────────────────────────
alter table roaster      enable row level security;
alter table bean         enable row level security;
alter table batch        enable row level security;
alter table recipe       enable row level security;
alter table qr_code      enable row level security;
alter table brew_session enable row level security;
alter table feedback     enable row level security;
alter table adjustment   enable row level security;
alter table device_token enable row level security;

-- 향후 로스터 대시보드(authenticated 직접 접근)용 정책 예시 — 지금은 미적용:
--   create policy roaster_reads_own_beans on bean for select to authenticated
--     using (roaster_id in (select id from roaster where auth_user_id = auth.uid()));
-- 테넌트별로 같은 패턴을 각 테이블에 추가하면 된다.
