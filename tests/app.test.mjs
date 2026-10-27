import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { initialState, allocate, validatePlan } from "../public/model.js";
import { exportCodes, importCodeNames } from "../public/csv.js";
import ExcelJS from "exceljs";
import { makeChoiceTemplate, parseChoiceTemplate } from "../public/excel.js";
import worker from "../backend/worker.js";
globalThis.ExcelJS = ExcelJS;
function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    readFileSync(new URL("../backend/schema.sql", import.meta.url), "utf8"),
  );
  return {
    prepare(sql) {
      const statement = db.prepare(sql);
      return {
        args: [],
        bind(...args) {
          this.args = args;
          return this;
        },
        async first() {
          return statement.get(...this.args) || null;
        },
        async run() {
          const r = statement.run(...this.args);
          return { meta: { changes: Number(r.changes) } };
        },
      };
    },
  };
}
async function setup() {
  const key = "random-test-admin-only";
  const hash = Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)),
  ).toString("hex");
  const env = {
    DB: database(),
    ADMIN_HASH: hash,
    ALLOWED_ORIGINS: "http://localhost",
  };
  const seed = initialState();
  await env.DB.prepare("INSERT INTO planning VALUES(1,0,?)")
    .bind(JSON.stringify(seed))
    .run();
  const request = async (path, body, auth = key) => {
    const r = await worker.fetch(
      new Request("https://api.test" + path, {
        method: body ? "POST" : "GET",
        headers: {
          Origin: "http://localhost",
          "Content-Type": "application/json",
          Authorization: "Bearer " + auth,
          "X-Project-Key": seed.accessKey,
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
      env,
    );
    return { status: r.status, data: await r.json() };
  };
  return { env, request, projectKey: seed.accessKey };
}
test("100 children receive two distinct chosen offers with balanced sizes", () => {
  const s = initialState();
  s.children = Array.from({ length: 100 }, (_, i) => ({
    id: "K" + i,
    choices: s.projects.map((p) => p.id),
  }));
  const result = allocate(s);
  assert.equal(result.missing, 0);
  assert.deepEqual(validatePlan(s, result.plan, { complete: true }).issues, []);
  assert.ok(
    validatePlan(s, result.plan)
      .counts.flat()
      .every((n) => n === 11 || n === 12),
  );
});
test("restricted choices, fixed pairs, unavailable offers and shortage", () => {
  const s = initialState();
  s.children = Array.from({ length: 30 }, (_, i) => ({
    id: "K" + i,
    choices: ["1", "2", "3", "4"],
  }));
  s.assignments.K0 = ["1", "2"];
  s.fixed = ["K0"];
  const r = allocate(s);
  assert.deepEqual(r.plan.K0, ["1", "2"]);
  assert.equal(r.missing, 0);
  assert.deepEqual(validatePlan(s, r.plan).issues, []);
  s.projects.forEach((p) => (p.capacity = [1, 1]));
  const short = allocate(s);
  assert.ok(short.missing > 0);
  assert.deepEqual(
    validatePlan(s, short.plan, { allowOutside: true }).issues,
    [],
  );
});
test("together and apart rules hold in both blocks and survive fixed assignments", () => {
  const s = initialState();
  s.children = Array.from({ length: 12 }, (_, i) => ({
    id: `K${i}`, choices: s.projects.map((p) => p.id),
  }));
  s.relations = [
    { a: "K0", b: "K1", kind: "together" },
    { a: "K1", b: "K2", kind: "apart" },
    { a: "K1", b: "K3", kind: "together" },
  ];
  s.assignments.K0 = ["1", "2"];
  s.fixed = ["K0"];
  const { plan, missing } = allocate(s);
  assert.equal(missing, 0);
  assert.deepEqual(plan.K0, ["1", "2"]);
  assert.deepEqual(plan.K1, plan.K0);
  assert.deepEqual(plan.K3, plan.K0);
  assert.notEqual(plan.K2[0], plan.K1[0]);
  assert.notEqual(plan.K2[1], plan.K1[1]);
  assert.deepEqual(validatePlan(s, plan, { complete: true }).issues, []);
  plan.K2[0] = plan.K1[0];
  assert.match(validatePlan(s, plan).issues.join(" "), /nicht zusammen/);
});

test("impossible together rules fail instead of producing an invalid proposal", () => {
  const s = initialState();
  s.children = ["K0", "K1"].map((id) => ({ id, choices: ["1", "2", "3", "4"] }));
  s.projects.forEach((p) => { p.capacity = [1, 1]; });
  s.relations = [{ a: "K0", b: "K1", kind: "together" }];
  assert.throws(() => allocate(s), /keine zwei gemeinsamen/);
});

test("admin rules are shared and server rejects contradictory manual assignments", async () => {
  const { request } = await setup();
  let a = await request("/admin");
  a = await request("/admin", { action: "children", count: 2, revision: a.data.revision });
  a = await request("/admin", {
    action: "relations", revision: a.data.revision,
    relations: [{ a: "K001", b: "K002", kind: "apart" }],
  });
  assert.equal(a.status, 200);
  assert.equal(a.data.state.relations.length, 1);
  assert.equal((await request("/admin", {
    action: "plan", revision: a.data.revision, allowOutside: true,
    plan: { K001: ["1", "2"], K002: ["1", "3"] },
  })).status, 400);
  assert.equal((await request("/admin", {
    action: "relations", revision: a.data.revision,
    relations: [
      { a: "K001", b: "K002", kind: "apart" },
      { a: "K002", b: "K001", kind: "together" },
    ],
  })).status, 400);
});
test("CSV round-trip handles quotes, semicolons, umlauts, formulas and mismatched codes", () => {
  const children = [{ id: "K001", code: "ABCDEFGHJKLMNPQR" }];
  const names = { K001: 'Müller; "Anna"' };
  assert.deepEqual(
    importCodeNames(exportCodes(children, names), children),
    names,
  );
  const formula = { K001: "=1+1" };
  assert.ok(exportCodes(children, formula).includes("'=1+1"));
  assert.deepEqual(
    importCodeNames(exportCodes(children, formula), children),
    formula,
  );
  assert.throws(() =>
    importCodeNames("Kennung;Wahlcode;Name\nK001;falsch;Anna", children),
  );
});
test("Excel template round-trip validates choices and keeps names separate", async () => {
  const s = initialState();
  s.children = [{ id: "K001", choices: ["1", "2", "3", "4"] }, { id: "K002", choices: [] }];
  const file = await makeChoiceTemplate(s, { K001: "Müller Anna" });
  const parsed = await parseChoiceTemplate(file, s);
  assert.deepEqual(parsed.rows, [{ id: "K001", choices: ["1", "2", "3", "4"] }, { id: "K002", choices: [] }]);
  assert.deepEqual(parsed.names, { K001: "Müller Anna" });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file);
  workbook.getWorksheet("Vorauswahl").getCell("C6").value = "falsch";
  await assert.rejects(parseChoiceTemplate(await workbook.xlsx.writeBuffer(), s), /nur mit x/);
});
test("API protects admin data, imports complete choices and prevents stale overwrites", async () => {
  const { request } = await setup();
  assert.equal((await request("/admin", undefined, "wrong")).status, 401);
  let a = await request("/admin");
  a = await request("/admin", {
    action: "children",
    count: 4,
    revision: a.data.revision,
  });
  assert.equal(a.status, 200);
  const oldRevision = a.data.revision;
  assert.equal(new Set(a.data.state.children.map((c) => c.code)).size, 4);
  a = await request("/admin", {
    action: "choices",
    rows: a.data.state.children.map((c) => ({ id: c.id, choices: ["1", "2", "3", "4"] })),
    revision: oldRevision,
  });
  assert.equal(
    (
      await request("/admin", {
        action: "choices",
        rows: [],
        revision: oldRevision,
      })
    ).status,
    409,
  );
  const codes = a.data.state.children.map((c) => c.code);
  a = await request("/admin");
  assert.ok(a.data.state.children.every((c) => c.version === 1));
  assert.equal(
    (
      await request("/choice", { choices: ["1", "2", "3", "4"], version: 1 }, codes[0])
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/admin", { action: "choices", rows: [{ id: "K001", choices: ["1", "1", "2", "3"] }], revision: a.data.revision })
    ).status,
    400,
  );
  const publicRes = await request("/public");
  assert.equal(publicRes.data.children, undefined);
  assert.equal(JSON.stringify(publicRes.data).includes(codes[0]), false);
  assert.equal((await request("/me", {}, codes[0])).data.id, "K001");
});
test("reject invalid plans, child choices, invalid origins and unknown payloads", async () => {
  const { request, env } = await setup();
  let a = await request("/admin");
  a = await request("/admin", {
    action: "children",
    count: 1,
    revision: a.data.revision,
  });
  const c = a.data.state.children[0];
  assert.equal(
    (
      await request(
        "/choice",
        { choices: ["1", "2", "3", "4"], version: 0 },
        c.code,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/admin", {
        action: "plan",
        plan: { K001: ["1", "1"] },
        revision: a.data.revision,
        allowOutside: true,
      })
    ).status,
    400,
  );
  assert.equal(
    (await request("/admin", { action: "finalize", revision: a.data.revision }))
      .status,
    400,
  );
  assert.equal(
    (
      await worker.fetch(
        new Request("https://api.test/public", {
          headers: { Origin: "https://evil.test" },
        }),
        env,
      )
    ).status,
    403,
  );
});
test("100 choices are imported in one atomic admin update", async () => {
  const { request } = await setup();
  let a = await request("/admin");
  a = await request("/admin", {
    action: "children",
    count: 100,
    revision: a.data.revision,
  });
  const rows = a.data.state.children.map((c) => ({ id: c.id, choices: ["1", "2", "3", "4"] }));
  assert.equal((await request("/admin", { action: "choices", rows: rows.slice(1), revision: a.data.revision })).status, 400);
  a = await request("/admin", { action: "choices", rows, revision: a.data.revision });
  assert.equal(a.status, 200);
  const final = await request("/admin");
  assert.equal(
    final.data.state.children.filter((c) => c.version === 1).length,
    100,
  );
});

