import {
  DEFAULT_SETTINGS, SOURCES, SOURCE_NOTES, REGIONS, buildCards, kstToday, daysBetween, withDefaults, NO_FRAME,
} from "./lib.js";
import { RESEARCH_GROUPS } from "./orgs.js";
import { suggest, snapshotOf } from "./similar.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const DAY = 86400000;
const PAGE = 150;  // 한 번에 그리는 카드 수
const INTERVALS = { 1: "1시간마다", 3: "3시간마다", 6: "6시간마다", 12: "12시간마다", 24: "하루 한 번" };
const ORG_LABEL = { public: "공공", org: "기관" };

// ---------------------------------------------------------------- 이 기기에만 저장 (NEW 기준 시각, 화면 상태)
const local = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } };
const setLocal = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 무시 */ } };
const newSince = local("lastViewedAt", 0);  // 이 화면을 열기 전 마지막으로 본 시각 (보는 동안 고정)
const ui = local("ui", {});
const saveUi = (patch) => { Object.assign(ui, patch); setLocal("ui", ui); };
const markViewed = () => { if (document.visibilityState === "visible" && data.loaded) setLocal("lastViewedAt", Date.now()); };

const state = {
  tab: "all", q: "", cats: new Set(), srcs: new Set(SOURCES), regions: new Set(), rgroups: new Set(),
  onlyNew: false, org: "", master: false, noForeign: false, hideSimple: !!ui.hideSimple, sort: ui.sort || "deadline", limit: PAGE,
};
let data = { loaded: false, settings: DEFAULT_SETTINGS, hidden: {}, favs: {}, status: {}, request: null, sources: {} };
let cards = [];
let shown = [];
let maybeList = [];

// ---------------------------------------------------------------- 서버
async function api(path, opts = {}) {
  const r = await fetch(`/api/${path}`, {
    ...opts, credentials: "same-origin",
    headers: opts.body ? { "Content-Type": "application/json" } : {},
  });
  if (r.redirected || (r.headers.get("content-type") || "").includes("text/html")) {
    throw new Error("로그인이 필요합니다. 새로고침해 주세요.");
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
const send = (path, method, body) => api(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

function toast(msg, ms = 2500) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, ms);
}
function offline(msg) {
  $("#offline").hidden = !msg;
  $("#offline").textContent = msg || "";
}

async function load() {
  try {
    const s = await api("state");
    data = {
      loaded: true, settings: withDefaults(s.settings), hidden: s.hidden || {}, favs: s.favs || {},
      status: s.status || {}, request: s.request, sources: s.sources || {},
    };
    offline("");
  } catch (e) {
    offline(`불러오지 못했습니다: ${e.message}`);
    return;
  }
  rebuild();
  markViewed();
}
function rebuild() {
  const jobs = {};
  for (const src of Object.values(data.sources)) Object.assign(jobs, src.items || {});
  cards = buildCards(jobs, newSince, data.settings);
  renderHeader();
  renderCats();
  renderHidden();
  render();
  if (!$("#settings").open) fillSettings();
}

// 수집 상태를 가볍게 확인하다가 바뀌면 전체를 다시 불러옴
let lastSig = "";
async function poll() {
  if (document.visibilityState !== "visible") return;
  try {
    const { status, request } = await api("status");
    offline("");
    const sig = `${status?.lastDoneAt}|${status?.collecting}|${status?.startedAt}`;
    if (lastSig && sig !== lastSig) await load();
    else if (request?.at !== data.request?.at) { data.request = request; renderHeader(); }
    lastSig = sig;
  } catch (e) { offline(`연결 확인 실패: ${e.message}`); }
}

const fmt = (ms) => new Date(ms).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });

