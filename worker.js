// Cloudflare Workers 진입점: /api/* 는 API로, 나머지는 public/ 화면 파일로
import { onRequest } from "./functions/api/[[path]].js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return onRequest({ request, env, ctx });
    return env.ASSETS.fetch(request);
  },
};
