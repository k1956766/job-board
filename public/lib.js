// 공통 로직 (사이트 화면과 수집기가 함께 씀): 기본 설정, 검색어 매칭, 날짜, 목록 해석, 같은 공고 묶기
import { researchGroupOf, isMajorName, looksForeign, parseCareer, parseEdu, eduFromCode, isSimpleContent } from "./orgs.js";

export const SOURCES = ["사람인", "잡코리아", "인크루트", "자소설닷컴", "캐치", "링커리어", "잡알리오", "클린아이", "하이브레인넷"];
// 저장소(KV) 키에 쓰는 영문 이름
export const SOURCE_IDS = {
  "사람인": "saramin", "잡코리아": "jobkorea", "인크루트": "incruit", "자소설닷컴": "jasoseol", "캐치": "catch",
  "링커리어": "linkareer", "잡알리오": "alio", "클린아이": "cleaneye", "하이브레인넷": "hibrain",
};

export const SOURCE_NOTES = {
  "사람인": "검색어별 검색",
  "잡코리아": "검색어별 검색",
  "인크루트": "검색어별 검색",
  "캐치": "검색어별 검색",
  "자소설닷컴": "대기업·공기업 공채 일정 전체에서 선별",
  "링커리어": "진행 중인 채용 전체에서 선별",
  "잡알리오": "공공기관 채용 전체에서 선별",
  "클린아이": "지방공공기관 채용 전체에서 선별",
  "하이브레인넷": "연구원 채용 전체에서 선별",
};

export const DEFAULT_SETTINGS = {
  sources: Object.fromEntries(SOURCES.map((s) => [s, true])),
  categories: {
    "부동산·주택": ["부동산", "주택", "감정평가", "리츠", "부동산개발", "프롭테크", "부동산금융", "자산운용", "부동산 리서치",
      "도시개발", "정비사업", "재건축", "재개발", "PF"],
    "도시·국토": ["도시계획", "도시재생", "도시설계", "도시정책", "국토", "지역개발", "지역정책", "스마트시티", "디지털트윈",
      "도시공학", "도시및지역계획", "지구단위계획"],
    "교통·모빌리티": ["교통계획", "교통정책", "교통데이터", "모빌리티", "대중교통"],
    "GIS·공간정보": ["GIS", "공간정보", "지리정보", "공간분석", "원격탐사", "위성영상", "측량", "ArcGIS", "QGIS"],
    "에너지·기후": ["재생에너지", "신재생", "태양광", "풍력", "ESS", "에너지전환", "전력시장", "탄소중립", "기후",
      "온실가스", "ESG", "환경영향평가", "에너지정책"],
    "환경·물": ["환경정책", "환경계획", "수자원", "물환경", "상하수도", "환경공학"],
    "데이터·통계": ["데이터분석", "빅데이터", "통계분석", "공공데이터", "데이터 사이언티스트", "데이터 애널리스트"],
    "정책연구": ["정책연구", "정책분석", "연구위원", "위촉연구원", "연구조원", "연구원 채용", "전문연구원"],
    "관심 기관": ["국토연구원", "한국토지주택공사", "LH", "서울주택도시공사", "경기주택도시공사", "주택도시보증공사",
      "한국부동산원", "한국국토정보공사", "한국교통연구원", "한국환경연구원", "에너지경제연구원", "한국에너지공단",
      "한국에너지기술연구원", "서울연구원", "인천연구원", "한국지방행정연구원", "건축공간연구원", "한국수자원공사"],
  },
  exclude: ["영업직", "텔레마케팅"],
  intervalHours: 6,       // 자동 수집 간격 (시간)
  hideCareer3: true,      // 경력 3년 이상만 받는 공고 숨기기
  simpleMinChars: 150,    // 본문 글자 수가 이보다 적으면 '간단한 공고'
};
export const withDefaults = (s) => ({ ...DEFAULT_SETTINGS, ...(s || {}),
  sources: { ...DEFAULT_SETTINGS.sources, ...(s?.sources || {}) } });

// 자소설닷컴 직무 분류 ID → 분야 (제목에 검색어가 없어도 이 직무면 가져옴)
export const JASOSEOL_DUTY_GROUPS = {
  206: "도시·국토", 208: "에너지·기후", 209: "부동산·주택", 230: "에너지·기후", 231: "환경·물", 180: "데이터·통계",
};

export const MAX_PAGES = 2;          // 검색어당 최대 페이지
export const JASOSEOL_DAYS_AHEAD = 90;