// ---------------------------------------------------------------- 머리말
function renderHeader() {
  const m = data.status || {};
  const hours = data.settings.intervalHours || 6;
  $("#upd").textContent = m.lastDoneAt
    ? `마지막 수집 ${fmt(m.lastDoneAt)} · ${INTERVALS[hours] || `${hours}시간마다`} 자동 수집` +
      (newSince ? ` · NEW = ${fmt(newSince)} 이후 새로 올라온 공고` : "")
    : "아직 수집한 공고가 없습니다. 첫 수집은 10~20분쯤 걸립니다.";
  $("#status").innerHTML = SOURCES.filter((s) => data.settings.sources?.[s] !== false).map((k) => {
    const v = m.statuses?.[k];
    if (!v) return `<span>${esc(k)} 대기</span>`;
    const where = v.runner === "home" ? " (집 PC)" : "";
    return v.ok ? `<span title="${esc(fmt(v.at))}${where}">${esc(k)} ${v.n}건</span>`
      : `<b class="err" title="${esc(v.error)}">${esc(k)} 실패${where}</b>`;
  }).join(" · ");
  const busy = !!m.collecting && Date.now() - (m.startedAt || 0) < 60 * 60000;
  const waiting = !busy && data.request?.at && data.request.at > (m.startedAt || 0) && Date.now() - data.request.at < 2 * 3600000;
  $("#progress").hidden = !busy && !waiting;
  $("#progress").textContent = busy
    ? `수집 중입니다 (${fmt(m.startedAt)} 시작). 끝나면 자동으로 새로 고칩니다.`
    : waiting ? `수집을 요청했습니다 (${fmt(data.request.at)}). 곧 시작됩니다.` : "";
  $("#collect").disabled = busy || waiting;
  $("#collect").textContent = busy ? "수집 중…" : waiting ? "요청됨" : "지금 수집";
}

// ---------------------------------------------------------------- 필터
function chip(label, on, onClick) {
  const b = document.createElement("button");
  b.className = "chip" + (on ? " on" : "");
  b.textContent = label;
  b.onclick = () => { onClick(); b.classList.toggle("on"); state.limit = PAGE; render(); };
  return b;
}
const toggleIn = (set, v) => (set.has(v) ? set.delete(v) : set.add(v));

function renderCats() {
  const box = $("#cats");
  box.innerHTML = "";
  for (const c of Object.keys(data.settings.categories)) box.appendChild(chip(c, state.cats.has(c), () => toggleIn(state.cats, c)));
}
REGIONS.forEach((r) => $("#regions").appendChild(chip(r, false, () => toggleIn(state.regions, r))));
SOURCES.forEach((s) => $("#srcs").appendChild(chip(s, true, () => toggleIn(state.srcs, s))));
Object.keys(RESEARCH_GROUPS).forEach((g) => $("#rgroups").appendChild(chip(g, false, () => toggleIn(state.rgroups, g))));

const flag = (id, key, persist) => {
  const b = $(id);
  b.classList.toggle("on", !!state[key]);
  b.onclick = () => {
    state[key] = !state[key];
    b.classList.toggle("on", state[key]);
    if (persist) saveUi({ [key]: state[key] });
    state.limit = PAGE;
    render();
  };
};
flag("#onlyNew", "onlyNew");
flag("#master", "master");
flag("#noForeign", "noForeign");
flag("#hideSimple", "hideSimple", true);

document.querySelectorAll("[data-org]").forEach((b) => {
  b.onclick = () => {
    state.org = state.org === b.dataset.org ? "" : b.dataset.org;
    document.querySelectorAll("[data-org]").forEach((x) => x.classList.toggle("on", x.dataset.org === state.org));
    $("#rgRow").hidden = state.org !== "research";
    state.limit = PAGE;
    render();
  };
});
$("#q").oninput = (e) => { state.q = e.target.value.trim().toLowerCase(); state.limit = PAGE; render(); };
$("#sort").value = state.sort;
$("#sort").onchange = (e) => { state.sort = e.target.value; saveUi({ sort: state.sort }); render(); };
$("#moreBtn").onclick = () => { state.limit += PAGE; render(); };
$("#tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tab]");
  if (!b) return;
  state.tab = b.dataset.tab;
  document.querySelectorAll("#tabs [data-tab]").forEach((x) => x.classList.toggle("on", x === b));
  state.limit = PAGE;
  render();
});
$("#collect").onclick = async () => {
  $("#collect").disabled = true;
  try {
    const r = await send("collect", "POST");
    data.request = { at: r.at };
    renderHeader();
    toast(r.dispatched ? "수집을 시작했습니다. 10~20분쯤 걸립니다." : "수집을 요청했습니다. 다음 정기 실행(최대 1시간 안)에 수집합니다.", 4000);
  } catch (e) { toast(`요청 실패: ${e.message}`); $("#collect").disabled = false; }
};

