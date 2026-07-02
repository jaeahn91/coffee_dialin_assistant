-- 0002_rpc.sql — 쓰기 경로 RPC (ADR-001 B+안)
--
-- 원칙: 도메인 로직(처방 계산·§9 표현)은 서버 TS에만 있다. 여기는 "기록"만 —
--   한 트랜잭션에서 사슬 연결(§8-5)·어뷰즈 상한·다중 insert의 원자성을 보장한다.
-- 호출 경로: 서버(service_role)의 lib/db 전용. PostgREST가 anon/authenticated 키로
--   호출하지 못하게 실행 권한을 회수한다(§8-4: 서버 경로만).

-- 세션 시작(첫 답변 시 호출): QR 재검증 → 일일 상한 → §8-5 사슬 연결 → insert.
-- qr 행 잠금(for update)으로 같은 QR의 동시 세션 생성을 직렬화해 상한 레이스를 없앤다.
create or replace function start_brew_session(p_code text, p_daily_cap int)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_qr        qr_code%rowtype;
  v_recipe_id uuid;
  v_prev      uuid;
  v_today     int;
  v_session   uuid;
begin
  select * into v_qr from qr_code where code = p_code for update;
  if not found then
    raise exception 'qr_not_available';
  end if;
  if v_qr.status <> 'active' then
    raise exception 'qr_not_available';
  end if;

  select id into v_recipe_id from recipe
    where bean_id = v_qr.bean_id and is_active;
  if not found then
    raise exception 'recipe_not_ready';
  end if;

  select count(*) into v_today from brew_session
    where qr_id = v_qr.id and started_at >= date_trunc('day', now());
  if v_today >= p_daily_cap then
    raise exception 'daily_session_cap';
  end if;

  -- §8-5 세션 사슬: 같은 QR의 최신 조정을 잇는다 (없으면 null = 사슬의 시작)
  select a.id into v_prev
    from adjustment a
    join brew_session s on s.id = a.session_id
    where s.qr_id = v_qr.id
    order by a.created_at desc
    limit 1;

  insert into brew_session (roaster_id, qr_id, recipe_id, prev_adjustment_id)
    values (v_qr.roaster_id, v_qr.id, v_recipe_id, v_prev)
    returning id into v_session;
  return v_session;
end
$$;

-- 피드백 기록(흐름 완료 시 호출): feedback + (조정이면) adjustment를 원자 insert.
-- roaster_id는 세션 행에서 도출한다 — 클라이언트 입력을 절대 믿지 않는다.
-- p_rule_source가 null이면 hold/chatbot(조정 없음), 아니면 adjustment 페이로드 필수.
create or replace function record_feedback(
  p_session_id       uuid,
  p_satisfaction     satisfaction,
  p_path             feedback_path,
  p_time_answer      time_deviation default null,
  p_taste_answer     taste default null,
  p_strength_answer  strength default null,
  p_grid_cell        text default null,
  p_temp_answer      temp_vs_recipe default null,
  p_intensity_answer taste_intensity default null,
  p_tree_leaf        text default null,
  p_rule_source      jsonb default null,
  p_moves            jsonb default null,
  p_before_snapshot  jsonb default null,
  p_after_snapshot   jsonb default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_session  brew_session%rowtype;
  v_feedback uuid;
  v_adjust   uuid;
begin
  select * into v_session from brew_session where id = p_session_id for update;
  if not found then
    raise exception 'session_not_found';
  end if;
  if exists (select 1 from feedback where session_id = p_session_id) then
    raise exception 'feedback_already_recorded';
  end if;

  insert into feedback (roaster_id, session_id, satisfaction, time_answer, path,
                        taste_answer, strength_answer, grid_cell,
                        temp_answer, intensity_answer, tree_leaf)
    values (v_session.roaster_id, p_session_id, p_satisfaction, p_time_answer, p_path,
            p_taste_answer, p_strength_answer, p_grid_cell,
            p_temp_answer, p_intensity_answer, p_tree_leaf)
    returning id into v_feedback;

  if p_rule_source is not null then
    if p_moves is null or p_before_snapshot is null or p_after_snapshot is null then
      raise exception 'adjustment_payload_incomplete';
    end if;
    insert into adjustment (roaster_id, session_id, feedback_id,
                            rule_source, moves, before_snapshot, after_snapshot)
      values (v_session.roaster_id, p_session_id, v_feedback,
              p_rule_source, p_moves, p_before_snapshot, p_after_snapshot)
      returning id into v_adjust;
  end if;

  return jsonb_build_object('feedback_id', v_feedback, 'adjustment_id', v_adjust);
end
$$;

-- 서버 경로만 허용: 함수는 기본적으로 PUBLIC 실행 가능이므로 명시적으로 회수한다.
revoke execute on function start_brew_session(text, int)
  from public, anon, authenticated;
revoke execute on function record_feedback(
  uuid, satisfaction, feedback_path, time_deviation, taste, strength, text,
  temp_vs_recipe, taste_intensity, text, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