// ---------------------------------------------------------------- 날짜 (한국 시간)
const DAY = 86400000;
export const kstToday = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
export const toKstDate = (iso) => {
  if (!iso) return "";
  const t = Date.parse(iso);
  return isNaN(t) ? "" : new Date(t + 9 * 3600000).toISOString().slice(0, 10);
};
export const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const pad = (n) => String(n).padStart(2, "0");
const addDays = (d, n) => new Date(Date.parse(d) + n * DAY).toISOString().slice(0, 10);

// 사이트마다 다른 마감일 표기를 "2026-10-28"로 통일
export function parseDeadline(text) {
  const t = String(text || "");
  const today = kstToday();
  if (/오늘\s*마감/.test(t)) return today;
  if (/내일\s*마감/.test(t)) return addDays(today, 1);
  let m = /(20\d{2})(\d{2})(\d{2})/.exec(t);                     // 20261130
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /(20\d{2}|\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/.exec(t);
  if (m) return valid(m[1].length === 2 ? 2000 + +m[1] : +m[1], +m[2], +m[3]);
  m = /(\d{1,2})[./](\d{1,2})/.exec(t);
  if (!m) return "";
  const y = +today.slice(0, 4);
  const s = valid(y, +m[1], +m[2]);
  return s && daysBetween(today, s) < -60 ? valid(y + 1, +m[1], +m[2]) : s;  // 연말에 보는 1~2월 마감은 다음 해
}
function valid(y, mm, dd) {
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return "";
  return `${y}-${pad(mm)}-${pad(dd)}`;
}

// ---------------------------------------------------------------- 검색어 매칭
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function makeMatcher(categories) {
  const list = [];
  for (const [cat, terms] of Object.entries(categories)) {
    for (const t of terms) {
      // 영문 약어(GIS, ESS, LH 등)는 단어 경계로만: business의 'ess' 같은 오탐 방지
      const re = /^[A-Za-z0-9 ]+$/.test(t)
        ? new RegExp(`(?<![A-Za-z])${reEsc(t)}(?![A-Za-z])`, "i")
        : new RegExp(reEsc(t));
      list.push([cat, re]);
    }
  }
  return (text) => [...new Set(list.filter(([, re]) => re.test(text || "")).map(([c]) => c))].sort();
}
export const isExcluded = (title, exclude) => (exclude || []).some((x) => x && (title || "").includes(x));

// ---------------------------------------------------------------- 지역 (서울 / 경기 / 그 외)
export const REGIONS = ["서울", "경기", "그 외", "지역 미상"];
const GYEONGGI = /경기|수원|성남|고양|용인|부천|안산|안양|남양주|화성|평택|의정부|시흥|파주|김포|광명|군포|하남|오산|이천|안성|의왕|양주|포천|여주|동두천|과천|구리|연천|가평|양평|판교|분당|일산/;
export function regionsOf(text) {
  const out = new Set();
  for (const loc of (text || "").split(/[,/·|]+/).map((s) => s.trim()).filter(Boolean)) {
    if (/서울/.test(loc)) out.add("서울");
    else if (GYEONGGI.test(loc) && !/^(전남|광주광역)/.test(loc)) out.add("경기");
    else out.add("그 외");
  }
  return [...out];
}
export function regionsFromTitle(title) {
  const parts = [...(title || "").matchAll(/[\[(]([^\])]{1,15})[\])]/g)].map((m) => m[1])
    .filter((p) => /서울|경기|인천|부산|대구|광주|대전|울산|세종|강원|충북|충남|전북|전남|경북|경남|제주|수원|성남|판교|용인|고양|화성/.test(p));
  return regionsOf(parts.join(","));
}

// ---------------------------------------------------------------- 기관 유형 (공공 / 기관 / 민간기업)
const PUBLIC_RE = /공사$|공사\s|공단|진흥원|평가원|관리원|정보원|개발원|진흥회|공제회|교육청|시청|구청|군청|도청|국립|정부|위원회|연구원|연구소|과학기술원|KAIST|KIST|공기업|^LH$|공공기관/;
const ORG_RE = /대학교|대학원|대학$|병원|의료원|재단|협회|학회|조합|센터|학교/;
export function orgType(company, explicitPublic) {
  const c = company || "";
  if (explicitPublic) return "public";
  if (/\(주\)|㈜|주식회사|\(유\)|유한회사/.test(c)) return "private";
  if (PUBLIC_RE.test(c)) return "public";
  if (ORG_RE.test(c)) return "org";
  return "private";
}