function applyFilterFold(collapsed) {
  $("#filters").hidden = collapsed;
  $("#filterSummary").hidden = !collapsed;
  $("#toggleFilters").textContent = collapsed ? "필터 보이기 ▼" : "필터 숨기기 ▲";
  $("#toggleFilters").setAttribute("aria-expanded", String(!collapsed));
}
$("#toggleFilters").onclick = () => { const c = !$("#filters").hidden; applyFilterFold(c); saveUi({ filtersCollapsed: c }); updateSummary(); };
applyFilterFold(ui.filtersCollapsed ?? window.matchMedia("(max-width:640px)").matches);

function updateSummary() {
  const p = [];
  if (state.cats.size) p.push(`분야: ${[...state.cats].join(", ")}`);
  if (state.onlyNew) p.push("NEW만");
  if (state.org) p.push({ public: "공공기관만", private: "민간기업만", research: "공공 연구기관만" }[state.org] +
    (state.org === "research" && state.rgroups.size ? `(${[...state.rgroups].join(", ")})` : ""));
  if (state.master) p.push("석사 우대·이상");
  if (state.noForeign) p.push("외국계 제외");
  if (state.hideSimple) p.push("간단한 공고 숨김");
  if (state.regions.size) p.push(`지역: ${[...state.regions].join(", ")}`);
  if (state.srcs.size < SOURCES.length) p.push(`사이트 ${state.srcs.size}곳`);
  $("#filterSummary").textContent = p.length ? `적용 중 — ${p.join(" · ")}` : "적용 중인 필터 없음";
}

// ---------------------------------------------------------------- 목록
const favKeys = () => new Set(Object.values(data.favs).flatMap((f) => [f.key, ...(f.uids || [])]));
const isFav = (c, fk = favKeys()) => fk.has(c.key) || c.uids.some((u) => fk.has(u));
const hiddenActive = () => {
  const now = Date.now();
  return new Set(Object.entries(data.hidden).filter(([, v]) => !v.until || v.until > now).map(([k]) => k));
};

function passes(c, hiddenKeys, counts) {
  if (hiddenKeys.has(c.companyKey)) { counts.hidden++; return false; }
  if (data.settings.hideCareer3 && c.careerMin !== null && c.careerMin >= 3) { counts.career++; return false; }
  if (state.hideSimple && c.simple) { counts.simple++; return false; }
  return (!state.cats.size || c.cats.some((x) => state.cats.has(x))) &&
    c.links.some((l) => state.srcs.has(l.source)) &&
    (!state.onlyNew || c.isNew) &&
    (!state.org || (state.org === "research" ? !!c.research && (!state.rgroups.size || state.rgroups.has(c.research))
      : state.org === "public" ? c.orgType === "public" : c.orgType === "private")) &&
    (!state.master || c.edu === "master" || c.edu === "doctor") &&
    (!state.noForeign || !c.foreign) &&
    (!state.regions.size || c.regions.some((r) => state.regions.has(r))) &&
    (!state.q || [c.company, c.title, c.fields.join(" "), c.positions, c.regionText, c.info].join(" ").toLowerCase().includes(state.q));
}

