// 사이트별 수집 (사이트끼리는 동시에, 같은 사이트 안에서는 1.2~2.5초 간격으로 천천히)
import { parseHTML } from "linkedom";
import {
  makeJob, toKstDate, parseIncruit, parseSaramin, parseJobkorea, parseAlio, parseHibrain, linkareerJob, cleaneyeJob,
  JASOSEOL_DUTY_GROUPS, MAX_PAGES, JASOSEOL_DAYS_AHEAD, kstToday, bodyUrl,
} from "../public/lib.js";
import { measureContent, parseEdu, eduFromCode } from "../public/orgs.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const pause = () => sleep(1200 + Math.random() * 1300);

export function html(text) {
  const t = /<html[\s>]/i.test(text) ? text : `<!doctype html><html><body>${text}</body></html>`;
  return parseHTML(t).document;
}

// 사이트마다 그 사이트에서 직접 연 것처럼 출처 헤더를 붙임
const SITES = [
  ["jasoseol.com", "https://jasoseol.com", "https://jasoseol.com/recruit"],
  ["catch.co.kr", "https://www.catch.co.kr", "https://www.catch.co.kr/NCS/RecruitSearch"],
  ["incruit.com", "https://www.incruit.com", "https://www.incruit.com/"],
  ["saramin.co.kr", "https://www.saramin.co.kr", "https://www.saramin.co.kr/zf_user/search/recruit"],
  ["jobkorea.co.kr", "https://www.jobkorea.co.kr", "https://www.jobkorea.co.kr/Search/"],
  ["linkareer.com", "https://linkareer.com", "https://linkareer.com/list/recruit"],
  ["alio.go.kr", "https://job.alio.go.kr", "https://job.alio.go.kr/recruit.do"],
  ["cleaneye.go.kr", "https://job.cleaneye.go.kr", "https://job.cleaneye.go.kr/user/ypRecruitment.do"],
  ["hibrain.net", "https://www.hibrain.net", "https://www.hibrain.net/recruitment"],
];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const jar = new Map();  // 사이트별 쿠키