// ---------------------------------------------------------------- 공고 객체
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·" };
export const clean = (s) => String(s ?? "")
  .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e) => e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] ?? m)
  .replace(/\s+/g, " ").trim();

// size: 사이트가 알려준 규모 (3 대기업·주요 공기업, 2 중견·공공, 0 모름) / foreign: 사이트가 알려준 외국계 여부
// career: 경력 조건 글 / edu: "master" | "doctor" | ""
export function makeJob({ source, id, company, title, url, deadline = "", deadlineText = "", region = "", info = "",
  field = "", positions = "", categories = [], isPublic = false, size = 0, foreign = false, career = "", edu = "", extra }) {
  const j = {
    uid: `${source}:${id}`, source, sourceId: String(id),
    company: clean(company), title: clean(title), url,
    deadline, deadlineText: clean(deadlineText), region: clean(region),
    info: clean(info), field: clean(field), positions: clean(positions),
    categories: [...new Set(categories)].sort(), public: !!isPublic,
  };
  if (size) j.size = size;
  if (foreign) j.foreign = true;
  if (career) j.career = clean(career);
  if (edu) j.edu = edu;
  if (extra) j.extra = extra;
  return j;
}

// 인크루트 검색 결과
export function parseIncruit(doc) {
  const out = [];
  for (const li of doc.querySelectorAll("li.c_col")) {
    const a = li.querySelector("div.cell_mid div.cl_top a");
    if (!a) continue;
    const m = /job=(\d+)/.exec(a.getAttribute("href") || "");
    if (!m) continue;
    const comp = li.querySelector("div.cell_first a.cpname");
    const spans = [...li.querySelectorAll("div.cell_mid div.cl_md span")].map((s) => clean(s.textContent));
    const field = [...li.querySelectorAll("div.cell_mid div.cl_btm span")].map((s) => clean(s.textContent)).join(" ");
    const dl = li.querySelector("div.cell_last div.cl_btm span");
    const dlText = dl ? clean(dl.textContent) : "";
    const info = spans.slice(1).join(" · ");
    out.push(makeJob({
      source: "인크루트", id: m[1], company: comp ? comp.textContent : "", title: a.textContent,
      url: `https://job.incruit.com/jobdb_info/jobpost.asp?job=${m[1]}`,
      deadline: parseDeadline(dlText), deadlineText: dlText, region: spans[0] || "", info, field,
      career: info, edu: parseEdu(info),
    }));
  }
  return out;
}

// 사람인 검색 결과
export function parseSaramin(doc) {
  const out = [];
  for (const it of doc.querySelectorAll(".item_recruit")) {
    const id = it.getAttribute("value") ||
      (/rec_idx=(\d+)/.exec(it.querySelector(".job_tit a")?.getAttribute("href") || "") || [])[1];
    const a = it.querySelector(".job_tit a");
    if (!id || !a) continue;
    const cond = [...it.querySelectorAll(".job_condition > span")].map((s) => clean(s.textContent));
    const dl = clean(it.querySelector(".job_date .date")?.textContent);
    const info = cond.slice(1).join(" · ");
    out.push(makeJob({
      source: "사람인", id,
      company: it.querySelector(".corp_name a")?.textContent || it.querySelector(".corp_name")?.textContent,
      title: a.getAttribute("title") || a.textContent,
      url: `https://www.saramin.co.kr/zf_user/jobs/relay/view?view_type=search&rec_idx=${id}`,
      deadline: parseDeadline(dl), deadlineText: dl, region: cond[0] || "", info,
      field: [...it.querySelectorAll(".job_sector > a")].map((x) => clean(x.textContent)).join(", "),
      career: info, edu: parseEdu(info),
    }));
  }
  return out;
}