const SORTS = {
  deadline: (a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999"),
  new: (a, b) => (b.firstSeenAt || 0) - (a.firstSeenAt || 0),
  big: (a, b) => (b.sizeTier + (b.research ? 0.5 : 0)) - (a.sizeTier + (a.research ? 0.5 : 0)) || SORTS.deadline(a, b),
};

function render() {
  const today = kstToday();
  const hiddenKeys = hiddenActive();
  const fk = favKeys();
  const counts = { hidden: 0, career: 0, simple: 0 };
  const visible = cards.filter((c) => passes(c, hiddenKeys, counts));

  // 찜 탭: 지금 목록에 있는 찜 + 목록에서 사라진(마감 등) 찜 요약
  const favCards = cards.filter((c) => isFav(c, fk));
  const liveKeys = new Set(favCards.flatMap((c) => [c.key, ...c.uids]));
  const goneFavs = Object.values(data.favs).filter((f) => !liveKeys.has(f.key) && !(f.uids || []).some((u) => liveKeys.has(u)));
  maybeList = suggest(Object.values(data.favs), visible, { exclude: (c) => isFav(c, fk) });
  const reasonOf = new Map(maybeList.map((x) => [x.card, x]));

  let list;
  if (state.tab === "fav") list = favCards.filter((c) => passesLoose(c));
  else if (state.tab === "maybe") list = maybeList.map((x) => x.card);
  else list = visible;
  if (state.tab !== "maybe") list = [...list].sort(SORTS[state.sort]);

  $("#nAll").textContent = visible.length;
  $("#nFav").textContent = Object.keys(data.favs).length || "";
  $("#nMaybe").textContent = maybeList.length || "";
  shown = list;
  const notes = [];
  if (counts.hidden) notes.push(`숨긴 기업 ${counts.hidden}`);
  if (counts.career) notes.push(`경력 3년↑ ${counts.career}`);
  if (counts.simple) notes.push(`간단한 공고 ${counts.simple}`);
  $("#count").textContent = `${list.length}건` + (state.tab === "all" && notes.length ? ` (${notes.join(", ")} 제외)` : "");
  updateSummary();

  const cardHtml = (c, i) => {
    const d = c.deadline ? daysBetween(today, c.deadline) : null;
    const dtxt = d === null ? (c.deadlineText || "상시") : d === 0 ? "D-Day" : `D-${d}`;
    const cond = [c.regionText, c.info].filter(Boolean).join(" · ");
    const field = c.fields.length ? c.fields.slice(0, 6).join(", ") + (c.fields.length > 6 ? " 외" : "") : "";
    const why = reasonOf.get(c);
    const badges = [
      ORG_LABEL[c.orgType] && !c.research ? `<span class="badge ${c.orgType}">${ORG_LABEL[c.orgType]}</span>` : "",
      c.research ? `<span class="badge res">${esc(c.research)}</span>` : "",
      c.sizeTier === 3 && !c.research ? `<span class="badge big">${esc(c.sizeLabel)}</span>` : "",
      c.foreign ? `<span class="badge">외국계</span>` : "",
      c.edu === "master" || c.edu === "doctor" ? `<span class="badge master">${c.edu === "master" ? "석사" : "박사"}</span>` : "",
      c.careerMin ? `<span class="badge">경력 ${c.careerMin}년↑</span>` : "",
      c.simple ? `<span class="badge simple" title="본문 ${c.detail.chars}자">간단</span>` : "",
    ].join("");
    return `<div class="card" data-i="${i}">
      <div class="co"><button class="star${isFav(c, fk) ? " on" : ""}" data-fav="${i}" aria-label="찜">${isFav(c, fk) ? "★" : "☆"}</button><button class="coname" data-i="${i}" title="이 기업 숨기기">${esc(c.company || "(기관명 없음)")}</button>${badges}</div>
      <div class="side"><span class="sidetop">${c.isNew ? '<span class="new">NEW</span>' : ""}<span class="dday ${d !== null && d <= 3 ? "soon" : ""}">${esc(dtxt)}</span></span>
        <span class="links">${c.links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.source)}</a>`).join("")}</span></div>
      <div class="ti">${esc(c.title)}</div>
      ${field ? `<div class="fieldline"><b>모집 분야</b>${esc(field)}</div>` : ""}
      ${cond ? `<div class="meta">${esc(cond)}</div>` : ""}
      ${why ? `<div class="why">비슷한 이유: ${esc(why.reasons.slice(0, 3).join(" · "))}</div>` : ""}
      <div class="tags">${c.cats.map((x) => `<span class="tag">${esc(x)}</span>`).join("")}${c.regions.filter((r) => r !== "지역 미상").map((r) => `<span class="rtag">${esc(r)}</span>`).join("")}${c.deadline ? `<span class="meta">~${esc(c.deadline.slice(5).replace("-", "."))}</span>` : ""}</div>
    </div>`;
  };

  let htmlOut = list.slice(0, state.limit).map(cardHtml).join("");
  if (state.tab === "fav" && goneFavs.length) {
    htmlOut += `<p class="sub" style="margin:14px 0 6px">목록에서 사라진 찜 (마감·삭제)</p>` + goneFavs.map((f) =>
      `<div class="card gone"><div class="co"><button class="star on" data-unfav="${esc(f.key)}" aria-label="찜 해제">★</button>${esc(f.company)}</div>
       <div class="side"><span class="dday">${esc(f.deadline ? `~${f.deadline.slice(5).replace("-", ".")}` : f.deadlineText || "")}</span>
       <span class="links">${(f.links || []).map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.source)}</a>`).join("")}</span></div>
       <div class="ti">${esc(f.title)}</div></div>`).join("");
  }
  const emptyMsg = state.tab === "fav" ? "찜한 공고가 없습니다. 공고 왼쪽의 ☆를 누르면 찜할 수 있습니다."
    : state.tab === "maybe" ? (Object.keys(data.favs).length ? "찜한 공고와 비슷한 공고가 아직 없습니다." : "찜을 하면 비슷한 공고를 여기에 모아 드립니다.")
    : data.status.collecting && !cards.length ? "첫 수집이 진행 중입니다. 끝나면 여기에 자동으로 나타납니다." : "조건에 맞는 공고가 없습니다.";
  $("#list").innerHTML = htmlOut || `<div class="empty">${emptyMsg}</div>`;
  $("#more").hidden = list.length <= state.limit;
  document.title = (() => { const n = cards.filter((c) => c.isNew && !hiddenKeys.has(c.companyKey)).length; return n ? `(${n}) 관심 채용공고` : "관심 채용공고"; })();
}
// 찜 탭은 숨김·조건 필터와 상관없이 모두 보여 줌 (검색어만 적용)
const passesLoose = (c) => !state.q || [c.company, c.title, c.fields.join(" ")].join(" ").toLowerCase().includes(state.q);

