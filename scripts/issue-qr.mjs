// QR 발급 도구 — 봉지 스티커용 QR 코드를 실제 DB에 발급하고 인쇄 산출물을 만든다.
//
// 발급: node --env-file=.env.local scripts/issue-qr.mjs --bean <이름|uuid> --count N --base-url <url>
// 폐기: node --env-file=.env.local scripts/issue-qr.mjs --void <code> [--void <code> ...]
//       (코드가 '-'로 시작하면 --void=<code> 형식으로)
//
// 설계 메모(docs/NEXT.md Plan):
// - base-url은 매번 명시 필수 — URL은 인쇄되면 고정이라 env 기본값에 의한 오인쇄 사고 방지가 핵심.
// - 코드 N개를 한 트랜잭션으로 insert(unique 충돌 시 그 코드만 재생성).
// - 산출물은 out/qr/<원두>_<시각>/ (gitignore): codes.csv(발급 대장) + 코드별 PNG(오류정정 Q, 512px)
//   + 인쇄용 sheet.html(QR + 원두명·코드 끝4자 병기 — 사람이 봉지·대장을 대조할 수 있게).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import pg from "pg";
import QRCode from "qrcode";
import { newQrCode } from "./lib/qr-token.mjs";

const USAGE = `사용법:
  발급  node --env-file=.env.local scripts/issue-qr.mjs --bean <이름|uuid> --count N --base-url https://<도메인>
  폐기  node --env-file=.env.local scripts/issue-qr.mjs --void <code> [--void <code> ...]`;

const fail = (msg) => {
  console.error(`❌ ${msg}\n\n${USAGE}`);
  process.exit(1);
};

const { values } = parseArgs({
  options: {
    bean: { type: "string" },
    count: { type: "string" },
    "base-url": { type: "string" },
    void: { type: "string", multiple: true },
  },
});

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) fail("SUPABASE_DB_URL 필요 (.env.local)");

const c = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await c.connect();
try {
  if (values.void?.length) await voidCodes(values.void);
  else await issue();
} finally {
  await c.end();
}

// ── 폐기 모드 ─────────────────────────────────────────────────
async function voidCodes(codes) {
  if (values.bean || values.count || values["base-url"])
    fail("--void는 발급 옵션과 함께 쓸 수 없습니다");
  const rows = (await c.query(
    `select code, status from qr_code where code = any($1)`, [codes],
  )).rows;
  const byCode = new Map(rows.map((r) => [r.code, r.status]));
  const toVoid = codes.filter((code) => byCode.get(code) === "active");
  if (toVoid.length)
    await c.query(`update qr_code set status = 'void' where code = any($1)`, [toVoid]);
  for (const code of codes) {
    const status = byCode.get(code);
    if (status === undefined) console.log(`  ❌ ${code} — 존재하지 않는 코드`);
    else if (status === "void") console.log(`  ⏭️ ${code} — 이미 폐기됨`);
    else console.log(`  ✅ ${code} — 폐기 완료`);
  }
}

