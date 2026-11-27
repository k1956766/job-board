// 자소설닷컴 채용 달력(https://jasoseol.com/recruit)을 연 브라우저 탭에서 실행하는 코드.
// 달력 페이지가 스스로 부르는 요청과 같은 요청을 한 번 보내, 관심 분야에 걸리는 공고만 추려
// 짧은 JSON 글자를 탭 화면(<pre id="jss-out">)에 띄웁니다. 그 글자를 home-pc/jasoseol.json 으로 저장하면
// 집 PC 수집기(collector/sites.js)가 읽어 다른 사이트와 같은 방식으로 다시 걸러 올립니다.
//
// 직접 쓰지 말고 jasoseol-terms.mjs 가 출력하는 코드(현재 검색어가 들어간 것)를 실행합니다.
// 형식: { savedAt, total, count, v: 2, items: [{ i: id, n: 기업명, t: 제목, e: 마감(ISO), s: 규모, b: 유형, g: [관심 직무 번호], f: 직무명 }] }
// 일정 기간은 public/lib.js 의 JASOSEOL_DAYS_AHEAD(90일)와 맞춥니다.
(async (FILTER) => {
  const DAYS = 90;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // public/lib.js makeMatcher 와 같은 규칙: 영문 약어는 단어 경계로만
  const res = (FILTER.terms || []).map((t) => /^[A-Za-z0-9 ]+$/.test(t)
    ? new RegExp(`(?<![A-Za-z])${esc(t)}(?![A-Za-z])`, "i") : new RegExp(esc(t)));
  const groupsWanted = new Set(FILTER.dutyGroups || []);
  const day = (o) => new Date(Date.now() + 9 * 3600000 + o * 86400000).toISOString().slice(0, 10);
  const r = await fetch("/employment/calendar_list.json", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ start_time: `${day(0)}T00:00:00+09:00`, end_time: `${day(DAYS)}T23:59:59+09:00` }),
  });
  if (!r.ok) return { error: `HTTP ${r.status}` };
  const all = (await r.json()).employment || [];
  let dutyNames = {};
  try {
    const list = await (await fetch("/api/v1/duty-groups", { headers: { Accept: "application/json" } })).json();
    dutyNames = Object.fromEntries(list.map((d) => [d.id, d.name]));
  } catch { /* 직무명은 없어도 됨 */ }
  const now = Date.now();
  const items = [];
  for (const e of all) {
    if (e.end_time && Date.parse(e.end_time) < now) continue;
    const groups = [...new Set((e.employments || []).flatMap((m) => (m.duty_groups || []).map((g) => g.group_id)))];
    const text = `${e.name || ""} ${e.title || ""}`;
    const g = groups.filter((x) => groupsWanted.has(x));
    if (!g.length && !res.some((re) => re.test(text))) continue;
    const cg = e.company_group || {};
    // 직무명은 관심 직무 먼저, 최대 4개
    const names = [...new Set([...g, ...groups].map((x) => dutyNames[x]).filter(Boolean))].slice(0, 4);
    items.push({ i: e.id, n: e.name, t: e.title, e: e.end_time, s: cg.business_size || "", b: cg.business_type || "", g, f: names.join(", ") });
  }
  const out = JSON.stringify({ savedAt: new Date().toISOString(), total: all.length, count: items.length, v: 2, items });
  // 결과가 길어서 도구 출력에 다 담기지 않으므로, 이 탭 화면에 글자로 띄워 두고 화면 글자를 읽어 저장
  document.body.innerHTML = "";
  const pre = document.createElement("pre");
  pre.id = "jss-out";
  pre.textContent = out;
  document.body.appendChild(pre);
  return { total: all.length, count: items.length, chars: out.length };
})(__FILTER__);