$("#list").addEventListener("click", (e) => {
  if (e.target.closest(".links a")) return;
  const star = e.target.closest("[data-fav]");
  if (star) { e.stopPropagation(); toggleFav(shown[+star.dataset.fav]); return; }
  const un = e.target.closest("[data-unfav]");
  if (un) { e.stopPropagation(); removeFav(un.dataset.unfav); return; }
  const co = e.target.closest(".coname");
  if (co) { e.stopPropagation(); openCoMenu(shown[+co.dataset.i], co); return; }
  const card = e.target.closest(".card[data-i]");
  if (card) openDetail(shown[+card.dataset.i]);
});

// ---------------------------------------------------------------- 찜
function favEntryOf(c) {
  return Object.values(data.favs).find((f) => f.key === c.key || c.uids.some((u) => (f.uids || []).includes(u)));
}
async function toggleFav(c) {
  const f = favEntryOf(c);
  if (f) return removeFav(f.key);
  const snap = snapshotOf(c);
  data.favs[snap.key] = snap;
  render();
  syncModalStar();
  try { data.favs = (await send("fav", "POST", snap)).favs; render(); }
  catch (e) { delete data.favs[snap.key]; render(); syncModalStar(); toast(`찜 저장 실패: ${e.message}`); }
}
async function removeFav(key) {
  const old = data.favs[key];
  delete data.favs[key];
  render();
  syncModalStar();
  try { data.favs = (await send(`fav?key=${encodeURIComponent(key)}`, "DELETE")).favs; render(); }
  catch (e) { if (old) data.favs[key] = old; render(); syncModalStar(); toast(`찜 해제 실패: ${e.message}`); }
}

// ---------------------------------------------------------------- 기업 숨기기
let menuCard = null;
function openCoMenu(card, anchor) {
  menuCard = card;
  $("#coMenuName").textContent = card.company;
  const r = anchor.getBoundingClientRect();
  const m = $("#coMenu");
  m.hidden = false;
  m.style.left = `${Math.max(8, Math.min(window.scrollX + r.left, window.scrollX + document.documentElement.clientWidth - m.offsetWidth - 8))}px`;
  m.style.top = `${window.scrollY + r.bottom + 6}px`;
}
const closeCoMenu = () => { $("#coMenu").hidden = true; menuCard = null; };
document.addEventListener("click", (e) => { if (!e.target.closest("#coMenu") && !e.target.closest(".coname")) closeCoMenu(); });
$("#coMenu").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-days]");
  if (!b || !menuCard) return;
  const days = +b.dataset.days;
  const c = menuCard;
  closeCoMenu();
  data.hidden[c.companyKey] = { name: c.company, until: days ? Date.now() + days * DAY : 0, at: Date.now() };
  renderHidden();
  render();
  toast(`「${c.company}」을(를) ${days ? `${days === 30 ? "1달" : `${days}일`} 동안` : "계속"} 숨겼습니다.`);
  try { data.hidden = (await send("hide", "POST", { key: c.companyKey, name: c.company, days })).hidden; renderHidden(); }
  catch (err) { delete data.hidden[c.companyKey]; renderHidden(); render(); toast(`숨기기 실패: ${err.message}`); }
});