export async function siteFetch(url, opts = {}) {
  const host = new URL(url).hostname;
  const site = SITES.find(([d]) => host === d || host.endsWith("." + d));
  const headers = { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.5", Accept: "text/html,application/json;q=0.9,*/*;q=0.8", ...(opts.headers || {}) };
  if (site) {
    headers.Referer = site[2];
    if ((opts.method || "GET") !== "GET") headers.Origin = site[1];
    const c = jar.get(site[0]);
    if (c) headers.Cookie = [...c].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  const r = await fetch(url, { ...opts, headers, signal: AbortSignal.timeout(30000) });
  if (site) {
    const set = r.headers.getSetCookie?.() || [];
    if (set.length) {
      const c = jar.get(site[0]) || new Map();
      for (const s of set) { const [kv] = s.split(";"); const i = kv.indexOf("="); if (i > 0) c.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); }
      jar.set(site[0], c);
    }
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r;
}

// 글자 인코딩(EUC-KR 등)을 맞춰 읽기
export async function readText(res) {
  const buf = Buffer.from(await res.arrayBuffer());
  let cs = (/charset=([\w-]+)/i.exec(res.headers.get("content-type") || "") || [])[1];
  if (!cs) cs = (/<meta[^>]+charset=["']?([\w-]+)/i.exec(buf.subarray(0, 3000).toString("latin1")) || [])[1];
  cs = (cs || "utf-8").toLowerCase();
  if (cs === "ks_c_5601-1987" || cs === "cp949") cs = "euc-kr";
  try { return new TextDecoder(cs).decode(buf); } catch { return buf.toString("utf8"); }
}

function addOrMerge(found, item, cats) {
  const prev = found.get(item.uid);
  const add = [].concat(cats);
  if (prev) prev.categories = [...new Set([...prev.categories, ...add])].sort();
  else { item.categories = [...new Set([...item.categories, ...add])].sort(); found.set(item.uid, item); }
}

// 검색어마다 사이트 검색
async function bySearch({ terms, progress, label, pageSize, fetchPage }) {
  const found = new Map();
  let parsedAny = false, errors = 0, lastErr = null;
  for (let i = 0; i < terms.length; i++) {
    const [cat, term] = terms[i];
    progress(`${term} (${i + 1}/${terms.length})`);
    for (let page = 1; page <= MAX_PAGES; page++) {
      let items;
      try { items = await fetchPage(term, page); }
      catch (e) { errors++; lastErr = e; if (errors >= 5 && !parsedAny) throw e; await pause(); break; }
      await pause();
      if (items === null) throw new Error("화면 구조가 바뀐 것 같습니다");
      if (items.length) parsedAny = true;
      items.forEach((it) => addOrMerge(found, it, cat));
      if (items.length < pageSize) break;
    }
  }
  if (!parsedAny) throw new Error(lastErr ? String(lastErr.message || lastErr) : `${label}: 검색 결과를 하나도 읽지 못했습니다`);
  return [...found.values()];
}

// 전체 목록에서 제목·기관명에 관심 검색어가 있는 것만
function pick(items, match, extraText = () => "") {
  const out = [];
  for (const it of items) {
    const cats = match(`${it.company} ${it.title} ${extraText(it)}`);
    if (cats.length) { it.categories = cats; out.push(it); }
  }
  return out;
}

// ---------------------------------------------------------------- 사이트별
const fetchSaramin = ({ terms, progress }) => bySearch({
  terms, progress, label: "사람인", pageSize: 40,
  fetchPage: async (term, page) => parseSaramin(html(await readText(await siteFetch(
    `https://www.saramin.co.kr/zf_user/search/recruit?searchword=${encodeURIComponent(term)}&recruitPage=${page}&recruitPageCount=40`)))),
});

const fetchJobkorea = ({ terms, progress }) => bySearch({
  terms, progress, label: "잡코리아", pageSize: 20,
  fetchPage: async (term, page) => parseJobkorea(await readText(await siteFetch(
    `https://www.jobkorea.co.kr/Search/?stext=${encodeURIComponent(term)}&tabType=recruit&Page_No=${page}`))),
});

const fetchIncruit = ({ terms, progress }) => bySearch({
  terms, progress, label: "인크루트", pageSize: 30,
  fetchPage: async (term, page) => {
    return parseIncruit(html(await readText(await siteFetch(
      `https://search.incruit.com/list/search.asp?col=job&kw=${encodeURIComponent(term)}&startno=${(page - 1) * 30}`))));
  },
});

const CATCH_EDU = { 6: "master", 7: "doctor" };
const fetchCatch = ({ terms, progress }) => bySearch({
  terms, progress, label: "캐치", pageSize: 30,
  fetchPage: async (term, page) => {
    const p = new URLSearchParams({
      Keyword: term, JobCode: "", Sido: "", Career: "", JCode: "", Size: "", EduLevel: "",
      WorkPosition: "", CompID: "", GroupCode: "", Sort: "0", curpage: String(page),
      pageSize: "30", onRecruitYN: "Y", ExceptIDList: "",
    });
    const data = await (await siteFetch(`https://www.catch.co.kr/api/v1.0/recruit/information/getRecruitList?${p}`,
      { headers: { Accept: "application/json" } })).json();
    return (data.recruitData || []).filter((x) => x.RecruitID).map((x) => makeJob({
      source: "캐치", id: x.RecruitID, company: x.CompName, title: x.RecruitTitle,
      url: `https://www.catch.co.kr/NCS/RecruitInfoDetails/${x.RecruitID}`,
      deadline: toKstDate(x.ApplyEndDatetime), deadlineText: x.ApplyEndCode || "",
      region: x.WorkArea || "",
      info: [x.CareerGubunCode, x.GubunCode, x.ExperienceRange].filter(Boolean).join(" · "),
      career: [x.CareerGubunCode, x.ExperienceRange].filter(Boolean).join(" "),
      edu: CATCH_EDU[x.EduLevelCode] || eduFromCode(x.EduLevelCode) || parseEdu(x.EduLevelName || ""),
      field: x.Depth || x.AssignedTaskNameListString || "",
      isPublic: x.PopularCategory === "공공기관",
      size: x.GroupName ? 3 : /대기업|공기업/.test(x.PopularCategory || "") ? 3 : /중견/.test(x.PopularCategory || "") ? 2 : 0,
      foreign: /외국계/.test(x.PopularCategory || ""),
    }));
  },
});

async function fetchJasoseol({ match, progress }) {
  progress("채용 일정 불러오는 중");
  let dutyNames = {};
  try {
    const list = await (await siteFetch("https://jasoseol.com/api/v1/duty-groups", { headers: { Accept: "application/json" } })).json();
    dutyNames = Object.fromEntries(list.map((d) => [d.id, d.name]));
  } catch { /* 직무명은 없어도 수집 가능 */ }
  await pause();
  const day = (offset) => new Date(Date.now() + 9 * 3600000 + offset * 86400000).toISOString().slice(0, 10);
  const data = await (await siteFetch("https://jasoseol.com/employment/calendar_list.json", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ start_time: `${day(0)}T00:00:00+09:00`, end_time: `${day(JASOSEOL_DAYS_AHEAD)}T23:59:59+09:00` }),
  })).json();
  const now = Date.now();
  const out = [];
  for (const e of data.employment || []) {
    if (e.end_time && Date.parse(e.end_time) < now) continue;
    const groups = new Set((e.employments || []).flatMap((emp) => (emp.duty_groups || []).map((g) => g.group_id)));
    const cats = new Set(match(`${e.name || ""} ${e.title || ""}`));
    groups.forEach((g) => JASOSEOL_DUTY_GROUPS[g] && cats.add(JASOSEOL_DUTY_GROUPS[g]));
    if (!cats.size) continue;
    const cg = e.company_group || {};
    const bs = String(cg.business_size || ""), bt = String(cg.business_type || "");
    out.push(makeJob({
      source: "자소설닷컴", id: e.id, company: e.name, title: e.title,
      url: `https://jasoseol.com/recruit/${e.id}`, deadline: toKstDate(e.end_time),
      field: [...new Set([...groups].map((g) => dutyNames[g]).filter(Boolean))].sort().join(", "),
      categories: [...cats],
      size: /대기업|공기업|large/i.test(bs + bt) ? 3 : /중견|middle/i.test(bs) ? 2 : 0,
      foreign: /외국계|foreign/i.test(bs + bt), isPublic: /공기업|공공|public/i.test(bs + bt),
    }));
  }
  return out;
}

