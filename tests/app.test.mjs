import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { initialState, allocate, validatePlan } from "../public/model.js";
import ExcelJS from "exceljs";
import { makeRosterTemplate, parseRosterTemplate } from "../public/excel.js";
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
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
      env,
    );
    return { status: r.status, data: await r.json() };
  };
  return { env, request };
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

test("Excel-Liste rundum: Kürzel, Namen und Wahlen", async () => {
  const s = initialState();
  const blank = await makeRosterTemplate(s, {});
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(blank);
  const sheet = workbook.getWorksheet("Kinderliste");
  sheet.getCell("A5").value = "ab-1";
  sheet.getCell("B5").value = "Müller Anna";
  ["C5", "D5", "E5", "F5"].forEach((address) => { sheet.getCell(address).value = "x"; });
  sheet.getCell("A6").value = "cd_2";
  sheet.getCell("B6").value = "Meier Ben";
  const parsed = await parseRosterTemplate(await workbook.xlsx.writeBuffer(), s);
  assert.deepEqual(parsed.rows, [{ id: "AB-1", choices: ["1", "2", "3", "4"] }, { id: "CD_2", choices: [] }]);
  assert.deepEqual(parsed.names, { "AB-1": "Müller Anna", CD_2: "Meier Ben" });
  s.children = parsed.rows;
  const exported = await makeRosterTemplate(s, parsed.names);
  assert.deepEqual((await parseRosterTemplate(exported, s)).rows, parsed.rows);
  sheet.getCell("A6").value = "AB-1";
  await assert.rejects(parseRosterTemplate(await workbook.xlsx.writeBuffer(), initialState()), /doppelt/);
  sheet.getCell("A6").value = "CD_2";
  sheet.getCell("G6").value = "ja";
  await assert.rejects(parseRosterTemplate(await workbook.xlsx.writeBuffer(), initialState()), /nur mit x/);
});

test("Lehrpersonen importieren komplette Liste atomar und ohne Namen im Server", async () => {
  const { request } = await setup();
  assert.equal((await request("/admin", undefined, "wrong")).status, 401);
  let a = await request("/admin");
  const rows = [{ id: "AB-1", choices: ["1", "2", "3", "4"] }, { id: "CD_2", choices: [] }];
  a = await request("/admin", { action: "roster", rows: [{ ...rows[0], name: "Müller Anna" }, rows[1]], revision: a.data.revision });
  assert.equal(a.status, 200);
  assert.deepEqual(a.data.state.children, rows);
  assert.equal(JSON.stringify(a.data.state).includes("Müller"), false);
  assert.equal((await request("/admin", { action: "roster", rows, revision: 0 })).status, 409);
  assert.equal((await request("/admin", { action: "roster", rows: [rows[0], rows[0]], revision: a.data.revision })).status, 400);
  assert.equal((await request("/admin", { action: "roster", rows: [{ id: "ZZ", choices: ["1", "1", "2", "3"] }], revision: a.data.revision })).status, 400);
  assert.equal((await request("/me", {}, "1234")).status, 404);
  assert.equal((await request("/choice", {}, "1234")).status, 404);
  const publicRes = await request("/public");
  assert.equal(publicRes.data.children, undefined);
  assert.equal(publicRes.data.assignments, undefined);
});

test("Paarvorgaben bleiben online und entfernte Kürzel werden bereinigt", async () => {
  const { request } = await setup();
  let a = await request("/admin");
  a = await request("/admin", { action: "roster", rows: [
    { id: "A", choices: ["1", "2", "3", "4"] },
    { id: "B", choices: ["1", "2", "3", "4"] },
  ], revision: a.data.revision });
  a = await request("/admin", { action: "relations", revision: a.data.revision,
    relations: [{ a: "A", b: "B", kind: "apart" }] });
  assert.equal(a.status, 200);
  assert.equal((await request("/admin", {
    action: "plan", revision: a.data.revision, allowOutside: true,
    plan: { A: ["1", "2"], B: ["1", "3"] },
  })).status, 400);
  a = await request("/admin", { action: "roster", rows: [{ id: "A", choices: ["1", "2", "3", "4"] }], revision: a.data.revision });
  assert.equal(a.data.state.children.length, 1);
  assert.equal(a.data.state.relations.length, 0);
});

test("100 Kinderlisten-Zeilen werden gemeinsam gespeichert", async () => {
  const { request } = await setup();
  let a = await request("/admin");
  const rows = Array.from({ length: 100 }, (_, i) => ({
    id: "K" + String(i + 1).padStart(3, "0"),
    choices: ["1", "2", "3", "4", "5", "6", "7", "8", "9"],
  }));
  a = await request("/admin", { action: "roster", rows, revision: a.data.revision });
  assert.equal(a.status, 200);
  assert.equal(a.data.state.children.length, 100);
  assert.equal(allocate(a.data.state).missing, 0);
});

test("Reset löscht Kinder und bewahrt Angebote", async () => {
  const { request } = await setup();
  let a = await request("/admin");
  a = await request("/admin", { action: "roster", rows: [{ id: "AB", choices: [] }], revision: a.data.revision });
  const titles = a.data.state.projects.map((p) => p.title);
  a = await request("/admin", { action: "reset", revision: a.data.revision });
  assert.equal(a.status, 200);
  assert.equal(a.data.state.children.length, 0);
  assert.deepEqual(a.data.state.projects.map((p) => p.title), titles);
  assert.equal(a.data.state.accessKey, undefined);
});
