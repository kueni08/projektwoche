import { API_URL } from "./config.js";
import { allocate, validatePlan } from "./model.js";
import { exportCodes, importCodeNames } from "./csv.js";
import { makeChoiceTemplate, parseChoiceTemplate } from "./excel.js";
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
  role = "child",
  tab = "overview",
  adminKey = "",
  childCode = "",
  child = null,
  importDraft = null,
  dirty = false,
  loading = false,
  names = {},
  timer;
const namesKey = "projektwoche-names:" + API_URL;
const introReady = new Promise((resolve) => setTimeout(resolve, 850));
let projectKey =
  new URLSearchParams(location.hash.slice(1)).get("klasse") || "";
try {
  if (projectKey)
    sessionStorage.setItem("projektwoche-link:" + API_URL, projectKey);
  else
    projectKey = sessionStorage.getItem("projektwoche-link:" + API_URL) || "";
} catch {}
let pendingWrites = 0;
const childLink = () =>
  location.href.split("#")[0] + "#klasse=" + state().accessKey;
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
        ...(["/me", "/choice"].includes(path)
          ? { "X-Project-Key": projectKey }
          : {}),
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
        if (child && childCode) child = await api("/me", { body: {}, key: childCode });
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
  } else renderChild();
}
$("#switch-role").onclick = () => {
  if (dirty && !confirm("Ungespeicherten Entwurf verwerfen?")) return;
  dirty = false;
  role = role === "child" ? "admin" : "child";
  $("#switch-role").textContent =
    role === "child" ? "Lehrpersonen" : "Zur Kinderansicht";
  render();
  refresh();
};
function renderChild() {
  if (!publicData) {
    renderError("Die Angebote konnten noch nicht geladen werden.");
    return;
  }
  const p = publicData;
  $("#app").innerHTML =
    `<section class="intro"><div><span class="eyebrow">${esc(p.title)}</span><h1>Deine Projektwoche</h1><p>Du besuchst zwei verschiedene Posten – jeweils zwei Tage lang. Die Lehrpersonen erfassen eure Wünsche und teilen die Gruppen ein.</p></div>${blocks()}</section>
 ${!child ? `<form id="child-login" class="panel"><div class="row between"><div><h2>Dein persönlicher Code</h2><p class="small">Öffne den Kinderlink deiner Lehrperson und gib deinen vierstelligen Code ein. Hier siehst du später deine zwei Posten.</p></div><div class="row"><label class="field">Kindercode<input name="code" required autocomplete="off" spellcheck="false" placeholder="1234" inputmode="numeric" pattern="[1-9][0-9]{3}" minlength="4" maxlength="4"></label><button>Meine Posten ansehen</button></div></div></form>` : `<div class="panel row between"><div>Angemeldet als <strong>${esc(child.id)}</strong></div><button id="child-logout" class="quiet">Abmelden</button></div>`}
 ${child && !child.assignment ? '<div class="warning">Die Gruppeneinteilung wird vorbereitet. Schau später wieder vorbei.</div>' : ""}
 ${child?.assignment ? `<div class="success"><strong>Deine zwei Posten</strong><p>Mo. + Di.: ${esc(p.projects.find((x) => x.id === child.assignment[0])?.title)}<br>Mi. + Do.: ${esc(p.projects.find((x) => x.id === child.assignment[1])?.title)}</p></div>` : ""}
 <div class="grid">${p.projects.map((offer, i) => `<article class="card" data-card="${offer.id}"><span class="number">${String(i + 1).padStart(2, "0")}</span><h3>${esc(offer.title)}</h3><p>${esc(offer.description)}</p></article>`).join("")}</div>`;
  $("#child-login")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const button = e.target.querySelector("button");
    button.disabled = true;
    try {
      childCode = new FormData(e.target)
        .get("code")
        .replace(/[\s-]/g, "")
        .toUpperCase();
      child = await api("/me", { body: {}, key: childCode });
      dirty = false;
      render();
    } catch (e) {
      notice(e.message);
    } finally {
      button.disabled = false;
    }
  });
  $("#child-logout")?.addEventListener("click", () => {
    child = null;
    childCode = "";
    dirty = false;
    render();
  });
}
function renderAdminLogin() {
  $("#app").innerHTML =
    `<section class="panel login"><span class="eyebrow">Lehrpersonen</span><h1>Die Woche gemeinsam planen.</h1><p>Melde dich mit dem geschützten Lehrpersonencode an. Mehrere Lehrpersonen können gleichzeitig arbeiten.</p><form id="admin-login"><label class="field">Lehrpersonencode<input type="password" name="key" required autocomplete="current-password"></label><button>Anmelden</button></form><p class="small">Die Anmeldung gilt bis zum Abmelden oder Schliessen dieser Seite.</p></section>`;
  $("#admin-login").onsubmit = async (e) => {
    e.preventDefault();
    const key = new FormData(e.target).get("key").trim();
    try {
      snapshot = await api("/admin", { key });
      projectKey = snapshot.state.accessKey;
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
   ["children", "Kinder & Namen"],
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
      `<div class="stats"><div class="stat"><strong>${s.children.length}</strong>Kinder angelegt</div><div class="stat"><strong>${answered} / ${s.children.length}</strong>Vorauswahlen erfasst</div><div class="stat"><strong>${Object.values(s.assignments).filter((p) => p?.every(Boolean)).length}</strong>vollständig zugeteilt</div></div><div class="panel"><h2>So entsteht eure Projektwoche</h2><ol><li><p>Unter «Angebote» die neun Posten beschreiben und Plätze festlegen.</p></li><li><p>Kinder anlegen und die vierstelligen Codes zuordnen.</p></li><li><p>Unter «Wahlübersicht» die Excel-Vorlage herunterladen, die Kinder befragen und die ausgefüllte Datei importieren.</p></li><li><p>Gruppenvorgaben ergänzen, Verteilung vorschlagen lassen und prüfen.</p></li><li><p>Den Plan freigeben und die Gruppenlisten drucken.</p></li></ol>${s.open ? '<button id="toggle-open">Alte Kinderwahl schliessen</button>' : ''} <span class="small">${s.planStatus === "final" ? "Plan freigegeben" : "Plan ist ein Entwurf"}</span></div>`;
    if (s.open) $("#toggle-open").onclick = () => save({ action: "open", open: false });
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
    `${s.open ? '<div class="warning">Die Wahl ist geöffnet. Zum Bearbeiten der Angebote zuerst die Wahl in der Übersicht schliessen.</div>' : ""}<form id="projects-form"><div class="panel"><label class="field">Titel der Projektwoche<input name="title" value="${esc(s.title)}" maxlength="100" required></label><p class="small">0 Plätze bedeutet: Das Angebot findet in diesem Block nicht statt.</p></div><div class="grid">${s.projects.map((p) => `<article class="card"><span class="number">${p.id.padStart(2, "0")}</span><label class="field">Name des Angebots<input name="title-${p.id}" value="${esc(p.title)}" maxlength="100" required></label><label class="field">Beschreibung<textarea name="desc-${p.id}" maxlength="2000" required>${esc(p.description)}</textarea></label><div class="row"><label class="field">Plätze Mo. + Di.<input type="number" name="a-${p.id}" value="${p.capacity[0]}" min="0" max="200" required></label><label class="field">Plätze Mi. + Do.<input type="number" name="b-${p.id}" value="${p.capacity[1]}" min="0" max="200" required></label></div></article>`).join("")}</div><div class="savebar"><span>Änderungen gelten auf allen PCs.</span><button ${s.open ? "disabled" : ""}>Angebote speichern</button></div></form>`;
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
    `<div class="panel"><h2>Kinder anlegen</h2><p>Jedes Kind erhält eine Kennung und einen vierstelligen Code für die spätere Ansicht des Wochenplans. Die Namensspalte bleibt ausschliesslich auf diesem Gerät.</p><form id="add-children" class="row"><label class="field">Anzahl neuer Kinder<input type="number" name="count" min="1" max="${200 - s.children.length}" value="${s.children.length ? 1 : 100}" required></label><button ${s.children.length >= 200 ? "disabled" : ""}>Codes erstellen</button></form></div><div class="panel"><div class="row between"><h2>Lokale Namensliste</h2><div class="row"><button id="export-names" class="quiet">Verschlüsselt exportieren</button><button id="import-names" class="quiet">Importieren</button><button id="forget-names" class="danger">Namen hier entfernen</button></div></div><p class="small">Namen werden nur im Browser dieses PCs gespeichert. Für einen anderen PC die verschlüsselte Datei exportieren und dort importieren. Auf gemeinsam genutzten PCs nach Gebrauch entfernen.</p><div class="table-wrap"><table><thead><tr><th>Kennung</th><th>Name · nur lokal</th><th>Kindercode</th><th>Vorauswahl</th></tr></thead><tbody>${s.children.map((c) => `<tr><td>${c.id}</td><td><input data-name="${c.id}" aria-label="Lokaler Name für ${c.id}" value="${esc(names[c.id] || "")}" maxlength="100"></td><td class="code">${c.code.match(/.{1,4}/g).join("-")}</td><td>${c.choices.length ? "Erfasst" : "Fehlt"}</td></tr>`).join("")}</tbody></table></div></div>`;
  $("#add-children").onsubmit = (e) => {
    e.preventDefault();
    save({
      action: "children",
      count: Number(new FormData(e.target).get("count")),
    });
  };
  document.querySelectorAll("[data-name]").forEach(
    (input) =>
      (input.onchange = () => {
        names[input.dataset.name] = input.value.trim();
        try {
          localStorage.setItem(namesKey, JSON.stringify(names));
          notice("Name lokal gespeichert.");
        } catch {
          notice("Lokales Speichern nicht möglich. Bitte Namen exportieren.");
        }
      }),
  );
  const controls = document.createElement("div");
  controls.className = "panel row";
  controls.innerHTML =
    '<button id="export-csv">Codeliste für Excel exportieren</button><label class="button quiet">Ergänzte CSV importieren<input id="import-csv" type="file" accept=".csv" style="display:none"></label><button id="print-codes" class="quiet">Codezettel drucken</button><p class="small">Die CSV enthält Kennung, geheimen Wahlcode und eine Namensspalte. Namen in Excel ergänzen, als CSV UTF-8 speichern und hier lokal importieren. Diese Datei vertraulich aufbewahren.</p>';
  $("#content").prepend(controls);
  const linkPanel = document.createElement("div");
  linkPanel.className = "panel";
  linkPanel.innerHTML = `<h2>Kinderlink</h2><p>Über diesen Link und den vierstelligen Code können Kinder nach der Freigabe ihre zwei Posten ansehen.</p><label class="field">Link zur Kinderansicht<input readonly id="child-link" value="${esc(childLink())}"></label><button id="copy-child-link" class="quiet">Kinderlink kopieren</button>`;
  $("#content").prepend(linkPanel);
  $("#copy-child-link").onclick = async () => {
    try {
      await navigator.clipboard.writeText(childLink());
      notice("Kinderlink kopiert.");
    } catch {
      $("#child-link").select();
      notice("Bitte den markierten Link kopieren.");
    }
  };
  $("#export-csv").onclick = () =>
    download(
      "projektwoche-codeliste.csv",
      exportCodes(s.children, names),
      "text/csv;charset=utf-8",
    );
  $("#import-csv").onchange = async (e) => {
    try {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 200000) throw Error("Datei zu gross.");
      const imported = importCodeNames(await file.text(), s.children);
      const merged = { ...names, ...imported };
      localStorage.setItem(namesKey, JSON.stringify(merged));
      names = merged;
      render();
      notice(Object.keys(imported).length + " Namen lokal importiert.");
    } catch (e) {
      notice(e.message);
    }
  };
  $("#print-codes").onclick = () => {
    tab = "print";
    render();
    $("#print-type").value = "codes";
    $("#print-type").dispatchEvent(new Event("change"));
  };
  $("#export-names").onclick = () => nameTransfer("export");
  $("#import-names").onclick = () => nameTransfer("import");
  $("#forget-names").onclick = () => {
    if (
      confirm(
        "Alle lokal gespeicherten Namen auf diesem PC entfernen? Eine exportierte Sicherung bleibt erhalten.",
      )
    ) {
      names = {};
      localStorage.removeItem(namesKey);
      render();
    }
  };
}
function renderChoices() {
  const s = state();
  $("#content").innerHTML =
    `<div class="panel"><h2>Vorauswahl aus Excel</h2><p>Vorlage herunterladen, nach der Befragung pro Kind mindestens vier Angebote mit x markieren und die Datei hier prüfen. Die Namen werden nur lokal gespeichert; online gehen ausschliesslich Kennungen und Wahlen.</p><div class="row"><button id="download-template" ${!s.children.length ? "disabled" : ""}>Excel-Vorlage herunterladen</button><label class="button quiet">Ausgefüllte Excel auswählen<input id="import-choices" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style="display:none" ${!s.children.length ? "disabled" : ""}></label></div><div id="import-preview"></div></div><div class="panel"><h2>Wer hat was gewählt?</h2><p class="small">Die Häkchen zeigen gleichwertige Wünsche. Namen erscheinen nur, wenn sie auf diesem PC hinterlegt sind.</p><div class="table-wrap"><table><thead><tr><th>Kind</th>${s.projects.map((p) => `<th class="center" title="${esc(p.title)}">${esc(p.title)}</th>`).join("")}<th>Status</th></tr></thead><tbody>${s.children.map((c) => `<tr><td>${esc(name(c.id))}<br><span class="small">${c.id}</span></td>${s.projects.map((p) => `<td class="center">${c.choices.includes(p.id) ? "✓" : "—"}</td>`).join("")}<td>${c.choices.length >= 4 ? "Erfasst" : "Fehlt"}</td></tr>`).join("")}</tbody></table></div></div>`;
  $("#download-template").onclick = async () => {
    try { download("projektwoche-vorauswahl.xlsx", await makeChoiceTemplate(s, names), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"); }
    catch (e) { notice("Vorlage konnte nicht erstellt werden: " + e.message); }
  };
  $("#import-choices").onchange = async (event) => {
    try {
      const file = event.target.files[0];
      if (!file) return;
      if (file.size > 2_000_000) throw Error("Excel-Datei ist zu gross.");
      const parsed = await parseChoiceTemplate(await file.arrayBuffer(), s);
      importDraft = { ...parsed, revision: snapshot.revision };
      $("#import-preview").innerHTML = `<div class="success"><strong>Import geprüft</strong><p>${parsed.rows.length} Kinder enthalten · ${parsed.answered} mit mindestens vier Wünschen · ${parsed.rows.length - parsed.answered} ohne Vorauswahl. ${Object.keys(parsed.names).length} Namen werden nur auf diesem Gerät ergänzt.</p><button id="save-import">Vorauswahl für alle Kinder speichern</button></div>`;
      $("#save-import").onclick = async () => {
        if (snapshot.revision !== importDraft.revision) { notice("Der gemeinsame Stand hat sich geändert. Bitte die Excel-Datei erneut auswählen."); return; }
        const result = await save({ action: "choices", rows: importDraft.rows });
        if (result) {
          names = { ...names, ...importDraft.names };
          try { localStorage.setItem(namesKey, JSON.stringify(names)); }
          catch { notice("Wahlen gespeichert, aber Namen konnten lokal nicht gesichert werden. Bitte Namensliste exportieren."); }
          importDraft = null;
          render();
        }
      };
    } catch (e) { importDraft = null; $("#import-preview").innerHTML = ""; notice(e.message); }
  };
}
function renderPlan() {
  const s = state(),
    check = validatePlan(s, s.assignments, { allowOutside: true });
  $("#content").innerHTML =
    `<div class="panel"><div class="row between"><div><h2>Gruppen für zwei Blöcke</h2><p class="small">Der Vorschlag berücksichtigt die Wünsche und gleicht Gruppengrössen aus. Fixierte Kinder bleiben an ihrem Platz.</p></div><button id="generate" ${s.open || !s.children.length ? "disabled" : ""}>Verteilung vorschlagen</button></div>${s.open ? '<div class="warning">Zuerst die Wahl schliessen.</div>' : ""}<div class="grid">${s.projects.map((p, i) => `<div><h3>${esc(p.title)}</h3><p class="small">Mo. + Di. <strong>${check.counts[i][0]} / ${p.capacity[0]}</strong><br>Mi. + Do. <strong>${check.counts[i][1]} / ${p.capacity[1]}</strong></p></div>`).join("")}</div></div><div class="panel"><div class="table-wrap"><table><thead><tr><th>Kind</th><th>Mo. + Di.</th><th>Mi. + Do.</th><th>Fixieren</th></tr></thead><tbody>${s.children.map((c) => `<tr><td>${esc(name(c.id))}<br><span class="small">${c.id}</span></td>${[0, 1].map((b) => `<td><select data-assign="${c.id}" data-block="${b}" aria-label="${c.id}, Block ${b + 1}" ${s.fixed.includes(c.id) ? "disabled" : ""}><option value="">Noch offen</option>${s.projects.map((p) => `<option value="${p.id}" ${s.assignments[c.id]?.[b] === p.id ? "selected" : ""}>${esc(p.title)}${c.choices.includes(p.id) ? " ✓" : " · nicht gewählt"}</option>`).join("")}</select></td>`).join("")}<td><input type="checkbox" data-fix="${c.id}" aria-label="${c.id} fixieren" ${s.fixed.includes(c.id) ? "checked" : ""}></td></tr>`).join("")}</tbody></table></div><div id="plan-feedback"></div><label class="choose" style="margin:20px 0"><input type="checkbox" id="allow-outside">Ich bestätige Zuteilungen ausserhalb der gewählten Angebote.</label><div class="row"><button id="save-plan" ${s.open ? "disabled" : ""}>Änderungen speichern</button><button id="finalize" class="quiet" ${s.open ? "disabled" : ""}>Plan freigeben</button></div><p class="small">Freigegebene Posten sehen die Kinder nach der Anmeldung. Neue Änderungen machen den Plan wieder zum Entwurf.</p></div>`;
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
  let draft = structuredClone(s.assignments);
  const feedback = () => {
    const c = validatePlan(s, draft, { allowOutside: true });
    const missing = s.children.filter(
      (k) => !(draft[k.id] || []).length || (draft[k.id] || []).some((x) => !x),
    ).length;
    $("#plan-feedback").innerHTML =
      `<div class="warning">${missing} Kinder noch nicht vollständig zugeteilt.${c.issues.length ? " " + esc(c.issues.join(" ")) : ""} ${dirty ? "Vorschlag noch nicht gespeichert." : ""}</div>`;
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
    `<div class="panel no-print"><h2>Druckübersichten</h2><p>Die Vorschau ergänzt Namen ausschliesslich auf diesem PC. Ohne Namensliste werden die Kennungen gedruckt.</p><div class="row"><label class="field">Ansicht<select id="print-type"><option value="groups">Gruppenlisten je Posten und Block</option><option value="all">Gesamtübersicht</option><option value="personal">Persönliche Wochenpläne</option><option value="codes">Persönliche Wahlcodes</option></select></label><button id="print">Drucken / PDF speichern</button></div>${s.planStatus !== "final" ? '<div class="warning">Der Gruppenplan ist noch ein Entwurf. Ausdrucke sind entsprechend gekennzeichnet.</div>' : ""}</div><div id="print-preview"></div>`;
  const show = () => {
    const type = $("#print-type").value,
      heading = `<h1>${esc(s.title)}</h1><p>${s.planStatus === "final" ? "Freigegebener Plan" : "ENTWURF"} · Stand ${new Date().toLocaleString("de-CH")}</p>`;
    let html = "";
    if (type === "groups") {
      for (const b of [0, 1])
        for (const p of s.projects) {
          const kids = s.children.filter(
            (c) => s.assignments[c.id]?.[b] === p.id,
          );
          html += `<section class="panel print-page">${heading}<h2>${esc(p.title)}</h2><p>${b === 0 ? "Montag + Dienstag" : "Mittwoch + Donnerstag"} · ${kids.length} Kinder</p><table><thead><tr><th>Kind</th><th>Kennung</th><th>Anwesenheit</th><th>Notizen</th></tr></thead><tbody>${kids.map((c) => `<tr><td>${esc(name(c.id))}</td><td>${c.id}</td><td>□ &nbsp; □</td><td>________________</td></tr>`).join("")}</tbody></table></section>`;
        }
    }
    if (type === "all")
      html = `<section class="panel">${heading}<table><thead><tr><th>Kind</th><th>Mo. + Di.</th><th>Mi. + Do.</th></tr></thead><tbody>${s.children.map((c) => `<tr><td>${esc(name(c.id))}</td><td>${esc(projectName(s.assignments[c.id]?.[0]))}</td><td>${esc(projectName(s.assignments[c.id]?.[1]))}</td></tr>`).join("")}</tbody></table></section>`;
    if (type === "personal")
      html = s.children
        .map(
          (c) =>
            `<section class="panel print-page">${heading}<h2>${esc(name(c.id))}</h2>${[
              0, 1,
            ]
              .map((b) => {
                const p = s.projects.find(
                  (p) => p.id === s.assignments[c.id]?.[b],
                );
                return `<h3>${b === 0 ? "Montag + Dienstag" : "Mittwoch + Donnerstag"}: ${esc(p?.title || "Noch offen")}</h3><p>${esc(p?.description || "")}</p>`;
              })
              .join("")}</section>`,
        )
        .join("");
    if (type === "codes")
      html = `<div class="grid">${s.children.map((c) => `<section class="card"><h3>${esc(name(c.id))}</h3><p>Dein Code für die Projektwoche</p><strong class="code">${c.code.match(/.{1,4}/g).join("-")}</strong><p class="small">${esc(childLink())}<br>Hier kannst du später deine zwei Posten ansehen. Halte deinen Code geheim.</p></section>`).join("")}</div>`;
    $("#print-preview").innerHTML =
      html || '<div class="panel">Noch keine Kinder angelegt.</div>';
  };
  $("#print-type").onchange = show;
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
const to64 = (bytes) => btoa(String.fromCharCode(...bytes)),
  from64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
async function encryptionKey(password, salt) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" },
    key,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
function nameTransfer(mode) {
  const dialog = document.createElement("dialog");
  dialog.innerHTML = `<h2>Namensliste ${mode === "export" ? "exportieren" : "importieren"}</h2><form id="transfer"><p>Die Datei bleibt lokal. Zum Öffnen auf einem anderen PC wird dasselbe Passwort benötigt.</p>${mode === "import" ? '<label class="field">Verschlüsselte Datei<input type="file" name="file" accept=".json" required></label>' : ""}<label class="field">Passwort · mindestens 12 Zeichen<input name="password" type="password" minlength="12" required autocomplete="new-password"></label><div class="row"><button>${mode === "export" ? "Datei speichern" : "Datei öffnen"}</button><button type="button" class="quiet" id="cancel-transfer">Abbrechen</button></div><p id="transfer-error" role="alert"></p></form>`;
  document.body.append(dialog);
  dialog.showModal();
  dialog.onclose = () => dialog.remove();
  $("#cancel-transfer").onclick = () => dialog.close();
  $("#transfer").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target),
      password = f.get("password");
    try {
      if (mode === "export") {
        const salt = crypto.getRandomValues(new Uint8Array(16)),
          iv = crypto.getRandomValues(new Uint8Array(12)),
          key = await encryptionKey(password, salt);
        const cipher = await crypto.subtle.encrypt(
          { name: "AES-GCM", iv },
          key,
          new TextEncoder().encode(JSON.stringify({ app: API_URL, names })),
        );
        download(
          "namensliste-verschluesselt.json",
          JSON.stringify({
            version: 1,
            salt: to64(salt),
            iv: to64(iv),
            data: to64(new Uint8Array(cipher)),
          }),
        );
      } else {
        const file = f.get("file");
        if (file.size > 200000) throw Error("Datei zu gross.");
        const content = JSON.parse(await file.text());
        if (content.version !== 1) throw Error("Unbekanntes Dateiformat.");
        const salt = from64(content.salt),
          iv = from64(content.iv);
        if (salt.length !== 16 || iv.length !== 12)
          throw Error("Ungültige Datei.");
        const key = await encryptionKey(password, salt);
        const plain = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv },
          key,
          from64(content.data),
        );
        const data = JSON.parse(new TextDecoder().decode(plain));
        if (data.app !== API_URL)
          throw Error(
            "Diese Namensliste gehört zu einer anderen Projektwoche.",
          );
        if (
          !data.names ||
          typeof data.names !== "object" ||
          Array.isArray(data.names) ||
          Object.entries(data.names).some(
            ([id, n]) =>
              !/^K\d{3}$/.test(id) || typeof n !== "string" || n.length > 100,
          )
        )
          throw Error("Ungültige Namensliste.");
        const merged = { ...names, ...data.names };
        localStorage.setItem(namesKey, JSON.stringify(merged));
        names = merged;
        render();
      }
      dialog.close();
      notice(
        mode === "export"
          ? "Verschlüsselte Datei gespeichert."
          : "Namen auf diesem Gerät ergänzt.",
      );
    } catch (e) {
      $("#transfer-error").textContent =
        e.name === "OperationError"
          ? "Passwort falsch oder Datei beschädigt."
          : e.message;
    }
  };
}
window.addEventListener("beforeunload", (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
setInterval(() => {
  if (!document.hidden && !loading) refresh();
}, 5000);
window.addEventListener("online", refresh);
refresh();
