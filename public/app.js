import { API_URL } from "./config.js";
import { allocate, validatePlan, isWintermarktband, WALD_PROJECT_ID } from "./model.js";
import { makeRosterTemplate, makeDummyRosterTemplate, parseRosterTemplate } from "./excel.js";
import { DAYS, dailySchedule, groupAttendance } from "./schedule.js";
const $ = (s) => document.querySelector(s),
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
let publicData = null,
  snapshot = null,
  role = "public",
  tab = "overview",
  adminKey = "",
  importDraft = null,
  dirty = false,
  loading = false,
  names = {},
  timer;
const namesKey = "projektwoche-names:" + API_URL;
const introReady = new Promise((resolve) => setTimeout(resolve, 850));
let pendingWrites = 0;
try {
  names = JSON.parse(localStorage.getItem(namesKey) || "{}");
} catch {
  names = {};
}
function notice(message) {
  $("#notice").textContent = message;
  $("#notice").classList.add("visible");
  clearTimeout(timer);
  timer = setTimeout(() => $("#notice").classList.remove("visible"), 8000);
}
async function api(path, { body, key } = {}) {
  if (!API_URL) throw Error("Die Online-Verbindung wird noch eingerichtet.");
  if (body) {
    pendingWrites++;
    $("#busy-owl").hidden = false;
  }
  try {
    const r = await fetch(API_URL + path, {
      method: body ? "POST" : "GET",
      cache: "no-store",
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(key ? { Authorization: "Bearer " + key } : {}),
      },
      signal: AbortSignal.timeout(15000),
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json();
    if (!r.ok)
      throw Object.assign(new Error(data.error || "Anfrage fehlgeschlagen."), {
        status: r.status,
      });
    return data;
  } finally {
    if (body) {
      pendingWrites--;
      $("#busy-owl").hidden = pendingWrites === 0;
    }
  }
}
function state() {
  return snapshot.state;
}
const name = (id) => names[id] || id;
const projectName = (id) =>
  state().projects.find((p) => p.id === id)?.title || "Noch offen";
const offerTone = (id) => `offer-tone-${Number(id) || 1}`;
function blocks() {
  return '<div class="blocks"><div class="block"><small>BLOCK 01</small><strong>Mo. + Di.</strong><small>Dein erster Posten</small></div><div class="block"><small>BLOCK 02</small><strong>Mi. + Do.</strong><small>Dein zweiter Posten</small></div></div>';
}
async function refresh() {
  try {
    const editing = document.activeElement?.matches("input,textarea,select");
    if (role === "admin" && adminKey) {
      const data = await api("/admin", { key: adminKey });
      if (dirty) {
        if (data.revision !== snapshot?.revision)
          $("#connection").textContent =
            "Neuer Stand verfügbar · Entwurf bleibt erhalten";
        return;
      }
      const changed = data.revision !== snapshot?.revision;
      snapshot = data;
      if (changed && !editing) render();
    } else {
      const data = await api("/public");
      if (!publicData) await introReady;
      const changed = data.revision !== publicData?.revision;
      publicData = data;
      if (changed && !dirty && !editing) {
        render();
      }
    }
    $("#connection").textContent =
      "Online · Stand " +
      new Date().toLocaleTimeString("de-CH", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
  } catch (e) {
    $("#connection").textContent = "Keine Verbindung · nochmals versuchen";
    if (!publicData && !snapshot) renderError(e.message);
  }
}
function renderError(msg) {
  $("#app").innerHTML =
    `<div class="panel login"><h1>Verbindung fehlt</h1><p>${esc(msg)}</p><button id="retry">Erneut verbinden</button></div>`;
  $("#retry").onclick = refresh;
}
function render() {
  if (role === "admin") {
    if (!adminKey || !snapshot) renderAdminLogin();
    else renderAdmin();
  } else renderPublic();
}
$("#switch-role").onclick = () => {
  if (dirty && !confirm("Ungespeicherten Entwurf verwerfen?")) return;
  dirty = false;
  role = role === "public" ? "admin" : "public";
  $("#switch-role").textContent =
    role === "public" ? "Lehrpersonen" : "Zu den Angeboten";
  render();
  refresh();
};
function renderPublic() {
  if (!publicData) {
    renderError("Die Angebote konnten noch nicht geladen werden.");
    return;
  }
  const p = publicData;
  $("#app").innerHTML =
    `<section class="intro"><div><span class="eyebrow">${esc(p.title)}</span><h1>Unsere neun Posten</h1><p>Jedes Kind besucht zwei verschiedene Posten – jeweils zwei Tage lang. Die Lehrpersonen erfassen die Befragung und erstellen die Gruppeneinteilung.</p></div>${blocks()}</section>
 <div class="grid">${p.projects.map((offer, i) => `<article class="card offer-card ${offerTone(offer.id)}" data-card="${offer.id}"><span class="number">${String(i + 1).padStart(2, "0")}</span><h3>${esc(offer.title)}</h3><p>${esc(offer.description)}</p></article>`).join("")}</div>`;
}
function renderAdminLogin() {
  $("#app").innerHTML =
    `<section class="panel login"><span class="eyebrow">Lehrpersonen</span><h1>Die Woche gemeinsam planen.</h1><p>Melde dich mit dem geschützten Lehrpersonencode an. Mehrere Lehrpersonen können gleichzeitig arbeiten.</p><form id="admin-login"><label class="field">Lehrpersonencode<input type="password" name="key" required autocomplete="current-password"></label><button>Anmelden</button></form><p class="small">Die Anmeldung gilt bis zum Abmelden oder Schliessen dieser Seite.</p></section>`;
  $("#admin-login").onsubmit = async (e) => {
    e.preventDefault();
    const key = new FormData(e.target).get("key").trim();
    try {
      snapshot = await api("/admin", { key });
      adminKey = key;
      tab = "overview";
      render();
      refresh();
    } catch (e) {
      notice(e.message);
    }
  };
}
async function save(body) {
  if (loading) return;
  loading = true;
  try {
    const result = await api("/admin", {
      key: adminKey,
      body: { ...body, revision: snapshot.revision },
    });
    snapshot = result;
    dirty = false;
    render();
    notice("Gemeinsamer Stand gespeichert.");
    return true;
  } catch (e) {
    notice(e.message);
    return false;
  } finally {
    loading = false;
  }
}
function renderAdmin() {
  const s = state(),
    answered = s.children.filter((c) => c.choices.length >= 4).length;
  $("#app").innerHTML =
    `<section class="intro no-print"><div><span class="eyebrow">Planungsraum</span><h1>${esc(s.title)}</h1><p>Neun Angebote. Zwei Blöcke. Alle arbeiten am gleichen Stand.</p></div><div class="row"><span class="pill">Vorauswahl per Excel</span><button id="logout" class="quiet">Abmelden</button></div></section>
 <nav class="no-print">${[
   ["overview", "Übersicht"],
   ["projects", "Angebote"],
   ["children", "Kinderliste"],
   ["choices", "Wahlübersicht"],
   ["plan", "Gruppenplanung"],
   ["print", "Drucken"],
 ]
   .map(
     ([id, label]) =>
       `<button data-tab="${id}" class="${tab === id ? "active" : ""}">${label}</button>`,
   )
   .join("")}</nav>
 <div class="no-print row between" style="margin-bottom:18px"><span class="small">${dirty ? "Ungespeicherter Entwurf" : "Gemeinsamer Stand"} · Version ${snapshot.revision}</span><button id="reload" class="quiet mini">Aktuellen Stand laden</button></div><section id="content"></section>`;
  $("#logout").onclick = () => {
    if (dirty && !confirm("Ungespeicherten Entwurf verwerfen?")) return;
    adminKey = "";
    snapshot = null;
    dirty = false;
    render();
  };
  document.querySelectorAll("[data-tab]").forEach(
    (button) =>
      (button.onclick = () => {
        if (dirty && !confirm("Ungespeicherten Entwurf verwerfen?")) return;
        dirty = false;
        tab = button.dataset.tab;
        render();
        refresh();
      }),
  );
  $("#reload").onclick = () => {
    if (
      dirty &&
      !confirm("Deinen Entwurf verwerfen und den aktuellen Stand laden?")
    )
      return;
    dirty = false;
    snapshot = null;
    api("/admin", { key: adminKey })
      .then((data) => {
        snapshot = data;
        render();
      })
      .catch((e) => notice(e.message));
  };
  if (tab === "overview") {
    $("#content").innerHTML =
      `<div class="stats"><div class="stat"><strong>${s.children.length}</strong>Kinder erfasst</div><div class="stat"><strong>${answered} / ${s.children.length}</strong>Vorauswahlen erfasst</div><div class="stat"><strong>${Object.values(s.assignments).filter((p) => p?.every(Boolean)).length}</strong>vollständig zugeteilt</div></div><div class="panel"><h2>So entsteht eure Projektwoche</h2><ol><li><p>Unter «Angebote» die neun Posten und Plätze prüfen.</p></li><li><p>Unter «Kinderliste» die Excel-Liste herunterladen, Kürzel und Namen eintragen und die Kinder befragen.</p></li><li><p>In der Excel-Liste mindestens vier Posten pro befragtem Kind markieren und die Liste importieren.</p></li><li><p>Gruppenvorgaben ergänzen, Verteilung vorschlagen lassen und prüfen.</p></li><li><p>Den Plan freigeben und die Gruppenlisten drucken.</p></li></ol><span class="small">${s.planStatus === "final" ? "Plan freigegeben" : "Plan ist ein Entwurf"}</span></div>`;
  }
  if (tab === "projects") renderProjects();
  if (tab === "children") renderChildren();
  if (tab === "choices") renderChoices();
  if (tab === "plan") renderPlan();
  if (tab === "print") renderPrint();
}
function renderProjects() {
  const s = state();
  $("#content").innerHTML =
    `<form id="projects-form"><div class="panel"><label class="field">Titel der Projektwoche<input name="title" value="${esc(s.title)}" maxlength="100" required></label><p class="small">0 Plätze bedeutet: Das Angebot findet in diesem Block nicht statt.</p></div><div class="grid">${s.projects.map((p) => `<article class="card offer-card ${offerTone(p.id)}"><span class="number">${p.id.padStart(2, "0")}</span><label class="field">Name des Angebots<input name="title-${p.id}" value="${esc(p.title)}" maxlength="100" required></label><label class="field">Beschreibung<textarea name="desc-${p.id}" maxlength="2000" required>${esc(p.description)}</textarea></label><div class="row"><label class="field">Plätze Mo. + Di.<input type="number" name="a-${p.id}" value="${p.capacity[0]}" min="0" max="200" required></label><label class="field">Plätze Mi. + Do.<input type="number" name="b-${p.id}" value="${p.capacity[1]}" min="0" max="200" required></label></div></article>`).join("")}</div><div class="savebar"><span>Änderungen gelten auf allen PCs.</span><button>Angebote speichern</button></div></form>`;
  $("#projects-form").oninput = () => (dirty = true);
  $("#projects-form").onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    save({
      action: "projects",
      title: f.get("title"),
      projects: s.projects.map((p) => ({
        id: p.id,
        title: f.get("title-" + p.id),
        description: f.get("desc-" + p.id),
        capacity: [Number(f.get("a-" + p.id)), Number(f.get("b-" + p.id))],
      })),
    });
  };
}
function renderChildren() {
  const s = state();
  $("#content").innerHTML =
    `<div class="panel"><h2>Kinderliste und Vorauswahl</h2><p>Eine Excel-Datei enthält pro Kind Kürzel, Name und die angekreuzten Angebote. Lade die aktuelle Liste herunter, ergänze sie und importiere sie wieder. Der Import ersetzt die gemeinsame Kinderliste und die Wahlen. Namen bleiben ausschliesslich auf diesem Gerät.</p><div class="row"><button id="download-roster">Excel-Liste herunterladen</button><button id="download-dummy" class="quiet">Dummy-Liste zum Test herunterladen</button><label class="button quiet">Excel-Liste importieren<input id="import-roster" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style="display:none"></label></div><p class="small">Die Dummy-Liste enthält 18 fiktive Kinder mit je fünf angekreuzten Angeboten. Ein Import ersetzt die gesamte aktuelle Kinderliste.</p><div id="import-preview"></div></div><div class="panel"><div class="row between"><h2>Aktuelle Liste · ${s.children.length} Kinder</h2><button id="forget-names" class="quiet">Lokale Namen hier entfernen</button></div><p class="small">Online werden nur Kürzel und Wahlen gespeichert. Für Namen auf einem anderen PC die Excel-Liste dort importieren.</p><div class="table-wrap"><table><thead><tr><th>Kürzel</th><th>Name · nur lokal</th><th>Gewählte Posten</th><th>Status</th></tr></thead><tbody>${s.children.map((c) => `<tr><td>${esc(c.id)}</td><td>${esc(names[c.id] || "—")}</td><td>${c.choices.map((id) => esc(s.projects.find((p) => p.id === id)?.title || id)).join(", ") || "—"}</td><td>${c.choices.length >= 4 ? "Erfasst" : "Offen"}</td></tr>`).join("")}</tbody></table></div></div>`;
  $("#download-roster").onclick = async () => {
    try { download("projektwoche-kinderliste.xlsx", await makeRosterTemplate(s, names), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"); }
    catch (e) { notice("Excel-Liste konnte nicht erstellt werden: " + e.message); }
  };
  $("#download-dummy").onclick = async () => {
    try { download("projektwoche-dummy-kinderliste.xlsx", await makeDummyRosterTemplate(s), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"); }
    catch (e) { notice("Dummy-Liste konnte nicht erstellt werden: " + e.message); }
  };
  $("#import-roster").onchange = async (event) => {
    try {
      const file = event.target.files[0];
      if (!file) return;
      if (file.size > 2_000_000) throw Error("Excel-Datei ist zu gross.");
      const parsed = await parseRosterTemplate(await file.arrayBuffer(), s);
      importDraft = { ...parsed, revision: snapshot.revision };
      $("#import-preview").innerHTML = `<div class="success"><strong>Import geprüft</strong><p>${parsed.rows.length} Kinder · ${parsed.answered} mit mindestens vier Wünschen · ${parsed.rows.length - parsed.answered} noch offen. Beim Speichern wird die bisherige Kinderliste ersetzt.</p><button id="save-import">Kinderliste und Wahlen speichern</button></div>`;
      $("#save-import").onclick = async () => {
        const draft = importDraft;
        if (!draft || snapshot.revision !== draft.revision) { notice("Der gemeinsame Stand hat sich geändert. Bitte die Datei erneut auswählen."); return; }
        const result = await save({ action: "roster", rows: draft.rows });
        if (result) {
          names = draft.names;
          try { localStorage.setItem(namesKey, JSON.stringify(names)); }
          catch { notice("Wahlen gespeichert, aber Namen konnten lokal nicht gesichert werden. Bitte die Excel-Liste aufbewahren."); }
          importDraft = null;
          render();
        }
      };
    } catch (e) { importDraft = null; $("#import-preview").innerHTML = ""; notice(e.message); }
  };
  $("#forget-names").onclick = () => {
    if (confirm("Alle lokal gespeicherten Namen auf diesem PC entfernen?")) {
      names = {};
      localStorage.removeItem(namesKey);
      render();
    }
  };
}
function renderChoices() {
  const s = state();
  $("#content").innerHTML =
    `<div class="panel"><h2>Wahlübersicht</h2><p class="small">Die Häkchen zeigen gleichwertige Wünsche. Namen erscheinen nur, wenn die Kinderliste auf diesem PC importiert wurde.</p><div class="table-wrap"><table><thead><tr><th>Kind</th>${s.projects.map((p) => `<th class="center" title="${esc(p.title)}">${esc(p.title)}</th>`).join("")}<th>Status</th></tr></thead><tbody>${s.children.map((c) => `<tr><td>${esc(name(c.id))}<br><span class="small">${esc(c.id)}</span></td>${s.projects.map((p) => `<td class="center">${c.choices.includes(p.id) ? "✓" : "—"}</td>`).join("")}<td>${c.choices.length >= 4 ? "Erfasst" : "Offen"}</td></tr>`).join("")}</tbody></table></div></div>`;
}
function renderPlan() {
  const s = state(),
    check = validatePlan(s, s.assignments, { allowOutside: true });
  $("#content").innerHTML =
    `<div class="panel"><div class="row between"><div><h2>Gruppen für zwei Blöcke</h2><p class="small">Der Vorschlag berücksichtigt die Wünsche und gleicht Gruppengrössen aus. Fixierte Kinder bleiben an ihrem Platz.</p></div><button id="generate" ${!s.children.length ? "disabled" : ""}>Verteilung vorschlagen</button></div><div class="grid">${s.projects.map((p, i) => `<div class="offer-summary ${offerTone(p.id)}"><h3>${esc(p.title)}</h3><p class="small">Mo. + Di. <strong>${check.counts[i][0]} / ${p.capacity[0]}</strong><br>Mi. + Do. <strong>${check.counts[i][1]} / ${p.capacity[1]}</strong></p></div>`).join("")}</div></div><div class="panel"><div class="table-wrap"><table><thead><tr><th>Kind</th><th>Mo. + Di.</th><th>Mi. + Do.</th><th>Fixieren</th></tr></thead><tbody>${s.children.map((c) => `<tr><td>${esc(name(c.id))}<br><span class="small">${c.id}</span></td>${[0, 1].map((b) => `<td><select data-assign="${c.id}" data-block="${b}" aria-label="${c.id}, Block ${b + 1}" ${s.fixed.includes(c.id) ? "disabled" : ""}><option value="">Noch offen</option>${s.projects.map((p) => `<option value="${p.id}" ${s.assignments[c.id]?.[b] === p.id ? "selected" : ""}>${esc(p.title)}${c.choices.includes(p.id) ? " ✓" : " · nicht gewählt"}</option>`).join("")}</select></td>`).join("")}<td><input type="checkbox" data-fix="${c.id}" aria-label="${c.id} fixieren" ${s.fixed.includes(c.id) ? "checked" : ""}></td></tr>`).join("")}</tbody></table></div><div id="plan-feedback"></div><label class="choose" style="margin:20px 0"><input type="checkbox" id="allow-outside">Ich bestätige Zuteilungen ausserhalb der gewählten Angebote.</label><div class="row"><button id="save-plan">Änderungen speichern</button><button id="finalize" class="quiet" >Plan freigeben</button></div><p class="small">Neue Änderungen machen den Plan wieder zum Entwurf. Die Einteilung kann unter «Drucken» ausgegeben werden.</p></div>`;
  const rules = s.relations || [];
  const childOptions = s.children.map((c) => `<option value="${esc(c.id)}">${esc(name(c.id))} (${esc(c.id)})</option>`).join("");
  $("#content").insertAdjacentHTML("afterbegin",
    `<div class="panel"><h2>Wer soll zusammen sein?</h2><p class="small">Diese Vorgaben gelten in beiden Blöcken. «Zusammen» bedeutet zweimal derselbe Posten; «nicht zusammen» bedeutet zweimal verschiedene Gruppen. Die Kinder sehen diese Vorgaben nicht.</p><form id="relation-form" class="row"><label class="field">Erstes Kind<select name="a" required><option value="">Bitte wählen</option>${childOptions}</select></label><label class="field">Zweites Kind<select name="b" required><option value="">Bitte wählen</option>${childOptions}</select></label><label class="field">Vorgabe<select name="kind"><option value="together">Sicher zusammen</option><option value="apart">Sicher nicht zusammen</option></select></label><button ${s.children.length < 2 ? "disabled" : ""}>Vorgabe hinzufügen</button></form>${rules.length ? `<div class="table-wrap"><table><thead><tr><th>Kind 1</th><th>Kind 2</th><th>Vorgabe</th><th></th></tr></thead><tbody>${rules.map((rule, i) => `<tr><td>${esc(name(rule.a))} <span class="small">${esc(rule.a)}</span></td><td>${esc(name(rule.b))} <span class="small">${esc(rule.b)}</span></td><td>${rule.kind === "together" ? "Sicher zusammen" : "Sicher nicht zusammen"}</td><td><button type="button" class="quiet mini" data-remove-rule="${i}" aria-label="Vorgabe für ${esc(rule.a)} und ${esc(rule.b)} entfernen">Entfernen</button></td></tr>`).join("")}</tbody></table></div>` : '<p class="small">Noch keine Vorgaben.</p>'}</div>`);
  $("#relation-form").onsubmit = (event) => {
    event.preventDefault();
    if (dirty) { notice("Zuerst die Zuteilung speichern oder neu laden."); return; }
    const form = new FormData(event.target), a = form.get("a"), b = form.get("b");
    if (a === b) { notice("Bitte zwei verschiedene Kinder wählen."); return; }
    save({ action: "relations", relations: [...rules, { a, b, kind: form.get("kind") }] });
  };
  document.querySelectorAll("[data-remove-rule]").forEach((button) =>
    button.onclick = () => {
      if (dirty) { notice("Zuerst die Zuteilung speichern oder neu laden."); return; }
      save({ action: "relations", relations: rules.filter((_, i) => i !== Number(button.dataset.removeRule)) });
    });
  const bandIds = s.wintermarktband || [];
  const bandConflicts = bandIds.flatMap((id) =>
    (s.assignments[id] || []).map((project, block) =>
      project === WALD_PROJECT_ID ? { id, block } : null).filter(Boolean));
  $("#content").insertAdjacentHTML("afterbegin",
    `<div class="panel band-panel"><span class="eyebrow">Zusatzangebot</span><h2>Wintermarktband</h2><p>Teilnehmende Kinder sind an jedem Morgen von <strong>08.20–09.55 Uhr</strong> in der Wintermarktband. Ihr eingeteilter Posten beginnt für sie erst um <strong>10.25 Uhr</strong> und dauert bis <strong>12.00 Uhr</strong>.</p><form id="band-form" class="row"><label class="field">Kind auswählen<select name="child" required><option value="">Bitte wählen</option>${s.children.filter((c) => !bandIds.includes(c.id)).map((c) => `<option value="${esc(c.id)}">${esc(name(c.id))} (${esc(c.id)})</option>`).join("")}</select></label><button ${bandIds.length === s.children.length ? "disabled" : ""}>Zur Wintermarktband hinzufügen</button></form><div class="band-list">${bandIds.length ? bandIds.map((id) => `<span class="band-chip">${esc(name(id))} <small>${esc(id)}</small><button class="quiet mini" data-remove-band="${esc(id)}" aria-label="${esc(name(id))} aus der Wintermarktband entfernen">Entfernen</button></span>`).join("") : '<span class="small">Noch kein Kind ausgewählt.</span>'}</div>${bandConflicts.map(({ id, block }) => `<p class="band-conflict">⚠ ${esc(name(id))} (${esc(id)}) ist in Block ${block + 1} bei Waldtage und Basteln eingeteilt. Nach Beginn ist kein Dazustossen möglich. Bitte in eine andere Gruppe umteilen.</p>`).join("")}</div>`);
  $("#band-form").onsubmit = (event) => {
    event.preventDefault();
    if (dirty) { notice("Zuerst die Zuteilung speichern oder neu laden."); return; }
    const id = new FormData(event.target).get("child");
    if (!id || bandIds.includes(id)) return;
    save({ action: "wintermarktband", children: [...bandIds, id] });
  };
  document.querySelectorAll("[data-remove-band]").forEach((button) =>
    button.onclick = () => {
      if (dirty) { notice("Zuerst die Zuteilung speichern oder neu laden."); return; }
      save({ action: "wintermarktband", children: bandIds.filter((id) => id !== button.dataset.removeBand) });
    });
  let draft = structuredClone(s.assignments);
  const feedback = () => {
    const c = validatePlan(s, draft, { allowOutside: true });
    const missing = s.children.filter(
      (k) => !(draft[k.id] || []).length || (draft[k.id] || []).some((x) => !x),
    ).length;
    const conflicts = c.issues.filter((issue) => issue.includes("Wintermarktband und Waldtage"));
    $("#plan-feedback").innerHTML =
      `<div class="warning">${missing} Kinder noch nicht vollständig zugeteilt.${c.issues.length ? " " + esc(c.issues.join(" ")) : ""} ${dirty ? "Vorschlag noch nicht gespeichert." : ""}</div>${conflicts.map((issue) => `<p class="band-conflict">⚠ ${esc(issue)}</p>`).join("")}`;
    document.querySelectorAll("[data-assign]").forEach((select) =>
      select.closest("tr").classList.toggle("band-conflict-row", isWintermarktband(s, select.dataset.assign) && (draft[select.dataset.assign] || []).includes(WALD_PROJECT_ID)));
  };
  feedback();
  document.querySelectorAll("[data-assign]").forEach(
    (select) =>
      (select.onchange = () => {
        draft[select.dataset.assign] ||= [null, null];
        draft[select.dataset.assign][Number(select.dataset.block)] =
          select.value || null;
        dirty = true;
        feedback();
      }),
  );
  document.querySelectorAll("[data-fix]").forEach(
    (input) =>
      (input.onchange = () => {
        if (dirty) {
          notice("Zuerst die Zuteilung speichern, dann fixieren.");
          input.checked = !input.checked;
          return;
        }
        save({
          action: "fixed",
          fixed: input.checked
            ? [...s.fixed, input.dataset.fix]
            : s.fixed.filter((id) => id !== input.dataset.fix),
        });
      }),
  );
  $("#generate").onclick = async () => {
    if (
      dirty &&
      !confirm("Ungespeicherte Änderungen durch neuen Vorschlag ersetzen?")
    )
      return;
    const btn = $("#generate");
    btn.disabled = true;
    btn.textContent = "Verteilung wird berechnet …";
    await new Promise((r) => setTimeout(r, 20));
    try {
      const result = allocate(s);
      draft = result.plan;
      dirty = true;
      document
        .querySelectorAll("[data-assign]")
        .forEach(
          (select) =>
            (select.value =
              draft[select.dataset.assign]?.[Number(select.dataset.block)] ||
              ""),
        );
      feedback();
      notice(
        result.missing
          ? `Für ${result.missing} Blockplätze wurde keine passende Zuteilung gefunden. Wünsche oder Kapazitäten prüfen.`
          : "Vorschlag erstellt. Bitte prüfen und speichern.",
      );
    } catch (e) {
      notice(e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "Verteilung vorschlagen";
    }
  };
  $("#save-plan").onclick = () =>
    save({
      action: "plan",
      plan: draft,
      allowOutside: $("#allow-outside").checked,
    });
  $("#finalize").onclick = () => {
    if (dirty) {
      notice("Bitte zuerst Änderungen speichern.");
      return;
    }
    save({ action: "finalize" });
  };
}
function renderPrint() {
  const s = state();
  $("#content").innerHTML =
    `<div class="panel no-print"><h2>Druckübersichten</h2><p>Jede Gruppenliste zeigt für einen Tag, welche Kinder um 08.20 Uhr und welche erst um 10.25 Uhr zum Posten kommen. Namen werden nur auf diesem PC ergänzt.</p><div class="row"><label class="field">Druckformat<select id="print-type"><option value="groups">Postenliste je Tag</option><option value="band">Wintermarktband je Tag</option><option value="all">Gesamtübersicht</option><option value="personal">Ablaufplan je Kind</option></select></label><label class="field" id="day-filter">Tag<select id="print-day"><option value="all">Alle Tage</option>${DAYS.map((d) => `<option value="${d.id}">${d.label}</option>`).join("")}</select></label><label class="field" id="offer-filter">Posten<select id="print-offer"><option value="all">Alle Posten</option>${s.projects.map((p) => `<option value="${p.id}">${esc(p.title)}</option>`).join("")}</select></label><button id="print">Drucken / PDF speichern</button></div>${s.planStatus !== "final" ? '<div class="warning">Der Gruppenplan ist noch ein Entwurf. Ausdrucke sind entsprechend gekennzeichnet.</div>' : ""}</div><div id="print-preview"></div>`;
  const heading = (title, subtitle, tone = "") =>
    `<div class="print-heading ${tone}"><span class="eyebrow">${esc(s.title)} · ${s.planStatus === "final" ? "Freigegeben" : "Entwurf"}</span><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div>`;
  const chip = (id) => id
    ? `<span class="offer-chip ${offerTone(id)}">${esc(projectName(id))}</span>`
    : '<span class="small">Noch offen</span>';
  const childLabel = (c) => `${esc(name(c.id))} <small class="small">${esc(c.id)}</small>`;
  const conflict = (id, dayId) => dailySchedule(s, id, dayId).conflict
    ? `<p class="band-conflict">⚠ ${esc(name(id))} kann nach der Wintermarktband nicht zu Waldtage und Basteln dazustossen. Bitte in eine andere Gruppe umteilen.</p>`
    : "";
  const show = () => {
    const type = $("#print-type").value,
      dayId = $("#print-day").value,
      offerId = $("#print-offer").value,
      days = DAYS.filter((d) => dayId === "all" || d.id === dayId);
    $("#day-filter").hidden = type === "all" || type === "personal";
    $("#offer-filter").hidden = type !== "groups";
    let html = "";
    if (type === "groups") {
      for (const day of days) for (const p of s.projects.filter((offer) => offerId === "all" || offer.id === offerId)) {
        const attendance = groupAttendance(s, p.id, day.id);
        if (!attendance.late.length && offerId === "all") continue;
        html += `<section class="panel print-page print-sheet ${offerTone(p.id)}">${heading(p.title, `${day.label} · ${attendance.late.length} Kinder · ${attendance.early.length} ab 08.20 Uhr`, offerTone(p.id))}<div class="print-times"><strong>08.20–09.55 Uhr</strong><span>Posten oder Wintermarktband</span><strong>10.25–12.00 Uhr</strong><span>Alle eingeteilten Kinder im Posten</span></div><table class="schedule-table"><thead><tr><th>Kind</th><th>Kürzel</th><th>08.20–09.55</th><th>10.25–12.00</th></tr></thead><tbody>${attendance.late.map((c) => `<tr class="${isWintermarktband(s, c.id) && p.id === WALD_PROJECT_ID ? "band-conflict-row" : ""}"><td>${esc(name(c.id))}</td><td>${esc(c.id)}</td><td>${isWintermarktband(s, c.id) ? "Wintermarktband" : "Hier"}</td><td>Hier</td></tr>`).join("")}</tbody></table>${attendance.conflict.map((c) => conflict(c.id, day.id)).join("")}<p class="print-foot">Stand: ${new Date().toLocaleString("de-CH")} · Bitte Anwesenheit und Wechsel vor Ort prüfen.</p></section>`;
      }
    } else if (type === "band") {
      for (const day of days) {
        const ids = s.wintermarktband || [];
        html += `<section class="panel print-page print-sheet band-sheet">${heading("Wintermarktband", `${day.label} · 08.20–09.55 Uhr · ${ids.length} Kinder`)}<table class="schedule-table"><thead><tr><th>Kind</th><th>Kürzel</th><th>Ab 10.25 Uhr im Posten</th></tr></thead><tbody>${ids.map((id) => `<tr><td>${esc(name(id))}</td><td>${esc(id)}</td><td>${chip(s.assignments[id]?.[day.block])}</td></tr>`).join("")}</tbody></table>${ids.map((id) => conflict(id, day.id)).join("")}<p class="print-foot">Ende Wintermarktband 09.55 Uhr · Nächster Posten ab 10.25 Uhr.</p></section>`;
      }
    } else if (type === "all") {
      html = `<section class="panel print-sheet">${heading("Gesamtübersicht", `${s.children.length} Kinder · Montag bis Donnerstag`)}<table class="schedule-table"><thead><tr><th>Kind</th><th>Kürzel</th><th>Mo. + Di.</th><th>Mi. + Do.</th><th>08.20–09.55 Uhr</th></tr></thead><tbody>${s.children.map((c) => `<tr><td>${esc(name(c.id))}</td><td>${esc(c.id)}</td><td>${chip(s.assignments[c.id]?.[0])}</td><td>${chip(s.assignments[c.id]?.[1])}</td><td>${isWintermarktband(s, c.id) ? "Wintermarktband" : "Eingeteilter Posten"}</td></tr>`).join("")}</tbody></table></section>`;
    } else if (type === "personal") {
      html = s.children.map((c) => `<section class="panel print-page print-sheet personal-sheet">${heading(`Ablaufplan · ${name(c.id)}`, `Kürzel ${c.id} · Montag bis Donnerstag`)}<table class="schedule-table personal-table"><thead><tr><th>Tag</th><th>08.20–09.55 Uhr</th><th>10.25–12.00 Uhr</th></tr></thead><tbody>${DAYS.map((day) => { const plan = dailySchedule(s, c.id, day.id); return `<tr class="${plan.conflict ? "band-conflict-row" : ""}"><th>${day.label}</th><td>${plan.band ? '<strong class="band-label">Wintermarktband</strong>' : chip(plan.early)}</td><td>${chip(plan.late)}</td></tr>`; }).join("")}</tbody></table>${DAYS.map((day) => conflict(c.id, day.id)).join("")}<p class="print-foot">Wechselpause 09.55–10.25 Uhr · Bei Änderungen gilt der aktuelle Plan der Lehrperson.</p></section>`).join("");
    }
    $("#print-preview").innerHTML = html || '<div class="panel">Für diese Auswahl sind noch keine Kinder eingeteilt.</div>';
  };
  $("#print-type").onchange = show;
  $("#print-day").onchange = show;
  $("#print-offer").onchange = show;
  $("#print").onclick = () => window.print();
  show();
}
function download(file, content, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = file;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
window.addEventListener("beforeunload", (event) => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});
setInterval(() => {
  if (!document.hidden && !loading) refresh();
}, 5000);
window.addEventListener("online", refresh);
refresh();