function renderHidden() {
  const now = Date.now();
  const items = Object.entries(data.hidden).filter(([, v]) => !v.until || v.until > now).sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
  $("#hiddenN").textContent = items.length;
  $("#hiddenList").innerHTML = items.length
    ? items.map(([k, v]) => `<div class="hrow2"><span>${esc(v.name)}<span class="until">${v.until ? `${new Date(v.until).toLocaleDateString("ko-KR")}까지` : "계속 숨김"}</span></span>
        <button class="btn ghost small" data-unhide="${esc(k)}">다시 보기</button></div>`).join("") +
      (items.length > 1 ? `<div class="hrow2"><span></span><button class="btn small" data-unhide="*">모두 다시 보기</button></div>` : "")
    : `<p class="sub">숨긴 기업이 없습니다.</p>`;
}
$("#hiddenBtn").onclick = () => { $("#hiddenPanel").hidden = !$("#hiddenPanel").hidden; };
$("#hiddenList").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-unhide]");
  if (!b) return;
  const key = b.dataset.unhide;
  const old = { ...data.hidden };
  if (key === "*") data.hidden = {}; else delete data.hidden[key];
  renderHidden();
  render();
  try { data.hidden = (await send(`hide?key=${encodeURIComponent(key)}`, "DELETE")).hidden; renderHidden(); }
  catch (err) { data.hidden = old; renderHidden(); render(); toast(`다시 보기 실패: ${err.message}`); }
});

// ---------------------------------------------------------------- 공고 상세
let modalCard = null;
function openDetail(c) {
  closeCoMenu();
  modalCard = c;
  $("#mCo").innerHTML = `${esc(c.company)}${ORG_LABEL[c.orgType] ? ` <span class="badge ${c.orgType}">${ORG_LABEL[c.orgType]}</span>` : ""}${c.research ? ` <span class="badge res">${esc(c.research)}</span>` : ""}`;
  $("#mTitle").textContent = c.title;
  const d = c.deadline ? daysBetween(kstToday(), c.deadline) : null;
  const facts = [
    ["모집 분야", c.fields.join(", ")],
    ["모집 직무", c.positions],
    ["근무지", c.regionText || (c.regions[0] === "지역 미상" ? "" : c.regions.join(", "))],
    ["조건", c.info],
    ["경력", c.newbie ? "신입 가능" : c.careerMin ? `${c.careerMin}년 이상` : ""],
    ["학력", c.edu === "master" ? "석사 우대·이상" : c.edu === "doctor" ? "박사" : ""],
    ["규모", [c.sizeLabel, c.foreign ? "외국계" : ""].filter(Boolean).join(" · ")],
    ["마감", c.deadline ? `${c.deadline} (${d === 0 ? "D-Day" : `D-${d}`})` : (c.deadlineText || "상시")],
    ["관심 분야", c.cats.join(", ")],
    ["본문", c.detail ? `${c.detail.chars.toLocaleString()}자${c.detail.imgs ? `, 사진 ${c.detail.imgs}장` : ""}${c.simple ? " (간단한 공고)" : ""}` : ""],
  ].filter(([, v]) => v);
  $("#mFacts").innerHTML = facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("");
  const order = [...c.links].sort((a, b) => NO_FRAME.has(a.source) - NO_FRAME.has(b.source));
  $("#mTabs").innerHTML = order.map((l, i) => `<button class="chip${i === 0 ? " on" : ""}" data-k="${i}">${esc(l.source)}</button>`).join("");
  $("#mTabs").links = order;
  syncModalStar();
  $("#modal").hidden = false;
  document.body.style.overflow = "hidden";
  showSource(order[0]);
}
function showSource(l) {
  $("#mOpen").href = l.url;
  if (NO_FRAME.has(l.source)) {
    $("#mFrame").hidden = true;
    $("#mFrame").src = "about:blank";
    $("#mNoFrame").hidden = false;
    $("#mNoFrame").innerHTML = `${esc(l.source)}은(는) 공고 내용을 이 창 안에 보여 줄 수 없습니다.<br><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.source)}에서 열기 ↗</a>`;
    return;
  }
  $("#mNoFrame").hidden = true;
  $("#mFrame").hidden = false;
  $("#mFrame").src = `/api/source?${new URLSearchParams({ s: l.source, id: l.id || "", u: l.url })}`;
}
function syncModalStar() {
  if (!modalCard || $("#modal").hidden && !modalCard) return;
  const on = !!favEntryOf(modalCard);
  $("#mFav").textContent = on ? "★" : "☆";
  $("#mFav").classList.toggle("on", on);
}
$("#mFav").onclick = () => modalCard && toggleFav(modalCard);
$("#mTabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-k]");
  if (!b) return;
  $("#mTabs").querySelectorAll(".chip").forEach((x) => x.classList.toggle("on", x === b));
  showSource($("#mTabs").links[+b.dataset.k]);
});
function closeDetail() {
  $("#modal").hidden = true;
  $("#mFrame").src = "about:blank";
  document.body.style.overflow = "";
  modalCard = null;
}
$("#mClose").onclick = closeDetail;
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeDetail(); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { if (!$("#modal").hidden) closeDetail(); else closeCoMenu(); }
});