// 잡코리아 검색 결과: 화면 HTML 안에 실린 데이터(Next.js)에서 공고 배열을 꺼냄
const JK_CAREER = { 1: "신입", 2: "경력", 3: "신입·경력", 4: "경력무관" };
const JK_EDU = { 1: "학력무관", 2: "고졸", 3: "고졸", 4: "초대졸", 5: "대졸", 6: "석사", 7: "박사" };
export function parseJobkorea(html) {
  let joined = "";
  const re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  for (const m of html.matchAll(re)) {
    try { joined += JSON.parse(`"${m[1]}"`); } catch { /* 건너뜀 */ }
  }
  const arrayAt = (s) => {
    let depth = 0, e = s;
    for (; e < joined.length; e++) {
      const ch = joined[e];
      if (ch === '"') { e++; while (e < joined.length && joined[e] !== '"') { if (joined[e] === "\\") e++; e++; } continue; }
      if (ch === "[") depth++;
      else if (ch === "]" && --depth === 0) break;
    }
    return JSON.parse(joined.slice(s, e + 1));
  };
  let list = null;
  for (let pos = joined.indexOf('"content":['); pos >= 0; pos = joined.indexOf('"content":[', pos + 10)) {
    try {
      const a = arrayAt(pos + 10);
      if (!a.length || (a[0].applicationPeriod && a[0].title)) { list = a; if (a.length) break; }
    } catch { /* 다음 후보 */ }
  }
  if (list === null) return null;
  return list.map((x) => {
    const ct = String(x.careerType || "");
    const career = ct === "2" && x.careerRange > 0 && x.careerRange < 40 ? `경력 ${x.careerRange}년 이상` : (JK_CAREER[ct] || "");
    const type = +x.companyTypeCode;
    return makeJob({
      source: "잡코리아", id: x.id, company: x.postingCompanyName || x.companyName, title: x.title,
      url: `https://www.jobkorea.co.kr/Recruit/GI_Read/${x.id}`,
      deadline: toKstDate(x.applicationPeriod?.end), deadlineText: x.applicationPeriod?.end ? "" : "상시",
      region: [...new Set((x.areaCodeList || []).map((c) => JOBKOREA_SIDO[String(c)[0]]).filter(Boolean))].join(", "),
      field: (x.jobClassificationOrIndustry || "").split(",").map((s) => s.trim()).filter(Boolean).join(", "),
      info: [career, JK_EDU[x.educationCode]].filter(Boolean).join(" · "),
      career, edu: eduFromCode(x.educationCode),
      size: type === 3 || type === 7 || x.companyRank > 0 ? 3 : type === 4 ? 2 : 0,
      foreign: type === 6 || type === 8, isPublic: type === 7,
    });
  });
}
const JOBKOREA_SIDO = {
  I: "서울", B: "경기", K: "인천", G: "대전", O: "충남", P: "충북", L: "전남·광주", M: "전북",
  F: "대구", D: "경북", H: "부산", J: "울산", C: "경남", A: "강원", N: "제주", Q: "전국", 1: "세종",
};

// 잡알리오(공공기관) 목록 표
export function parseAlio(doc) {
  const table = [...doc.querySelectorAll("table")].find((t) =>
    [...t.querySelectorAll("thead th")].some((th) => th.textContent.includes("채용제목")));
  if (!table) return null;
  const out = [];
  for (const tr of table.querySelectorAll("tbody tr")) {
    const td = [...tr.children].map((c) => clean(c.textContent));
    const a = tr.querySelector("a[href*='recruitview.do']");
    const id = (/idx=(\d+)/.exec(a?.getAttribute("href") || "") || [])[1];
    if (!id) continue;
    out.push(makeJob({
      source: "잡알리오", id, title: td[2], company: td[3],
      url: `https://job.alio.go.kr/recruitview.do?idx=${id}`,
      deadline: parseDeadline(td[7]), region: td[4], info: td[5], isPublic: true, career: td[5],
    }));
  }
  return out;
}

// 클린아이(지방공공기관) 채용 목록 JSON 한 건
export const CLEANEYE_SIDO = {
  "007001": "서울", "007002": "부산", "007003": "대구", "007004": "인천", "007005": "광주", "007006": "대전",
  "007007": "울산", "007008": "경기", "007009": "강원", "007010": "충북", "007011": "충남", "007012": "전북",
  "007013": "전남", "007014": "경북", "007015": "경남", "007016": "제주", "007017": "세종",
};
export function cleaneyeJob(x) {
  const id = `${x.empyear}-${x.ypEntId}-${x.entSeq}`;
  const q = new URLSearchParams({ empyear: x.empyear, ypEntId: x.ypEntId, entSeq: x.entSeq });
  return makeJob({
    source: "클린아이", id, company: x.entName, title: x.entTitle,
    url: `https://job.cleaneye.go.kr/user/ypCareersData.do?${q}`,
    deadline: parseDeadline(x.pubEndDate), region: CLEANEYE_SIDO[x.sidoCd] || "", isPublic: true,
  });
}

