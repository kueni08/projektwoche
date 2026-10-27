const headerRow = 4;

function cellText(cell) {
  const value = cell.value;
  if (value == null) return "";
  if (typeof value === "object") throw Error(`Formeln oder Sonderwerte in ${cell.address} sind nicht erlaubt.`);
  return String(value).trim();
}

export async function makeChoiceTemplate(state, names) {
  const workbook = new globalThis.ExcelJS.Workbook();
  workbook.creator = "Projektwoche";
  const sheet = workbook.addWorksheet("Vorauswahl", { views: [{ state: "frozen", ySplit: 4, xSplit: 2 }] });
  sheet.getCell("A1").value = "Projektwoche · Vorauswahl";
  sheet.getCell("A2").value = "Pro Kind mindestens vier Angebote mit x markieren. Kennungen und Spalten nicht verändern. Namen bleiben beim Import auf diesem PC.";
  sheet.getCell("A3").value = "Angebote";
  sheet.getRow(headerRow).values = ["Kennung", "Name (nur lokal)", ...state.projects.map((p, i) => `${i + 1} · ${p.title}`)];
  sheet.getColumn(1).width = 14;
  sheet.getColumn(2).width = 28;
  state.projects.forEach((p, i) => { sheet.getColumn(i + 3).width = Math.max(18, Math.min(32, p.title.length + 7)); });
  sheet.getRow(1).font = { bold: true, size: 16, color: { argb: "FF17324D" } };
  sheet.getRow(headerRow).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(headerRow).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B4A7E" } };
  state.children.forEach((child, index) => {
    const row = sheet.getRow(headerRow + 1 + index);
    row.getCell(1).value = child.id;
    row.getCell(2).value = names[child.id] || "";
    state.projects.forEach((p, i) => { row.getCell(i + 3).value = child.choices.includes(p.id) ? "x" : ""; });
    if (index % 2 === 1) row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F7FB" } };
  });
  sheet.autoFilter = { from: "A4", to: "K4" };
  return workbook.xlsx.writeBuffer();
}

export async function parseChoiceTemplate(buffer, state) {
  const workbook = new globalThis.ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet("Vorauswahl");
  if (!sheet) throw Error("Tabellenblatt «Vorauswahl» fehlt. Bitte die Vorlage der App verwenden.");
  if (cellText(sheet.getCell("A4")) !== "Kennung" || cellText(sheet.getCell("B4")) !== "Name (nur lokal)")
    throw Error("Spaltenüberschriften wurden verändert. Bitte die Vorlage erneut herunterladen.");
  for (let i = 0; i < state.projects.length; i++) {
    if (cellText(sheet.getRow(headerRow).getCell(i + 3)) !== `${i + 1} · ${state.projects[i].title}`)
      throw Error("Die Angebote in der Datei entsprechen nicht dem aktuellen Stand. Bitte eine neue Vorlage herunterladen.");
  }
  const known = new Set(state.children.map((c) => c.id));
  const seen = new Set();
  const rows = [], names = {};
  for (let rowNo = headerRow + 1; rowNo <= Math.max(sheet.rowCount, headerRow + state.children.length); rowNo++) {
    const row = sheet.getRow(rowNo);
    const id = cellText(row.getCell(1));
    const localName = cellText(row.getCell(2));
    const marks = state.projects.map((p, i) => cellText(row.getCell(i + 3)).toLowerCase());
    if (!id && !localName && marks.every((m) => !m)) continue;
    if (!known.has(id)) throw Error(`Zeile ${rowNo}: unbekannte oder fehlende Kennung «${id}».`);
    if (seen.has(id)) throw Error(`Zeile ${rowNo}: Kennung ${id} kommt doppelt vor.`);
    seen.add(id);
    if (localName.length > 100) throw Error(`Zeile ${rowNo}: Name ist zu lang.`);
    if (localName) names[id] = localName;
    if (marks.some((m) => m && m !== "x")) throw Error(`Zeile ${rowNo}: Angebote bitte nur mit x markieren.`);
    const choices = state.projects.filter((_, i) => marks[i] === "x").map((p) => p.id);
    if (choices.length && choices.length < 4) throw Error(`Zeile ${rowNo} (${id}): mindestens vier Angebote markieren.`);
    if (choices.some((choice) => !state.projects.find((p) => p.id === choice).capacity.some((n) => n > 0)))
      throw Error(`Zeile ${rowNo} (${id}): ein markiertes Angebot ist nicht verfügbar.`);
    rows.push({ id, choices });
  }
  if (seen.size !== known.size) throw Error(`${known.size - seen.size} Kinder fehlen in der Datei. Bitte alle Kennungen aus der Vorlage belassen.`);
  return { rows, names, answered: rows.filter((r) => r.choices.length >= 4).length };
}
