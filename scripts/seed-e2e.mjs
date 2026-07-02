// 시드 + E2E 실주행: node --env-file=.env.local scripts/seed-e2e.mjs
// - 시드: 테스트 로스터/원두/레시피(재사용) + 매 실행마다 새 QR(새 사슬 → 단정 결정적)
// - E2E: 0002 RPC를 실제로 주행하며 §8-5 사슬·상한·중복 방지·복합 FK 테넌트 차단을 검증.
//   payload 값은 lib/server/derive 단위 테스트가 검증한 도출 결과를 그대로 미러링한다.
import { randomBytes } from "node:crypto";
import pg from "pg";

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL 필요 (.env.local)");

// QR 토큰 규격(보안 리뷰 결정): crypto 기반 base64url 21자(≈126비트)
const newQrCode = () => randomBytes(16).toString("base64url").slice(0, 21);

let failed = 0;
const check = (cond, label) => {
  console.log(`${cond ? "  ✅" : "  ❌"} ${label}`);
  if (!cond) failed++;
};
const expectError = async (label, promise, needle) => {
  try {
    await promise;
    check(false, `${label} — 에러가 나야 하는데 성공함`);
  } catch (e) {
    check(e.message.includes(needle), `${label} (${needle})`);
  }
};

const c = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await c.connect();
try {
  // ── 시드 (재사용 가능) ──────────────────────────────────
  console.log("시드:");
  const roaster = (await c.query(
    `insert into roaster (name) values ('시드 테스트 로스터리')
     on conflict do nothing returning id`,
  )).rows[0]?.id ?? (await c.query(
    `select id from roaster where name = '시드 테스트 로스터리'`,
  )).rows[0].id;

  let bean = (await c.query(
    `select id from bean where roaster_id = $1 and name = '에티오피아 예가체프 G1(시드)'`,
    [roaster],
  )).rows[0]?.id;
  if (!bean) {
    bean = (await c.query(
      `insert into bean (roaster_id, name, intro) values ($1, '에티오피아 예가체프 G1(시드)',
        '테스트용 시드 데이터입니다. 파일럿 시작 전 삭제하세요.') returning id`,
      [roaster],
    )).rows[0].id;
  }

  let recipe = (await c.query(
    `select id from recipe where bean_id = $1 and is_active`, [bean],
  )).rows[0]?.id;
  if (!recipe) {
    recipe = (await c.query(
      `insert into recipe (roaster_id, bean_id, version, dripper, dose_g, water_g,
        water_temp_c, brew_time_min_s, brew_time_max_s, grind_text)
       values ($1, $2, 1, 'V60', 15, 250, 92, 150, 180, '코만단테 22클릭') returning id`,
      [roaster, bean],
    )).rows[0].id;
  }

  const code = newQrCode();
  const qr = (await c.query(
    `insert into qr_code (roaster_id, bean_id, code) values ($1, $2, $3) returning id`,
    [roaster, bean, code],
  )).rows[0].id;
  console.log(`  roaster/bean/recipe 준비 완료, 새 QR 발급: /r/${code}`);

  // ── E2E: RPC 실주행 ─────────────────────────────────────
  console.log("E2E:");

  // 1. 세션 시작 — 새 사슬이므로 prev는 null
  const s1 = (await c.query(`select start_brew_session($1, 30) as id`, [code])).rows[0].id;
  const s1row = (await c.query(`select * from brew_session where id = $1`, [s1])).rows[0];
  check(s1row.prev_adjustment_id === null, "세션1: 사슬 시작(prev null)");
  check(s1row.roaster_id === roaster && s1row.qr_id === qr && s1row.recipe_id === recipe,
    "세션1: roaster/qr/recipe 연결 정확");

  // 2. 격자 경로 피드백 (okay → sour/strong): derive 단위테스트 미러
  const gridArgs = {
    rule_source: { path: "grid", cell: "sour/strong" },
    moves: [
      { variable: "grind", direction: "finer", magnitude: "standard" },
      { variable: "water", direction: "more", magnitude: "standard" },
    ],
    before: { dose_g: 15, water_g: 250, water_temp_c: 92, grind_text: "코만단테 22클릭" },
    after: { dose_g: 15, water_g: 260, water_temp_c: 92, grind_text: "코만단테 22클릭" },
  };
  const r1 = (await c.query(
    `select record_feedback($1, 'okay', 'grid', null, 'sour', 'strong', 'sour/strong',
       null, null, null, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb) as r`,
    [s1, JSON.stringify(gridArgs.rule_source), JSON.stringify(gridArgs.moves),
     JSON.stringify(gridArgs.before), JSON.stringify(gridArgs.after)],
  )).rows[0].r;
  check(!!r1.feedback_id && !!r1.adjustment_id, "피드백1: feedback+adjustment 원자 기록");
  const adj1 = (await c.query(`select * from adjustment where id = $1`, [r1.adjustment_id])).rows[0];
  check(adj1.after_snapshot.water_g === 260, "조정1: after_snapshot 물 250→260");

  // 3. 두 번째 세션 — §8-5 사슬이 조정1을 가리켜야 함
  const s2 = (await c.query(`select start_brew_session($1, 30) as id`, [code])).rows[0].id;
  const s2prev = (await c.query(`select prev_adjustment_id from brew_session where id = $1`, [s2]))
    .rows[0].prev_adjustment_id;
  check(s2prev === r1.adjustment_id, "세션2: 사슬이 직전 조정을 연결");

  // 4. 즉답 경로(good → hold): adjustment 없이 feedback만
  const r2 = (await c.query(
    `select record_feedback($1, 'good', 'immediate') as r`, [s2],
  )).rows[0].r;
  check(!!r2.feedback_id && r2.adjustment_id === null, "피드백2: hold는 feedback만(조정 없음)");

  // 5. 같은 세션 중복 기록 차단
  await expectError("중복 기록 차단",
    c.query(`select record_feedback($1, 'good', 'immediate')`, [s2]),
    "feedback_already_recorded");

  // 6. 세션3(미응답 이탈 시뮬레이션 — 퍼널 중간 단계로 남긴다)
  const s3 = (await c.query(`select start_brew_session($1, 30) as id`, [code])).rows[0].id;

  // 7. 일일 상한: 오늘 3세션 → cap 3이면 거절
  await expectError("일일 세션 상한",
    c.query(`select start_brew_session($1, 3)`, [code]),
    "daily_session_cap");

  // 8. 없는/폐기 코드
  await expectError("미존재 코드 거절",
    c.query(`select start_brew_session('no-such-code-000000000', 30)`),
    "qr_not_available");

  // 9. 복합 FK 테넌트 차단: 다른 로스터의 roaster_id로 세션3에 피드백 시도 → FK 위반
  const intruder = (await c.query(
    `insert into roaster (name) values ('침입자 로스터리(테스트)') returning id`,
  )).rows[0].id;
  await expectError("교차 테넌트 참조 차단(복합 FK)",
    c.query(
      `insert into feedback (roaster_id, session_id, satisfaction, path)
       values ($1, $2, 'good', 'immediate')`, [intruder, s3]),
    "foreign key");
  await c.query(`delete from roaster where id = $1`, [intruder]);

  // ── 퍼널 스냅샷 ─────────────────────────────────────────
  const funnel = (await c.query(
    `select
       (select count(*) from page_view    where qr_id = $1) as views,
       (select count(*) from brew_session where qr_id = $1) as sessions,
       (select count(*) from feedback f join brew_session s on s.id = f.session_id
         where s.qr_id = $1) as feedbacks`, [qr],
  )).rows[0];
  console.log(`퍼널(이 QR): 조회 ${funnel.views} → 세션 ${funnel.sessions} → 완주 ${funnel.feedbacks}`);
  console.log(failed === 0 ? "\n전체 통과 ✅" : `\n실패 ${failed}건 ❌`);
  console.log(`브라우저 테스트 URL: http://localhost:3000/r/${code}`);
  process.exitCode = failed === 0 ? 0 : 1;
} finally {
  await c.end();
}
