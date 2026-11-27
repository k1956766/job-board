// 자소설닷컴 브라우저 수집용: 사이트 설정(KV)의 현재 검색어를 넣은 브라우저 실행 코드를 출력
//   node --env-file=home-pc\home.env home-pc\jasoseol-terms.mjs
// 출력된 코드를 자소설닷컴 채용 달력 탭에서 실행합니다. 출력에는 비밀값이 없습니다 (검색어 목록뿐).
import { readFileSync } from "node:fs";
import { kvGet } from "../collector/kv.js";
import { withDefaults, JASOSEOL_DUTY_GROUPS } from "../public/lib.js";

const s = withDefaults(await kvGet("settings"));
const terms = [...new Set(Object.values(s.categories || {}).flat().filter(Boolean))];
const filter = JSON.stringify({ terms, dutyGroups: Object.keys(JASOSEOL_DUTY_GROUPS).map(Number) });
const code = readFileSync(new URL("./jasoseol-browser.js", import.meta.url), "utf8")
  .split("\n").filter((l) => !l.startsWith("//")).join("\n")
  .replace("(__FILTER__)", `(${filter})`);
console.log(code);