// ---------------------------------------------------------------- 설정
const toText = (cats) => Object.entries(cats).map(([k, v]) => `${k}: ${v.join(", ")}`).join("\n");
function fillSettings(s = data.settings) {
  $("#catsText").value = toText(s.categories);
  $("#exText").value = (s.exclude || []).join(", ");
  $("#interval").value = String(s.intervalHours || 6);
  $("#hideCareer3").checked = s.hideCareer3 !== false;
  $("#simpleMin").value = s.simpleMinChars || 150;
  $("#srcSet").innerHTML = SOURCES.map((x) => `<label class="chk" title="${esc(SOURCE_NOTES[x] || "")}">
    <input type="checkbox" value="${esc(x)}" ${s.sources?.[x] === false ? "" : "checked"}> ${esc(x)}
    <span class="note">${esc(SOURCE_NOTES[x] || "")}</span></label>`).join("");
}
$("#save").onclick = async () => {
  const categories = {};
  for (const line of $("#catsText").value.split("\n")) {
    const i = line.indexOf(":");
    if (i < 1) continue;
    const terms = line.slice(i + 1).split(",").map((t) => t.trim()).filter(Boolean);
    if (terms.length) categories[line.slice(0, i).trim()] = terms;
  }
  if (!Object.keys(categories).length) { $("#saved").textContent = "분야가 하나도 없어 저장하지 않았습니다."; return; }
  const sources = Object.fromEntries([...document.querySelectorAll("#srcSet input")].map((c) => [c.value, c.checked]));
  if (!Object.values(sources).some(Boolean)) { $("#saved").textContent = "사이트를 하나 이상 선택하세요."; return; }
  const settings = {
    categories, sources,
    exclude: $("#exText").value.split(",").map((t) => t.trim()).filter(Boolean),
    intervalHours: +$("#interval").value || 6,
    hideCareer3: $("#hideCareer3").checked,
    simpleMinChars: Math.max(50, Math.min(1000, +$("#simpleMin").value || 150)),
  };
  try {
    await send("settings", "PUT", settings);
    data.settings = withDefaults(settings);
    rebuild();
    $("#saved").textContent = `저장했습니다 (분야 ${Object.keys(categories).length}개, ${INTERVALS[settings.intervalHours]} 수집).`;
  } catch (e) { $("#saved").textContent = `저장 실패: ${e.message}`; }
};
$("#reset").onclick = () => { fillSettings(withDefaults(null)); $("#saved").textContent = "기본값을 불러왔습니다. 저장을 눌러야 적용됩니다."; };

// ---------------------------------------------------------------- 시작
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") poll(); markViewed(); });
window.addEventListener("pagehide", markViewed);
setInterval(poll, 60000);
await load();
lastSig = `${data.status?.lastDoneAt}|${data.status?.collecting}|${data.status?.startedAt}`;