test("admin reset clears test children but preserves offers", async () => {
  const { request } = await setup();
  let a = await request("/admin");
  a = await request("/admin", { action: "children", count: 2, revision: a.data.revision });
  const previousKey = a.data.state.accessKey;
  const titles = a.data.state.projects.map((p) => p.title);
  a = await request("/admin", { action: "reset", revision: a.data.revision });
  assert.equal(a.status, 200);
  assert.equal(a.data.state.children.length, 0);
  assert.deepEqual(a.data.state.projects.map((p) => p.title), titles);
  assert.notEqual(a.data.state.accessKey, previousKey);
});

test("four-digit codes are unique and protected by project link and attempt limit", async () => {
  const { env, request } = await setup();
  let a = await request("/admin");
  a = await request("/admin", {
    action: "children",
    count: 200,
    revision: a.data.revision,
  });
  const codes = a.data.state.children.map((c) => c.code);
  assert.equal(new Set(codes).size, 200);
  assert.ok(codes.every((code) => /^[1-9][0-9]{3}$/.test(code)));
  const wrongLink = await worker.fetch(
    new Request("https://api.test/me", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + codes[0],
      },
      body: "{}",
    }),
    env,
  );
  assert.equal(wrongLink.status, 401);
  assert.equal((await request("/me", {}, codes[0])).status, 200);
  for (let i = 0; i < 14; i++)
    assert.equal((await request("/me", {}, "0000")).status, 401);
  assert.equal((await request("/me", {}, codes[0])).status, 429);
  await env.DB.prepare("UPDATE login_attempts SET expires=0").run();
  assert.equal((await request("/me", {}, codes[0])).status, 200);
});