async function linkareerGql(query) {
  const res = await (await siteFetch("https://api.linkareer.com/graphql", {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ query }),
  })).json();
  if (res.errors?.length && !res.data) throw new Error(res.errors[0].message);
  return res.data;
}
async function fetchLinkareer({ match, progress }) {
  const all = [];
  for (let page = 1; page <= 40; page++) {
    progress(`전체 공고 읽는 중 (${page}쪽)`);
    const d = await linkareerGql(`{ activities(filterBy:{activityTypeID:"5",status:OPEN}, orderBy:{direction:DESC,field:RECENT}, pagination:{page:${page},pageSize:100}) { totalCount nodes { id title organizationName organizationType recruitCloseAt recruitType jobTypes regions{ name } categories{ name } } } }`);
    const nodes = d?.activities?.nodes || [];
    all.push(...nodes);
    await pause();
    if (nodes.length < 100 || all.length >= (d?.activities?.totalCount || 0)) break;
  }
  if (!all.length) throw new Error("공고를 하나도 읽지 못했습니다");
  return pick(all.map(linkareerJob), match, (j) => j.field);
}
export async function linkareerDetailHtml(id) {
  const d = await linkareerGql(`{ activity(id:"${String(id).replace(/\D/g, "")}"){ detailText{ text } } }`);
  return d?.activity?.detailText?.text || "";
}

