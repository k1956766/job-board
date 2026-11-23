// Cloudflare KV 읽기·쓰기 (Cloudflare API 사용 — 사이트 잠금(Access)과 상관없이 동작)
// 필요한 환경 변수: CF_ACCOUNT_ID, CF_API_TOKEN, KV_NAMESPACE_ID
const need = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`환경 변수 ${k}가 없습니다`);
  return v.trim();
};

function base() {
  if (process.env.KV_API_BASE) return process.env.KV_API_BASE;  // 시험용
  return `https://api.cloudflare.com/client/v4/accounts/${need("CF_ACCOUNT_ID")}/storage/kv/namespaces/${need("KV_NAMESPACE_ID")}/values/`;
}
const auth = () => ({ Authorization: `Bearer ${need("CF_API_TOKEN")}` });

export async function kvGet(key, fallback = null) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(base() + encodeURIComponent(key), { headers: auth() });
    if (r.status === 404) return fallback;
    if (r.ok) {
      const t = await r.text();
      try { return JSON.parse(t); } catch { return fallback; }
    }
    if (i === 2) throw new Error(`KV 읽기 실패 ${key}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    await new Promise((res) => setTimeout(res, 2000));
  }
}

export async function kvPut(key, value) {
  const body = JSON.stringify(value);
  for (let i = 0; i < 3; i++) {
    const r = await fetch(base() + encodeURIComponent(key), {
      method: "PUT", headers: { ...auth(), "Content-Type": "application/json" }, body,
    });
    if (r.ok) return;
    if (i === 2) throw new Error(`KV 저장 실패 ${key}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    await new Promise((res) => setTimeout(res, 2000));
  }
}