// ── 발급 모드 ─────────────────────────────────────────────────
async function issue() {
  if (!values.bean) fail("--bean <이름|uuid> 필요");
  if (!values.count) fail("--count N 필요");
  if (!values["base-url"]) fail("--base-url 필요 (인쇄되면 고정 — 매번 명시해서 오인쇄를 방지)");

  const count = Number(values.count);
  if (!Number.isInteger(count) || count < 1 || count > 500)
    fail(`--count는 1~500 정수여야 합니다 (입력: ${values.count})`);

  let baseUrl;
  try {
    baseUrl = new URL(values["base-url"]);
  } catch {
    fail(`--base-url이 URL이 아닙니다: ${values["base-url"]}`);
  }
  if (!/^https?:$/.test(baseUrl.protocol)) fail("--base-url은 http/https만 가능합니다");
  const urlBase = values["base-url"].replace(/\/+$/, "");
  if (/^(localhost|127\.|192\.168\.|10\.)/.test(baseUrl.hostname))
    console.warn(`⚠️ 테스트용 base-url입니다(${baseUrl.hostname}) — 실제 인쇄 배포에 쓰지 마세요.\n`);

  // 원두 해석: uuid면 id로, 아니면 이름 부분일치. 모호하면 후보를 나열하고 중단.
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(values.bean);
  const beans = (await c.query(
    isUuid
      ? `select b.id, b.name, b.status, b.roaster_id, r.name as roaster_name
           from bean b join roaster r on r.id = b.roaster_id where b.id = $1`
      : `select b.id, b.name, b.status, b.roaster_id, r.name as roaster_name
           from bean b join roaster r on r.id = b.roaster_id
          where b.name ilike '%' || $1 || '%' order by b.created_at`,
    [values.bean],
  )).rows;
  if (beans.length === 0) fail(`원두를 찾을 수 없습니다: ${values.bean}`);
  if (beans.length > 1) {
    console.error(`❌ 원두 이름이 모호합니다 (${beans.length}건). uuid로 다시 지정하세요:`);
    for (const b of beans) console.error(`   - ${b.name} [${b.roaster_name}] ${b.id}`);
    process.exit(1);
  }
  const bean = beans[0];
  if (bean.status !== "selling")
    console.warn(`⚠️ 이 원두는 판매 상태가 아닙니다(status=${bean.status}).`);

  const hasRecipe = (await c.query(
    `select 1 from recipe where bean_id = $1 and is_active`, [bean.id],
  )).rows.length > 0;
  if (!hasRecipe)
    console.warn("⚠️ 활성 레시피가 없습니다 — 스캔하면 '레시피 준비 중' 안내가 나갑니다.");

  // 한 트랜잭션 insert. unique 충돌은 on conflict do nothing으로 걸러 그 수만큼 재생성.
  const codes = [];
  await c.query("begin");
  try {
    let attempts = 0;
    while (codes.length < count) {
      if (++attempts > 10) throw new Error("코드 생성 재시도 초과(unique 충돌 반복) — 비정상 상황");
      const batch = Array.from({ length: count - codes.length }, newQrCode);
      const inserted = (await c.query(
        `insert into qr_code (roaster_id, bean_id, code)
         select $1, $2, code from unnest($3::text[]) as t(code)
         on conflict (code) do nothing returning code`,
        [bean.roaster_id, bean.id, batch],
      )).rows;
      codes.push(...inserted.map((r) => r.code));
    }
    await c.query("commit");
  } catch (e) {
    await c.query("rollback");
    throw e;
  }

  // 산출물 — DB 커밋 후 생성(파일 실패해도 codes.csv 내용은 콘솔로 복구 가능하게 먼저 출력 준비)
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const safeBean = bean.name.replace(/[^\w가-힣.-]+/g, "_").slice(0, 40);
  const outDir = join("out", "qr", `${safeBean}_${stamp}`);
  mkdirSync(outDir, { recursive: true });

  const rows = codes.map((code) => ({ code, url: `${urlBase}/r/${code}` }));

  // codes.csv — 발급 대장. BOM은 Excel 한글 표시용.
  const csv = "﻿code,url,bean,roaster,issued_at\n" + rows
    .map((r) => `${r.code},${r.url},"${bean.name}","${bean.roaster_name}",${now.toISOString()}`)
    .join("\n") + "\n";
  writeFileSync(join(outDir, "codes.csv"), csv);

  // 코드별 PNG(개별 스티커 인쇄·검수용) + sheet.html(한 장에 모아 인쇄)
  const cells = [];
  for (const r of rows) {
    await QRCode.toFile(join(outDir, `${r.code}.png`), r.url, {
      errorCorrectionLevel: "Q", width: 512, margin: 2,
    });
    const dataUrl = await QRCode.toDataURL(r.url, { errorCorrectionLevel: "Q", width: 512, margin: 2 });
    cells.push(
      `<div class="sticker"><img src="${dataUrl}" alt="${r.code}">` +
      `<div class="label"><div class="bean">${escapeHtml(bean.name)}</div>` +
      `<div class="tail">…${r.code.slice(-4)}</div></div></div>`,
    );
  }
  const sheet = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<title>QR 스티커 — ${escapeHtml(bean.name)} (${codes.length}장, ${stamp})</title>
<style>
  body { font-family: sans-serif; margin: 8mm; }
  header { font-size: 11px; color: #555; margin-bottom: 6mm; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, 40mm); gap: 4mm; }
  .sticker { width: 40mm; border: 0.2mm dashed #bbb; padding: 2mm; box-sizing: border-box;
             text-align: center; break-inside: avoid; }
  .sticker img { width: 100%; display: block; }
  .label { margin-top: 1mm; line-height: 1.25; }
  .bean { font-size: 8px; }
  .tail { font-size: 9px; font-family: monospace; color: #333; }
  @media print { header { display: none; } .sticker { border-color: #ddd; } }
</style></head><body>
<header>${escapeHtml(bean.name)} · ${escapeHtml(bean.roaster_name)} · ${codes.length}장 ·
 ${now.toISOString()} · base: ${escapeHtml(urlBase)} — 인쇄 전 URL을 반드시 확인하세요</header>
<div class="grid">
${cells.join("\n")}
</div></body></html>\n`;
  writeFileSync(join(outDir, "sheet.html"), sheet);

  console.log(`✅ ${codes.length}장 발급 완료 — ${bean.name} [${bean.roaster_name}]`);
  console.log(`   산출물: ${outDir} (codes.csv · PNG ${codes.length}개 · sheet.html)`);
  console.log(`   예시 URL: ${rows[0].url}`);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}
