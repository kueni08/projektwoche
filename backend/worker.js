import { initialState, validatePlan } from "../public/model.js";
const enc = new TextEncoder();
const json = (value, status = 200) =>
  Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
async function read(db) {
  let row = await db
    .prepare("SELECT revision,payload FROM planning WHERE id=1")
    .first();
  if (!row) {
    await db
      .prepare(
        "INSERT OR IGNORE INTO planning(id,revision,payload) VALUES(1,0,?)",
      )
      .bind(JSON.stringify(initialState()))
      .run();
    row = await db
      .prepare("SELECT revision,payload FROM planning WHERE id=1")
      .first();
  }
  return { revision: row.revision, state: JSON.parse(row.payload) };
}
async function digest(s) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}
async function admin(request, env) {
  const token = (request.headers.get("Authorization") || "").replace(
    /^Bearer /,
    "",
  );
  if (!env.ADMIN_HASH) fail("Lehrpersonenzugang noch nicht eingerichtet.", 503);
  const a = await digest(token),
    b = Uint8Array.from(env.ADMIN_HASH.match(/../g) || [], (h) =>
      parseInt(h, 16),
    );
  let diff = a.length ^ b.length;
  for (let i = 0; i < 32; i++) diff |= a[i] ^ (b[i] || 0);
  if (diff) fail("Zugangscode nicht gültig.", 401);
}
function text(v, max) {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    fail("Text fehlt oder ist zu lang.");
  return v.trim();
}
function choices(v, s) {
  if (
    !Array.isArray(v) ||
    v.length < 4 ||
    v.length > 9 ||
    new Set(v).size !== v.length ||
    v.some(
      (id) =>
        !s.projects.some((p) => p.id === id && p.capacity.some((n) => n > 0)),
    )
  )
    fail("Bitte mindestens vier unterschiedliche verfügbare Angebote wählen.");
  return v;
}
function mutate(s, b) {
  delete s.accessKey;
  delete s.open;
  switch (b.action) {
    case "reset":
      s.children = [];
      s.assignments = {};
      s.fixed = [];
      s.relations = [];
      s.planStatus = "draft";
      break;
    case "projects": {
      if (!Array.isArray(b.projects) || b.projects.length !== 9)
        fail("Genau neun Angebote sind erforderlich.");
      s.title = text(b.title, 100);
      s.projects = b.projects.map((p, i) => {
        if (
          p.id !== String(i + 1) ||
          !Array.isArray(p.capacity) ||
          p.capacity.length !== 2 ||
          p.capacity.some((n) => !Number.isInteger(n) || n < 0 || n > 200)
        )
          fail("Plätze müssen zwischen 0 und 200 liegen.");
        return {
          id: String(i + 1),
          title: text(p.title, 100),
          description: text(p.description, 2000),
          capacity: p.capacity,
        };
      });
      if (validatePlan(s, s.assignments, { allowOutside: true }).issues.length)
        fail(
          "Kapazitäten passen nicht zur bestehenden Einteilung. Zuerst die betroffenen Zuteilungen anpassen.",
        );
      s.planStatus = "draft";
      break;
    }
    case "roster": {
      if (!Array.isArray(b.rows) || b.rows.length > 200)
        fail("Insgesamt höchstens 200 Kinder.");
      const incoming = new Map();
      for (const row of b.rows) {
        if (!row || typeof row.id !== "string" ||
          !/^[A-Z0-9ÄÖÜ_-]{1,20}$/.test(row.id) ||
          incoming.has(row.id) || !Array.isArray(row.choices))
          fail("Kürzel fehlen, sind doppelt oder ungültig.");
        incoming.set(row.id, row.choices.length ? choices(row.choices, s) : []);
      }
      s.children = [...incoming].map(([id, selected]) => ({ id, choices: selected }));
      const ids = new Set(incoming.keys());
      s.assignments = Object.fromEntries(Object.entries(s.assignments).filter(([id]) => ids.has(id)));
      s.fixed = s.fixed.filter((id) => ids.has(id));
      s.relations = (s.relations || []).filter((r) => ids.has(r.a) && ids.has(r.b));
      s.planStatus = "draft";
      break;
    }
    case "plan": {
      if (
        !b.plan ||
        typeof b.plan !== "object" ||
        Array.isArray(b.plan) ||
        Object.keys(b.plan).some((id) => !s.children.some((c) => c.id === id))
      )
        fail("Ungültiger Plan.");
      const check = validatePlan(s, b.plan, {
        allowOutside: b.allowOutside === true,
      });
      if (check.issues.length) fail(check.issues.slice(0, 3).join(" "));
      for (const id of s.fixed)
        if (JSON.stringify(s.assignments[id]) !== JSON.stringify(b.plan[id]))
          fail("Eine fixierte Zuteilung wurde verändert. Bitte zuerst lösen.");
      s.assignments = b.plan;
      s.planStatus = "draft";
      break;
    }
    case "fixed":
      if (
        !Array.isArray(b.fixed) ||
        b.fixed.some(
          (id) =>
            !s.children.some((c) => c.id === id) ||
            !(s.assignments[id] || []).every(Boolean) ||
            s.assignments[id]?.length !== 2,
        )
      )
        fail("Nur vollständig zugeteilte Kinder können fixiert werden.");
      s.fixed = [...new Set(b.fixed)];
      break;
    case "relations": {
      if (!Array.isArray(b.relations) || b.relations.length > 500)
        fail("Zu viele oder ungültige Gruppenvorgaben.");
      const ids = new Set(s.children.map((c) => c.id));
      const seen = new Set();
      s.relations = b.relations.map((rule) => {
        if (!rule || typeof rule !== "object" || Array.isArray(rule) ||
          !ids.has(rule.a) || !ids.has(rule.b) || rule.a === rule.b ||
          !["together", "apart"].includes(rule.kind))
          fail("Ungültige Gruppenvorgabe.");
        const pair = [rule.a, rule.b].sort();
        const key = pair.join(":");
        if (seen.has(key)) fail("Für dieses Kinderpaar gibt es bereits eine Vorgabe.");
        seen.add(key);
        return { a: pair[0], b: pair[1], kind: rule.kind };
      });
      s.planStatus = "draft";
      break;
    }
    case "finalize":
      if (!s.children.length) fail("Noch keine Kinder angelegt.");
      {
        const c = validatePlan(s, s.assignments, {
          allowOutside: true,
          complete: true,
        });
        if (c.issues.length) fail(c.issues[0]);
      }
      s.planStatus = "final";
      break;
    default:
      fail("Unbekannte Aktion.");
  }
  return s;
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin"),
      allowed = (env.ALLOWED_ORIGINS || "").split(",");
    if (origin && !allowed.includes(origin))
      return json({ error: "Diese Website ist nicht freigegeben." }, 403);
    let response;
    try {
      if (request.method === "OPTIONS")
        response = new Response(null, { status: 204 });
      else {
        const path = new URL(request.url).pathname;
        if (path === "/health") response = json({ ok: true });
        else if (path === "/public" && request.method === "GET") {
          const { state: s, revision } = await read(env.DB);
          response = json({
            title: s.title,
            projects: s.projects,
            revision,
          });
        } else if (path === "/admin" && request.method === "GET") {
          await admin(request, env);
          response = json(await read(env.DB));
        } else if (request.method === "POST" && path === "/admin") {
          await admin(request, env);
          if (
            !request.headers.get("Content-Type")?.startsWith("application/json")
          )
            fail("JSON erwartet.", 415);
          const reader = request.body?.getReader();
          let bytes = 0,
            chunks = [];
          if (reader) {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              bytes += value.byteLength;
              if (bytes > 100000) {
                await reader.cancel();
                fail("Anfrage zu gross.", 413);
              }
              chunks.push(value);
            }
          }
          const buffer = new Uint8Array(bytes);
          let offset = 0;
          for (const c of chunks) {
            buffer.set(c, offset);
            offset += c.length;
          }
          let b;
          try {
            b = JSON.parse(new TextDecoder().decode(buffer));
          } catch {
            fail("Ungültige Anfrage.");
          }
          if (!b || typeof b !== "object" || Array.isArray(b))
            fail("Ungültige Anfrage.");
          for (let attempt = 0; attempt < 12; attempt++) {
            const { state: s, revision } = await read(env.DB);
            if (b.revision !== revision)
              fail("Inzwischen wurde etwas geändert. Bitte den aktuellen Stand laden und deine Änderung erneut prüfen.", 409);
            mutate(s, b);
            const result = await env.DB.prepare(
              "UPDATE planning SET payload=?,revision=revision+1 WHERE id=1 AND revision=?",
            )
              .bind(JSON.stringify(s), revision)
              .run();
            if (result.meta.changes) {
              response = json({ state: s, revision: revision + 1 });
              break;
            }
            await new Promise((resolve) =>
              setTimeout(
                resolve,
                20 + crypto.getRandomValues(new Uint8Array(1))[0],
              ),
            );
          }
          if (!response)
            fail(
              "Viele gleichzeitige Änderungen. Bitte nochmals speichern.",
              409,
            );
        } else response = json({ error: "Nicht gefunden." }, 404);
      }
    } catch (e) {
      if (!e.status)
        console.error(
          JSON.stringify({
            event: "request_failed",
            message: "Storage or runtime failure",
          }),
        );
      response = json(
        {
          error: e.status
            ? e.message
            : "Speichern oder Laden momentan nicht möglich. Bitte erneut versuchen.",
        },
        e.status || 503,
      );
    }
    const h = new Headers(response.headers);
    if (origin) h.set("Access-Control-Allow-Origin", origin);
    h.set("Vary", "Origin");
    h.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    h.set(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type",
    );
    h.set("Access-Control-Max-Age", "600");
    return new Response(response.body, { status: response.status, headers: h });
  },
};