async function fetchAlio({ match, progress }) {
  const all = [];
  for (let page = 1; page <= 30; page++) {
    progress(`전체 공고 읽는 중 (${page}쪽)`);
    const rows = parseAlio(html(await readText(await siteFetch(`https://job.alio.go.kr/recruit.do?pageNo=${page}&pageSet=50&ing=2`))));
    if (rows === null) throw new Error("화면 구조가 바뀐 것 같습니다");
    all.push(...rows);
    await pause();
    if (rows.length < 50) break;
  }
  if (!all.length) throw new Error("공고를 하나도 읽지 못했습니다");
  return pick(all, match);
}

async function fetchCleaneye({ match, progress }) {
  const all = [];
  const year = kstToday().slice(0, 4);
  let total = Infinity;
  for (let page = 1; page <= 40 && all.length < total; page++) {
    progress(`전체 공고 읽는 중 (${page}쪽)`);
    const body = new URLSearchParams({ yearincome: year, status: "709001", pubDate: "", pubEndDate: "", entName: "", pageIndex: String(page) });
    const data = await (await siteFetch("https://job.cleaneye.go.kr/user/selectYpRecruitment.do", {
      method: "POST", body,
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
    })).json();
    const list = data.list || [];
    total = +data.cnt || 0;
    all.push(...list.map(cleaneyeJob));
    await pause();
    if (!list.length) break;
  }
  if (!all.length) throw new Error("공고를 하나도 읽지 못했습니다");
  const today = kstToday();
  return pick(all.filter((j) => !j.deadline || j.deadline >= today), match);
}

async function fetchHibrain({ match, progress }) {
  const all = [];
  const today = kstToday();
  for (let page = 1; page <= 30; page++) {
    progress(`연구원 공고 읽는 중 (${page}쪽)`);
    const rows = parseHibrain(html(await readText(await siteFetch(
      `https://www.hibrain.net/recruitment/categories/JOB/categories/RES/recruits?listType=TOTAL&sortType=RDT&pagesize=25&page=${page}`))));
    all.push(...rows);
    await pause();
    if (rows.length < 25) break;
  }
  if (!all.length) throw new Error("공고를 하나도 읽지 못했습니다");
  return pick(all.filter((j) => !j.deadline || j.deadline >= today), match);
}

export const RUNNERS = {
  "사람인": fetchSaramin, "잡코리아": fetchJobkorea, "인크루트": fetchIncruit, "자소설닷컴": fetchJasoseol,
  "캐치": fetchCatch, "링커리어": fetchLinkareer, "잡알리오": fetchAlio, "클린아이": fetchCleaneye, "하이브레인넷": fetchHibrain,
};

// ---------------------------------------------------------------- 본문 확인 (간단한 공고·석사 우대 판별용)
export async function fetchDetail(job) {
  let text;
  if (job.source === "링커리어") text = await linkareerDetailHtml(job.sourceId);
  else {
    const u = bodyUrl(job);
    if (!u) return null;
    text = await readText(await siteFetch(u));
  }
  const doc = html(text);
  const root = doc.querySelector(
    ".user_content, .wrap_jv_cont, #content, .recruit-view, .view_cont, .detail_cont, .recruitment-detail, article, .cont") || doc.body || doc.documentElement;
  const plain = (root.textContent || "").replace(/\s+/g, " ");
  const m = measureContent(root);
  const edu = /석사\s*(이상|우대|학위|졸업|소지)|석사급|석·박사|석박사/.test(plain) ? "master" : /박사\s*(이상|학위|소지)/.test(plain) ? "doctor" : "";
  return { chars: m.chars, imgs: m.imgs, edu, at: Date.now() };
}
