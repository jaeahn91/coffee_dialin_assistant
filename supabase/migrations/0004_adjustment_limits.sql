-- 0004_adjustment_limits.sql — 조정 경계 가드(ADR-003): 분쇄 반복 상한 검사용 읽기 함수
--
-- 이 QR 사슬의 최근 조정 moves(최신순 배열). 0002 start_brew_session·0003
-- latest_adjustment_for_qr와 같은 사슬 논리(qr 기준, created_at desc)를 공유한다 —
-- 가드가 보는 이력과 세션이 잇는 사슬이 반드시 같은 순서여야 한다.
create or replace function recent_moves_for_qr(p_qr_id uuid, p_limit int)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(t.moves order by t.created_at desc), '[]'::jsonb)
  from (
    select a.moves, a.created_at
    from adjustment a
    join brew_session s on s.id = a.session_id
    where s.qr_id = p_qr_id
    order by a.created_at desc
    limit p_limit
  ) t
$$;

revoke execute on function recent_moves_for_qr(uuid, int) from public, anon, authenticated;
