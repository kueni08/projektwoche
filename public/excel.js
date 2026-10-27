const headerRow = 4;

function cellText(cell) {
  const value = cell.value;
  if (value == null) return "";
  if (typeof value === "object") throw Error(`Formeln oder Sonderwerte in ${cell.address} sind nicht erlaubt.`);
  return String(value).trim();
}


export async function makeRosterTemplate(state, names) {
  const workbook = new globalThis.ExcelJS.Workbook();
  workbook.creator = "Projektwoche";
  const sheet = workbook.addWorksheet("Kinderliste", { views: [{ state: "frozen", ySplit: 4, xSplit: 2 }] });
  sheet.getCell("A1").value = "Projektwoche · Kinderliste und Vorauswahl";
  sheet.getCell("A2").value = "Pro Kind Kürzel und Name eintragen. Nach der Befragung mindestens vier Angebote mit x markieren. Namen bleiben beim Import auf diesem PC.";
  sheet.getRow(headerRow).values = ["Kürzel", "Name (nur lokal)", ...state.projects.map((p, i) => `${i + 1} · ${p.title}`)];
  sheet.getColumn(1).width = 18;
  sheet.getColumn(2).width = 28;
  state.projects.forEach((p, i) => { sheet.getColumn(i + 3).width = Math.max(18, Math.min(32, p.title.length + 7)); });
  sheet.getRow(1).font = { bold: true, size: 16, color: { argb: "FF17324D" } };
  sheet.getRow(headerRow).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(headerRow).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B4A7E" } };
  for (let index = 0; index < Math.max(120, state.children.length + 20); index++) {
    const row = sheet.getRow(headerRow + 1 + index);
    const child = state.children[index];
    if (child) {
      row.getCell(1).value = child.id;
      row.getCell(2).value = names[child.id] || "";
      state.projects.forEach((p, i) => { row.getCell(i + 3).value = child.choices.includes(p.id) ? "x" : ""; });
    }
    if (index % 2) row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F7FB" } };
    for (let col = 3; col <= 11; col++) row.getCell(col).alignment = { horizontal: "center" };
  }
  sheet.autoFilter = { from: "A4", to: "K4" };
  return workbook.xlsx.writeBuffer();
}

export async function parseRosterTemplate(buffer, state) {
  const workbook = new globalThis.ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet("Kinderliste");
  if (!sheet) throw Error("Tabellenblatt «Kinderliste» fehlt. Bitte die Vorlage der App verwenden.");
  if (cellText(sheet.getCell("A4")) !== "Kürzel" || cellText(sheet.getCell("B4")) !== "Name (nur lokal)")
    throw Error("Spaltenüberschriften wurden verändert. Bitte die Vorlage erneut herunterladen.");
  for (let i = 0; i < state.projects.length; i++) {
    if (cellText(sheet.getRow(headerRow).getCell(i + 3)) !== `${i + 1} · ${state.projects[i].title}`)
      throw Error("Die Angebote in der Datei entsprechen nicht dem aktuellen Stand. Bitte eine neue Vorlage herunterladen.");
  }
  const seen = new Set(), rows = [], names = {};
  for (let rowNo = headerRow + 1; rowNo <= sheet.rowCount; rowNo++) {
    const row = sheet.getRow(rowNo);
    const rawId = cellText(row.getCell(1));
    const localName = cellText(row.getCell(2));
    const marks = state.projects.map((p, i) => cellText(row.getCell(i + 3)).toLowerCase());
    if (!rawId && !localName && marks.every((m) => !m)) continue;
    const id = rawId.toUpperCase();
    if (!/^[A-Z0-9ÄÖÜ_-]{1,20}$/.test(id)) throw Error(`Zeile ${rowNo}: Kürzel muss 1–20 Zeichen aus Buchstaben, Ziffern, _ oder - haben.`);
    if (seen.has(id)) throw Error(`Zeile ${rowNo}: Kürzel ${id} kommt doppelt vor.`);
    if (!localName || localName.length > 100) throw Error(`Zeile ${rowNo} (${id}): Name fehlt oder ist zu lang.`);
    if (marks.some((m) => m && m !== "x")) throw Error(`Zeile ${rowNo}: Angebote bitte nur mit x markieren.`);
    const choices = state.projects.filter((_, i) => marks[i] === "x").map((p) => p.id);
    if (choices.length && choices.length < 4) throw Error(`Zeile ${rowNo} (${id}): mindestens vier Angebote markieren.`);
    if (choices.some((choice) => !state.projects.find((p) => p.id === choice).capacity.some((n) => n > 0)))
      throw Error(`Zeile ${rowNo} (${id}): ein markiertes Angebot ist nicht verfügbar.`);
    seen.add(id); names[id] = localName; rows.push({ id, choices });
  }
  if (rows.length > 200) throw Error("Insgesamt höchstens 200 Kinder.");
  return { rows, names, answered: rows.filter((r) => r.choices.length >= 4).length };
}
