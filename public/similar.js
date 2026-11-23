// 찜 일수도: 찜한 공고들과 비슷한 공고 찾기
// 찜한 공고들의 특징(기관, 연구기관 구분, 기관 유형, 관심 분야, 모집 분야, 제목 단어, 지역)을 모아 두고
// 지금 목록의 공고마다 겹치는 정도로 점수를 매긴 뒤, 왜 비슷한지 이유를 함께 돌려줌.

const STOP = new Set(("채용 모집 공고 공개 공채 신입 경력 신입경력 사원 직원 정규직 계약직 인턴 기간제 수시 상시 하반기 상반기 " +
  "년도 차 제 및 담당 담당자 부문 분야 직무 업무 인원 명 각 대상 우대 가능 관련 전형 지원 신규 정원외 일반 정규 " +
  "주식회사 재단법인 사단법인 회사 기업 그룹 본사 지사 서울 경기 전국 재공고 공고문 안내").split(/\s+/));
export function tokens(text) {
  return [...new Set((text || "")
    .replace(/\(주\)|㈜|주식회사|\(재\)|\(사\)|20\d\d년?|\d+차|\d+명|\d+/g, " ")
    .split(/[^가-힣A-Za-z]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOP.has(t)))];
}

// 공고(카드든 찜해 둔 요약이든) → 비교용 특징
export function featuresOf(c) {
  return {
    company: c.companyKey || "",
    companyName: c.company || "",
    research: c.research || "",
    orgType: c.orgType || "",
    cats: new Set(c.cats || []),
    fields: new Set((c.fields || []).flatMap(tokens)),
    words: new Set(tokens(c.title)),
    regions: new Set((c.regions || []).filter((r) => r !== "지역 미상")),
  };
}

const ORG_NAME = { public: "공공기관", org: "기관", private: "민간기업" };

// favs: 찜한 공고 요약 목록, cards: 지금 목록, opts.exclude: 찜한 카드 등 제외할 카드 판별 함수
export function suggest(favs, cards, { exclude = () => false, limit = 60, minScore = 1.8 } = {}) {
  if (!favs.length) return [];
  const F = favs.map(featuresOf);
  // 제목·분야 단어가 흔할수록 덜 중요하게 (전체 목록 기준 IDF)
  const df = new Map();
  for (const c of cards) for (const w of new Set([...tokens(c.title), ...(c.fields || []).flatMap(tokens)])) df.set(w, (df.get(w) || 0) + 1);
  const N = Math.max(cards.length, 1);
  const idf = (w) => Math.log(1 + N / (1 + (df.get(w) || 0)));

  const out = [];
  for (const c of cards) {
    if (exclude(c)) continue;
    const x = featuresOf(c);
    let best = { score: 0, reasons: [], fav: null };
    for (let i = 0; i < F.length; i++) {
      const f = F[i];
      let score = 0;
      const reasons = [];
      if (x.company && x.company === f.company) { score += 4; reasons.push(`찜한 「${f.companyName}」의 다른 공고`); }
      if (x.research && x.research === f.research) { score += 3; reasons.push(`같은 ${x.research}`); }
      else if (x.research && f.research) { score += 2.5; reasons.push(`같은 공공 연구기관(찜: ${f.research})`); }
      const sharedCats = [...x.cats].filter((k) => f.cats.has(k) && k !== "공공 연구기관");
      if (sharedCats.length) { score += 1 + 0.5 * (sharedCats.length - 1); reasons.push(`관심 분야 ${sharedCats.join("·")}`); }
      const sharedFields = [...x.fields].filter((w) => f.fields.has(w));
      const sharedWords = [...x.words].filter((w) => f.words.has(w) || f.fields.has(w));
      const kw = [...new Set([...sharedFields, ...sharedWords])].sort((a, b) => idf(b) - idf(a));
      if (kw.length) {
        score += Math.min(3, kw.slice(0, 4).reduce((s, w) => s + idf(w) * 0.45, 0));
        reasons.push(`비슷한 업무: ${kw.slice(0, 3).join(", ")}`);
      }
      if (!x.research && x.orgType === "public" && f.orgType === "public") {
        score += 0.7; reasons.push(ORG_NAME.public);
      }
      if ([...x.regions].some((r) => f.regions.has(r))) score += 0.4;
      if (score > best.score) best = { score, reasons, fav: favs[i] };
    }
    if (best.score >= minScore) out.push({ card: c, score: Math.round(best.score * 10) / 10, reasons: best.reasons, fav: best.fav });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

// 찜할 때 저장하는 요약 (공고가 목록에서 사라져도 찜 탭에 남도록)
export function snapshotOf(c) {
  const cut = (s, n) => (s || "").slice(0, n);
  return {
    key: c.key, uids: c.uids.slice(0, 6), company: cut(c.company, 40), companyKey: c.companyKey, title: cut(c.title, 90),
    links: c.links.slice(0, 3), deadline: c.deadline, deadlineText: cut(c.deadlineText, 20),
    fields: c.fields.slice(0, 6).map((f) => cut(f, 20)), cats: c.cats.slice(0, 6), research: c.research,
    orgType: c.orgType, sizeTier: c.sizeTier, sizeLabel: cut(c.sizeLabel, 20), regions: c.regions,
    regionText: cut(c.regionText, 30), at: Date.now(),
  };
}