// 하이브레인넷 연구원 채용 목록
export function parseHibrain(doc) {
  const out = [];
  for (const li of doc.querySelectorAll("ul.table li.row.sortRoot")) {
    const a = li.querySelector(".td_title a");
    const id = (/recruits\/(\d+)/.exec(a?.getAttribute("href") || "") || [])[1];
    if (!id) continue;
    const title = clean(li.querySelector(".td_title .title")?.textContent || a.textContent);
    const dates = [...li.querySelectorAll(".td_receipt .number")].map((s) => clean(s.textContent));
    const end = dates[dates.length - 1] || "";
    out.push(makeJob({
      source: "하이브레인넷", id, title, company: title.split(/\s+/)[0],
      url: `https://www.hibrain.net/recruitment/categories/JOB/categories/RES/recruits/${id}`,
      deadline: parseDeadline(end), deadlineText: dates.length ? "" : "상시", field: "연구원",
    }));
  }
  return out;
}

// 링커리어 GraphQL 공고 한 건
const LINKAREER_TYPES = { NEW: "신입", EXPERIENCED: "경력", INTERN: "인턴", CONTRACT: "계약직" };
const LINKAREER_ORG = { LARGE: 3, PUBLIC: 3, MID: 2, MIDDLE: 2, FOREIGN: 0 };
export function linkareerJob(x) {
  const always = x.recruitType === "ALWAYS", asap = x.recruitType === "ASAP";
  const ot = String(x.organizationType?.name || x.organizationType || "");
  const info = (x.jobTypes || []).map((t) => LINKAREER_TYPES[t] || t).join(" · ");
  return makeJob({
    source: "링커리어", id: x.id, company: x.organizationName, title: x.title,
    url: `https://linkareer.com/activity/${x.id}`,
    deadline: always || !x.recruitCloseAt ? "" : toKstDate(new Date(+x.recruitCloseAt).toISOString()),
    deadlineText: always ? "상시" : asap ? "채용시 마감" : "",
    region: (x.regions || []).map((r) => r.name).join(", "), info, career: info,
    field: (x.categories || []).map((c) => c.name).filter((n) => n !== "전체").join(", "),
    size: /대기업|LARGE/.test(ot) ? 3 : /공기업|공공|PUBLIC/.test(ot) ? 3 : /중견|MID/.test(ot) ? 2 : (LINKAREER_ORG[ot] || 0),
    foreign: /외국계|FOREIGN/.test(ot), isPublic: /공기업|공공|PUBLIC/.test(ot),
  });
}

// 원문 본문만 따로 볼 수 있는 주소 (상세 창·본문 길이 확인용)
export function bodyUrl(j) {
  const id = j.sourceId;
  switch (j.source) {
    case "사람인": return `https://www.saramin.co.kr/zf_user/jobs/relay/view-detail?rec_idx=${id}&rec_seq=0`;
    case "잡코리아": return `https://www.jobkorea.co.kr/Recruit/GI_Read_Comt_Ifrm?Gno=${id}`;
    case "인크루트": return `https://job.incruit.com/s_common/jobpost/jobpostcont.asp?job=${id}`;
    case "잡알리오": case "클린아이": case "하이브레인넷": return j.url;
    default: return "";  // 링커리어는 따로, 캐치·자소설닷컴은 본문 없음
  }
}
export const NO_FRAME = new Set(["캐치", "자소설닷컴"]);

// ---------------------------------------------------------------- 같은 공고 묶기
export const normCompany = (s) => (s || "").replace(/\(주\)|㈜|주식회사|\(유\)|\(재\)|재단법인|사단법인|\s+/g, "").toLowerCase();
const normTitle = (s) => (s || "").replace(/\[[^\]]*\]|\([^)]*\)|20\d\d년?|\s+/g, "").toLowerCase();

function similarity(a, b) {  // 글자 2개씩 겹치는 비율 (Dice)
  if (!a || !b) return 0;
  const grams = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
  const A = grams(a), B = grams(b);
  let inter = 0, total = 0;
  for (const [g, n] of A) { inter += Math.min(n, B.get(g) || 0); total += n; }
  for (const n of B.values()) total += n;
  return total ? (2 * inter) / total : 0;
}

// 회사명 + 마감일이 같고 출처가 다르면 같은 공고로 봄
export function groupJobs(rows) {
  const buckets = new Map();
  for (const r of rows) {
    const key = normCompany(r.company) + "|" + (r.deadline || normTitle(r.title).slice(0, 12));
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(r);
  }
  const groups = [];
  for (const items of buckets.values()) {
    const clusters = [];
    for (const r of items) {
      let best = null, bestSim = 0;
      for (const c of clusters) {
        if (c.some((x) => x.source === r.source)) continue;
        const sim = Math.max(...c.map((x) => similarity(normTitle(r.title), normTitle(x.title))));
        if (best === null || sim > bestSim) { best = c; bestSim = sim; }
      }
      if (best && (bestSim >= 0.3 || r.deadline)) best.push(r);
      else clusters.push([r]);
    }
    groups.push(...clusters);
  }
  return groups;
}

