import { readFile, writeFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { initialState } from "../public/model.js";
import { makeDummyRosterTemplate, parseRosterTemplate } from "../public/excel.js";

globalThis.ExcelJS = ExcelJS;
const state = initialState();
const offers = JSON.parse(await readFile(new URL("../data/flyer-offers.json", import.meta.url), "utf8"));
state.projects = state.projects.map((project) => ({
  ...project,
  ...offers.find((offer) => offer.id === project.id),
}));
const bytes = await makeDummyRosterTemplate(state);
const parsed = await parseRosterTemplate(bytes, state);
if (parsed.rows.length !== 18 || parsed.answered !== 18)
  throw Error("Die Dummy-Liste konnte nicht geprüft werden.");
const output = process.argv[2];
if (!output) throw Error("Ausgabepfad fehlt.");
await writeFile(output, Buffer.from(bytes));
console.log(`Dummy-Liste erstellt: ${parsed.rows.length} fiktive Kinder.`);
