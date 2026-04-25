import { jsonResponse } from "../_lib/util";

export const onRequestGet = (): Response =>
  jsonResponse({ ok: true, runtime: "cloudflare-pages-functions" });