export const KEEP_UNSEEN_MS = 3 * DAY;  // 사이트 목록에서 이만큼 안 보이면 화면에서 뺌
const SIZE_LABEL = { 3: "대기업·주요 기관", 2: "중견·공공" };

// 저장된 공고 → 화면 카드. newSince: 이 시각 이후 처음 본 공고를 NEW로
export function buildCards(jobs, newSince = 0, opts = {}) {
  const today = kstToday();
  const now = Date.now();
  const minChars = opts.simpleMinChars || DEFAULT_SETTINGS.simpleMinChars;
  const rows = Object.values(jobs).filter((j) =>
    (!j.deadline || j.deadline >= today) && now - (j.lastSeenAt || 0) < KEEP_UNSEEN_MS);
  const firstOf = (g, k) => (g.find((x) => x[k]) || {})[k] || "";
  return groupJobs(rows).map((g) => {
    const main = g.reduce((a, b) => (b.title.length > a.title.length ? b : a));
    const deadlines = g.map((x) => x.deadline).filter(Boolean).sort();
    let regions = [...new Set(g.flatMap((x) => regionsOf(x.region)))];
    if (!regions.length) regions = [...new Set(g.flatMap((x) => regionsFromTitle(x.title)))];
    const types = g.map((x) => orgType(x.company, x.public));
    const fields = [...new Set(g.flatMap((x) => (x.field || "").split(/\s*,\s*/)).filter(Boolean))];
    const research = researchGroupOf(main.company, main.title);
    const otype = research || types.includes("public") ? "public" : types.includes("org") ? "org" : "private";
    // 규모: 사이트 정보 → 대기업·주요 기관 이름 목록 → 공공·연구기관
    let sizeTier = Math.max(0, ...g.map((x) => x.size || 0));
    if (sizeTier < 3 && g.some((x) => isMajorName(x.company))) sizeTier = 3;
    if (!sizeTier && (research || otype === "public")) sizeTier = 2;
    // 경력: 여러 사이트 중 가장 낮은 요구 기준 (신입 가능하면 신입)
    const careers = g.map((x) => parseCareer(`${x.career || ""} ${x.title}`));
    const newbie = careers.some((c) => c.newbie);
    const mins = careers.map((c) => c.min).filter((v) => v !== null);
    const careerMin = newbie || !mins.length ? null : Math.min(...mins);
    // 학력: 목록 정보 + 제목 + 본문
    const edus = g.flatMap((x) => [x.edu, parseEdu(x.title), x.detail?.edu]).filter(Boolean);
    const details = g.map((x) => x.detail).filter(Boolean);
    const detail = details.length ? details.reduce((a, b) => (b.chars > a.chars ? b : a)) : null;
    const first = Math.min(...g.map((x) => x.firstSeenAt || now));
    return {
      key: g.map((x) => x.uid).sort()[0],
      uids: g.map((x) => x.uid),
      companyKey: normCompany(main.company),
      regions: regions.length ? regions : ["지역 미상"],
      orgType: otype, research, sizeTier, sizeLabel: SIZE_LABEL[sizeTier] || "",
      foreign: g.some((x) => x.foreign || looksForeign(x.company)),
      careerMin, newbie, edu: edus.includes("master") ? "master" : edus.includes("doctor") ? "doctor" : "",
      detail, simple: detail ? isSimpleContent(detail, minChars) : false,
      fields,
      positions: [...new Set(g.map((x) => x.positions).filter(Boolean))].join(" / "),
      regionText: [...new Set(g.map((x) => x.region).filter(Boolean))].join(", "),
      company: main.company, title: main.title,
      deadline: deadlines[0] || "", deadlineText: firstOf(g, "deadlineText"),
      info: [...new Set(g.map((x) => x.info).filter(Boolean))].slice(0, 2).join(" / "),
      cats: [...new Set(g.flatMap((x) => x.categories))].sort(),
      isNew: !!newSince && first > newSince,
      firstSeenAt: first,
      links: g.map((x) => ({ source: x.source, url: x.url, id: x.sourceId })).sort((a, b) => a.source.localeCompare(b.source)),
    };
  });
}
