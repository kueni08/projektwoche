import worker from "../../../backend/worker.js";
import { database } from "./storage.ts";

const url = Deno.env.get("SUPABASE_URL");
const secret = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}")?.default ||
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const adminHash = Deno.env.get("ADMIN_HASH");
if (!url || !secret || !adminHash) throw Error("Projektwoche is not configured");

const db = database(url, secret);
Deno.serve((request: Request) => {
  const original = new URL(request.url);
  const endpoint = original.pathname.replace(/^.*\/functions\/v1\/projektwoche/, "") || "/";
  const routed = new Request(new URL(endpoint + original.search, original.origin), request);
  return worker.fetch(routed, {
    DB: db,
    ADMIN_HASH: adminHash,
    ALLOWED_ORIGINS: "https://kueni08.github.io",
  });
});
