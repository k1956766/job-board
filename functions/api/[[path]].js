// 사이트 API (Cloudflare Pages Functions). 저장소: KV 바인딩 이름 JOBS
//   GET  /api/state      화면에 필요한 모든 데이터
//   GET  /api/status     수집 상태만 (가볍게 자주 확인)
//   PUT  /api/settings   설정 저장
//   POST /api/hide       기업 숨기기 {key, name, days}     DELETE /api/hide?key=… (key=* 전체)
//   POST /api/fav        찜 {key, …요약}                    DELETE /api/fav?key=…
//   POST /api/collect    지금 수집 요청
//   GET  /api/source     공고 원문 보기용 중계 (?s=사이트&id=번호&u=주소)
import { SOURCES, SOURCE_IDS, bodyUrl } from "../../public/lib.js";

const DAY = 86400000;
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});
const get = async (env, key, fallback) => (await env.JOBS.get(key, "json")) ?? fallback;
const put = (env, key, value) => env.JOBS.put(key, JSON.stringify(value));

export async function onRequest(ctx) {
  const { request, env } = ctx;
  if (!env.JOBS) return json({ error: "KV 바인딩(JOBS)이 연결되지 않았습니다. Cloudflare Pages 설정에서 연결하세요." }, 500);

  // 이중 잠금: Cloudflare Access가 알려주는 로그인 이메일이 허용 목록에 있어야 함 (ALLOWED_EMAILS를 설정한 경우)
  if (env.ALLOWED_EMAILS) {
    const who = (request.headers.get("cf-access-authenticated-user-email") || "").toLowerCase();
    const ok = env.ALLOWED_EMAILS.toLowerCase().split(/[,\s]+/).filter(Boolean);
    if (!ok.includes(who)) return json({ error: "접근 권한이 없습니다" }, 403);
  }

  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  const m = request.method;
  try {
    if (path === "state" && m === "GET") return state(env);
    if (path === "status" && m === "GET") {
      const [status, request_] = await Promise.all([get(env, "status", {}), get(env, "request", null)]);
      return json({ status, request: request_ });
    }
    if (path === "settings" && m === "PUT") {
      const s = await request.json();
      if (!s || typeof s !== "object" || !s.categories) return json({ error: "잘못된 설정" }, 400);
      await put(env, "settings", s);
      return json({ ok: true });
    }
    if (path === "hide") {
      const hidden = pruneHidden(await get(env, "hidden", {}));
      if (m === "POST") {
        const { key, name, days } = await request.json();
        if (!key) return json({ error: "key 없음" }, 400);
        hidden[key] = { name: String(name || key).slice(0, 80), until: days ? Date.now() + days * DAY : 0, at: Date.now() };
      } else if (m === "DELETE") {
        const key = url.searchParams.get("key");
        if (key === "*") for (const k of Object.keys(hidden)) delete hidden[k];
        else delete hidden[key];
      } else return json({ error: "지원하지 않는 요청" }, 405);
      await put(env, "hidden", hidden);
      return json({ hidden });
    }
    if (path === "fav") {
      const favs = await get(env, "favs", {});
      if (m === "POST") {
        const snap = await request.json();
        if (!snap?.key) return json({ error: "key 없음" }, 400);
        favs[snap.key] = { ...snap, at: Date.now() };
      } else if (m === "DELETE") delete favs[url.searchParams.get("key")];
      else return json({ error: "지원하지 않는 요청" }, 405);
      await put(env, "favs", favs);
      return json({ favs });
    }
    if (path === "collect" && m === "POST") return json(await requestCollect(env));
    if (path === "source" && m === "GET") return source(url, env);
    return json({ error: "없는 주소" }, 404);
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
}

function pruneHidden(h) {
  const now = Date.now();
  return Object.fromEntries(Object.entries(h || {}).filter(([, v]) => !v.until || v.until > now));
}

// 공고 데이터는 크기가 커서(수 MB) 해석하지 않고 글자 그대로 이어 붙여 보냄 (무료 요금제 CPU 시간 절약)
async function state(env) {
  const [settings, hidden, favs, status, req, ...srcs] = await Promise.all([
    env.JOBS.get("settings"), get(env, "hidden", {}), env.JOBS.get("favs"), env.JOBS.get("status"), env.JOBS.get("request"),
    ...SOURCES.map((s) => env.JOBS.get(`src:${SOURCE_IDS[s]}`)),
  ]);
  const parts = SOURCES.map((s, i) => (srcs[i] ? `${JSON.stringify(s)}:${srcs[i]}` : "")).filter(Boolean);
  const body = `{"settings":${settings || "null"},"hidden":${JSON.stringify(pruneHidden(hidden))},"favs":${favs || "{}"},` +
    `"status":${status || "{}"},"request":${req || "null"},"now":${Date.now()},"sources":{${parts.join(",")}}}`;
  return new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

// 지금 수집: 요청 시각을 남기고(다음 정기 실행 때 바로 수집), GitHub 토큰이 있으면 바로 실행
async function requestCollect(env) {
  const at = Date.now();
  await put(env, "request", { at });
  if (!env.GH_TOKEN || !env.GH_REPO) return { ok: true, at, dispatched: false };
  const r = await fetch(`https://api.github.com/repos/${env.GH_REPO}/actions/workflows/collect.yml/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GH_TOKEN}`, Accept: "application/vnd.github+json",
      "User-Agent": "job-board", "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ ref: env.GH_BRANCH || "main", inputs: { force: "true" } }),
  });
  return { ok: true, at, dispatched: r.ok, ghStatus: r.status };
}

// ---------------------------------------------------------------- 원문 중계
// 원문 사이트는 다른 페이지 안에 표시되는 것을 막아 두는 경우가 많아, 본문 페이지를 받아 스크립트 없이 보여 줌
const ALLOWED = ["saramin.co.kr", "jobkorea.co.kr", "incruit.com", "linkareer.com", "alio.go.kr", "cleaneye.go.kr", "hibrain.net", "catch.co.kr", "jasoseol.com"];
const allowedHost = (h) => ALLOWED.some((d) => h === d || h.endsWith("." + d));
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const PAGE_HEADERS = (charset) => ({
  "Content-Type": `text/html; charset=${charset}`,
  "Content-Security-Policy": "script-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "private, max-age=600",
  "Referrer-Policy": "no-referrer",
});
const STYLE = `<style>body{font:14px/1.6 "Pretendard","Apple SD Gothic Neo","Malgun Gothic",sans-serif;max-width:900px;margin:0 auto;padding:12px;word-break:keep-all;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}</style>`;

async function source(url, env) {
  const s = url.searchParams.get("s") || "";
  const id = url.searchParams.get("id") || "";
  const u = url.searchParams.get("u") || "";
  if (s === "링커리어" && /^\d+$/.test(id)) {
    const r = await fetch("https://api.linkareer.com/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://linkareer.com", Referer: "https://linkareer.com/", "User-Agent": UA },
      body: JSON.stringify({ query: `{ activity(id:"${id}"){ title organizationName detailText{ text } } }` }),
    });
    const a = (await r.json())?.data?.activity;
    if (!a) return notice("공고 내용을 불러오지 못했습니다.", u);
    const body = `<!doctype html><html><head><meta charset="utf-8"><base href="https://linkareer.com/" target="_blank">${STYLE}</head><body><h2>${esc(a.title)}</h2><p>${esc(a.organizationName)}</p>${a.detailText?.text || ""}</body></html>`;
    return new Response(body, { headers: PAGE_HEADERS("utf-8") });
  }
  let target = bodyUrl({ source: s, sourceId: id, url: u }) || u;
  let host;
  try { host = new URL(target).hostname; } catch { return notice("주소가 올바르지 않습니다.", u); }
  if (!allowedHost(host)) return notice("허용되지 않은 주소입니다.", "");
  const r = await fetch(target, { headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9", Referer: `https://${host}/` }, redirect: "follow" });
  if (!r.ok) return notice(`원문 사이트가 응답하지 않았습니다 (HTTP ${r.status}).`, u);
  const bytes = new Uint8Array(await r.arrayBuffer());
  // 글자 인코딩: 응답 헤더 → 문서 앞부분의 meta
  let cs = (/charset=([\w-]+)/i.exec(r.headers.get("content-type") || "") || [])[1];
  if (!cs) {
    const head = String.fromCharCode(...bytes.subarray(0, Math.min(4000, bytes.length)));
    cs = (/<meta[^>]+charset=["']?([\w-]+)/i.exec(head) || [])[1];
  }
  cs = (cs || "utf-8").toLowerCase();
  if (cs === "ks_c_5601-1987" || cs === "cp949") cs = "euc-kr";
  const prefix = new TextEncoder().encode(`<base href="${esc(r.url || target)}" target="_blank">${STYLE}`);
  const out = new Uint8Array(prefix.length + bytes.length);
  out.set(prefix, 0);
  out.set(bytes, prefix.length);
  return new Response(out, { headers: PAGE_HEADERS(cs) });
}

function notice(msg, u) {
  const link = u && /^https:\/\//.test(u) ? `<p><a href="${esc(u)}" target="_blank" rel="noopener">원문 사이트에서 열기 ↗</a></p>` : "";
  return new Response(`<!doctype html><meta charset="utf-8">${STYLE}<p>${esc(msg)}</p>${link}`, { headers: PAGE_HEADERS("utf-8") });
}
