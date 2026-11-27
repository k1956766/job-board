// 수집기: GitHub Actions(또는 집 PC)에서 실행 → 공고를 모아 Cloudflare KV에 저장
//   node collector/run.js            수집 간격이 됐을 때만 수집
//   node collector/run.js --force    바로 수집
// 환경 변수: CF_ACCOUNT_ID, CF_API_TOKEN, KV_NAMESPACE_ID (필수)
//            RUNNER (기록용 이름: github / home), SKIP_SOURCES (건너뛸 사이트, 쉼표), ONLY_SOURCES
import { kvGet, kvPut } from "./kv.js";
import { RUNNERS, fetchDetail, pause } from "./sites.js";
import { SOURCES, SOURCE_IDS, withDefaults, makeMatcher, isExcluded, kstToday, bodyUrl } from "../public/lib.js";

const DAY = 86400000;
const RUNNER = process.env.RUNNER || "github";
const FORCE = process.argv.includes("--force") || process.env.FORCE === "1" || process.env.FORCE === "true";
const list = (s) => (s || "").split(",").map((x) => x.trim()).filter(Boolean);
const SKIP = new Set(list(process.env.SKIP_SOURCES));
const ONLY = new Set(list(process.env.ONLY_SOURCES));
const DETAIL_PER_SITE = 40;   // 한 번에 본문을 확인할 공고 수 (사이트별)
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function main() {
  const now = Date.now();
  const settings = withDefaults(await kvGet("settings"));
  const status = (await kvGet("status")) || {};
  const request = await kvGet("request");
  const mine = status.byRunner?.[RUNNER] || {};   // 집 PC와 GitHub는 각자 간격·상태를 따로 셈
  const requested = request?.at && request.at > (mine.startedAt || 0);

  if (!FORCE && !requested) {
    const hours = settings.intervalHours || 6;
    const due = hours >= 24
      ? mine.lastDoneDate !== kstToday()
      : now - (mine.lastDoneAt || 0) >= hours * 3600000 - 10 * 60000;
    if (!due) { log(`아직 수집할 때가 아님 (간격 ${hours}시간)`); return; }
  }
  if (mine.collecting && now - (mine.startedAt || 0) < 40 * 60000 && !FORCE) {
    log("이전 수집이 아직 진행 중이라 건너뜀");
    return;
  }

  await kvPut("status", {
    ...status, collecting: true, startedAt: now, runner: RUNNER,
    byRunner: { ...(status.byRunner || {}), [RUNNER]: { ...mine, collecting: true, startedAt: now } },
  });
  const match = makeMatcher(settings.categories);
  const terms = Object.entries(settings.categories).flatMap(([cat, ts]) => ts.map((t) => [cat, t]));
  const enabled = SOURCES.filter((s) => settings.sources?.[s] !== false && !SKIP.has(s) && (!ONLY.size || ONLY.has(s)));
  log(`수집 시작: ${enabled.length}개 사이트, 검색어 ${terms.length}개 (${RUNNER})`);

  const results = {};
  await Promise.all(enabled.map(async (name) => {
    const t0 = Date.now();
    const key = `src:${SOURCE_IDS[name]}`;
    try {
      const prev = (await kvGet(key))?.items || {};
      let lastLog = 0;
      const progress = (text) => { if (Date.now() - lastLog > 60000) { lastLog = Date.now(); log(`${name}: ${text.replace(/^.*\((\d+\/\d+)\)$/, "$1")}`); } };
      const raw = await RUNNERS[name]({ terms, match, progress });
      const meta = raw.meta || {};   // 자소설닷컴: { dataAt: 받아 둔 자료 시점, warn }
      const found = raw.filter((x) => !isExcluded(x.title, settings.exclude));
      const ts = Date.now();
      const items = {};
      for (const it of found) {
        const p = prev[it.uid];
        it.categories = [...new Set([...(p?.categories || []), ...it.categories])].sort();
        it.firstSeenAt = p?.firstSeenAt || ts;
        it.lastSeenAt = ts;
        if (p?.detail) it.detail = p.detail;
        items[it.uid] = it;
      }
      // 이번에 안 보인 공고는 잠시 남겨 둠 (사이트 일시 오류 대비, 화면에서는 3일 뒤 빠짐)
      const today = kstToday();
      for (const [uid, p] of Object.entries(prev)) {
        if (items[uid]) continue;
        const expired = p.deadline && (Date.parse(today) - Date.parse(p.deadline)) / DAY > 7;
        if (!expired && ts - (p.lastSeenAt || 0) < 7 * DAY) items[uid] = p;
      }
      // 본문 확인: 아직 안 본 공고부터 (새로 올라온 순)
      const todo = found.filter((j) => !j.detail && (bodyUrl(j) || j.source === "링커리어"))
        .sort((a, b) => b.firstSeenAt - a.firstSeenAt).slice(0, DETAIL_PER_SITE);
      let checked = 0;
      for (const j of todo) {
        try { const d = await fetchDetail(j); if (d) { items[j.uid].detail = d; checked++; } } catch { /* 다음에 다시 */ }
        await pause();
      }
      await kvPut(key, { at: ts, runner: RUNNER, items });
      results[name] = { ok: true, n: found.length, checked, at: ts, runner: RUNNER, ...meta };
      log(`${name}: ${found.length}건, 본문 확인 ${checked}건 (${Math.round((Date.now() - t0) / 1000)}초)` +
        (meta.dataAt ? ` · 자료 ${new Date(meta.dataAt).toISOString()}` : "") + (meta.warn ? ` · 주의: ${meta.warn}` : ""));
    } catch (e) {
      results[name] = { ok: false, n: 0, error: String(e?.message || e).slice(0, 200), at: Date.now(), runner: RUNNER };
      log(`${name}: 실패 - ${results[name].error}`);
    }
  }));

  // 다른 곳(집 PC ↔ GitHub)에서 최근 성공한 기록은 이번 실패로 덮어쓰지 않음
  const latest = (await kvGet("status")) || status;
  const statuses = { ...(latest.statuses || {}) };
  for (const [name, r] of Object.entries(results)) {
    const p = statuses[name];
    if (!r.ok && p?.ok && p.runner !== RUNNER && Date.now() - (p.at || 0) < DAY) { statuses[name] = { ...p, otherFail: r.error }; continue; }
    statuses[name] = r;
  }
  const anyOk = Object.values(results).some((r) => r.ok);
  const me = { ...(latest.byRunner?.[RUNNER] || {}), collecting: false, startedAt: now,
    ...(anyOk ? { lastDoneAt: Date.now(), lastDoneDate: kstToday() } : {}) };
  const byRunner = { ...(latest.byRunner || {}), [RUNNER]: me };
  const others = Object.values(byRunner).filter((r) => r.collecting && Date.now() - (r.startedAt || 0) < 40 * 60000);
  await kvPut("status", {
    ...latest, statuses, byRunner, collecting: others.length > 0, startedAt: now, runner: RUNNER,
    ...(anyOk ? { lastDoneAt: Date.now(), lastDoneDate: kstToday(), runs: (latest.runs || 0) + 1 } : {}),
  });
  log(`끝: 성공 ${Object.values(results).filter((r) => r.ok).length} / ${enabled.length}`);
}

main().catch(async (e) => {
  console.error("수집기 오류:", e?.message || e);
  try {
    const s = (await kvGet("status")) || {};
    const byRunner = { ...(s.byRunner || {}), [RUNNER]: { ...(s.byRunner?.[RUNNER] || {}), collecting: false } };
    await kvPut("status", { ...s, byRunner, collecting: false, lastError: String(e?.message || e).slice(0, 200) });
  } catch { /* 무시 */ }
  process.exit(1);
});
