/*
 * Puzzullu: writes to the tabs Afbeeldingen, Exemplaren, Logs and Personen of "Jan van Haasteren Puzzel Collectie 3.0".
 * Called by the API (api/api.py, from the password page /loggen/); it is a web app bound to the Sheet.
 *
 * Setup (once), see the README:
 *   1. In the Sheet: Extensions > Apps Script, add a script file (+ > Script) called Puzzullu and paste this file in it.
 *      The project must have no other doPost.
 *   2. Project Settings > Script properties: add SECRET with a long random value.
 *   3. Deploy > New deployment > Web app: execute as Me, access Anyone. Copy the /exec URL.
 *   4. On the server, in .env: SHEET_WRITE_URL=<the /exec URL> and SHEET_WRITE_SECRET=<the same SECRET>.
 * After changing this file: Deploy > Manage deployments > edit > New version (the URL stays the same).
 *
 * Request body (JSON): {"secret", "id" (to recognise a retry), "action", ...the fields of that action}
 *   addLog            exemplaar_id, tijd "u:mm:ss" | "", datum "YYYY-MM-DD", makers [names], compleet "ja" | number,
 *                     gefilmd true/false, missend (missing pieces of the box from now on) | null = unchanged
 *                     -> {ok, log_id}
 *   addExemplaar      afbeelding_id, stukjes, eigenaren [names]  -> {ok, exemplaar_id, volgnummer}
 *   removeExemplaar   exemplaar_id                              -> status "weg" (the row and its logs stay)
 *   setMissing        exemplaar_id, missend (number)
 *   setVideoUrl       log_id, video_url                         -> also gefilmd "ja"
 *   setRating         afbeelding_id, rating 1..5 | null
 *   addAfbeeldingen   afbeeldingen [{afbeelding_id, titel_en, titel_nl, tekenaar, jaar, bron, jvh_url}]  -> {ok, added}
 * Answer: {"ok": true, ...} or {"error": "..."}
 *
 * Columns are found by their name in row 1, so the order of the columns in the Sheet does not matter.
 * IDs and dates are made here; a new row goes in the first empty row below the last one with an ID.
 */

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return pzAnswer({ error: "invalid JSON" });
  }
  const secret = PropertiesService.getScriptProperties().getProperty("SECRET");
  if (!secret || body.secret !== secret) return pzAnswer({ error: "wrong secret" });

  // The same request twice (a retry after a slow answer) gives the first answer again instead of a second row.
  const cache = CacheService.getScriptCache();
  const id = body.id ? "pz:" + String(body.id).slice(0, 64) : "";
  const seen = id && cache.get(id);
  if (seen) return pzAnswer(JSON.parse(seen));

  const actions = { addLog: pzAddLog, addExemplaar: pzAddExemplaar, removeExemplaar: pzRemoveExemplaar,
    setMissing: pzSetMissing, setVideoUrl: pzSetVideoUrl, setRating: pzSetRating, addAfbeeldingen: pzAddAfbeeldingen };
  const action = actions[body.action];
  if (!action) return pzAnswer({ error: "unknown action " + body.action });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const result = action(body);
    SpreadsheetApp.flush();
    if (id && result.ok) cache.put(id, JSON.stringify(result), 600);
    return pzAnswer(result);
  } catch (err) {
    return pzAnswer({ error: String(err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------- actions

function pzAddLog(b) {
  const ex = pzTab("Exemplaren");
  const exRow = pzFind(ex, "exemplaar_id", b.exemplaar_id);
  if (!exRow) throw new Error("unknown box " + b.exemplaar_id);
  const makers = pzNames(b.makers);
  if (!makers.length) throw new Error("who did it?");
  if (b.tijd && !/^\d{1,3}:[0-5]\d:[0-5]\d$/.test(b.tijd)) throw new Error("time must be u:mm:ss");

  const logs = pzTab("Logs");
  let nr = 0;
  pzColumn(logs, "log_id").forEach((v) => { const m = /^L(\d+)$/.exec(v); if (m) nr = Math.max(nr, Number(m[1])); });
  const logId = "L" + String(nr + 1).padStart(4, "0");
  pzAppend(logs, "log_id", {
    log_id: logId,
    exemplaar_id: b.exemplaar_id,
    tijd: b.tijd ? "'" + b.tijd : "", // as text, so 27:23:12 stays a duration and not a time of day
    datum: pzDate(b.datum),
    makers: makers.join(", "),
    compleet: b.compleet === "ja" || b.compleet === 0 ? "ja" : String(b.compleet),
    gefilmd: b.gefilmd ? "ja" : "nee",
    video_url: "",
    ingevoerd_op: new Date(),
  }, { datum: "d-m-yyyy", ingevoerd_op: "d-m-yyyy hh:mm" });

  if (b.missend != null && b.missend !== "") pzSet(ex, exRow, { missende_stukjes: Number(b.missend), gewijzigd_op: new Date() });
  pzAddPersons(makers);
  return { ok: true, log_id: logId };
}

function pzAddExemplaar(b) {
  const afb = pzTab("Afbeeldingen");
  if (!pzFind(afb, "afbeelding_id", b.afbeelding_id)) throw new Error("unknown picture " + b.afbeelding_id);
  const stukjes = Number(b.stukjes);
  if (!(stukjes > 0)) throw new Error("how many pieces?");
  const eigenaren = pzNames(b.eigenaren);
  if (!eigenaren.length) throw new Error("whose box is it?");

  const ex = pzTab("Exemplaren");
  const rows = pzRows(ex);
  const owners = eigenaren.join(", ").toLowerCase();
  // the same owner(s) with the same version already: this is box 2 (3, ...)
  let volgnummer = 1;
  rows.forEach((r) => {
    if (r.afbeelding_id === b.afbeelding_id && Number(r.stukjes) === stukjes
        && pzNames(String(r.eigenaar).split(",")).join(", ").toLowerCase() === owners) {
      volgnummer = Math.max(volgnummer, (Number(r.volgnummer) || 1) + 1);
    }
  });
  const ids = new Set(rows.map((r) => r.exemplaar_id));
  let exId = [b.afbeelding_id, stukjes, pzSlug(eigenaren.join("-"))].join("-") + (volgnummer > 1 ? "-" + volgnummer : "");
  for (let n = 2; ids.has(exId); n++) exId = exId.replace(/-\d+$/, "") + "-" + n;
  const today = new Date();
  pzAppend(ex, "exemplaar_id", {
    exemplaar_id: exId, afbeelding_id: b.afbeelding_id, stukjes: stukjes, eigenaar: eigenaren.join(", "),
    volgnummer: volgnummer, missende_stukjes: 0, status: "in bezit", toegevoegd_op: today, gewijzigd_op: today,
  }, { toegevoegd_op: "d-m-yyyy", gewijzigd_op: "d-m-yyyy" });
  pzAddPersons(eigenaren);
  return { ok: true, exemplaar_id: exId, volgnummer: volgnummer };
}

function pzRemoveExemplaar(b) {
  const ex = pzTab("Exemplaren");
  const row = pzFind(ex, "exemplaar_id", b.exemplaar_id);
  if (!row) throw new Error("unknown box " + b.exemplaar_id);
  pzSet(ex, row, { status: "weg", gewijzigd_op: new Date() });
  return { ok: true };
}

function pzSetMissing(b) {
  const ex = pzTab("Exemplaren");
  const row = pzFind(ex, "exemplaar_id", b.exemplaar_id);
  if (!row) throw new Error("unknown box " + b.exemplaar_id);
  const n = Number(b.missend);
  if (!(n >= 0)) throw new Error("missing pieces must be 0 or more");
  pzSet(ex, row, { missende_stukjes: n, gewijzigd_op: new Date() });
  return { ok: true };
}

function pzSetVideoUrl(b) {
  const logs = pzTab("Logs");
  const row = pzFind(logs, "log_id", b.log_id);
  if (!row) throw new Error("unknown log " + b.log_id);
  if (!/^https:\/\/\S+$/.test(b.video_url || "")) throw new Error("the link must start with https://");
  pzSet(logs, row, { video_url: b.video_url, gefilmd: "ja" });
  return { ok: true };
}

function pzSetRating(b) {
  const afb = pzTab("Afbeeldingen");
  const row = pzFind(afb, "afbeelding_id", b.afbeelding_id);
  if (!row) throw new Error("unknown picture " + b.afbeelding_id);
  const r = b.rating == null || b.rating === "" ? "" : Number(b.rating);
  if (r !== "" && !(r >= 1 && r <= 5 && Math.round(r) === r)) throw new Error("rating goes from 1 to 5");
  pzSet(afb, row, { rating: r });
  return { ok: true };
}

function pzAddAfbeeldingen(b) {
  const afb = pzTab("Afbeeldingen");
  const have = new Set(pzColumn(afb, "afbeelding_id"));
  let added = 0;
  (b.afbeeldingen || []).forEach((a) => {
    if (!a.afbeelding_id || have.has(a.afbeelding_id)) return;
    pzAppend(afb, "afbeelding_id", {
      afbeelding_id: a.afbeelding_id, titel_en: a.titel_en || "", titel_nl: a.titel_nl || "", tekenaar: a.tekenaar || "",
      jaar: a.jaar || "", rating: "", bron: a.bron || "", jvh_url: a.jvh_url || "", opmerking: "",
    }, {});
    have.add(a.afbeelding_id);
    added++;
  });
  return { ok: true, added: added };
}

// ---------------------------------------------------------------- helpers

function pzTab(name) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sheet) throw new Error("no tab called " + name);
  return sheet;
}

// column numbers by header name: {"log_id": 1, ...}
function pzHeader(sheet) {
  const names = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const cols = {};
  names.forEach((n, i) => { if (n.trim()) cols[n.trim().toLowerCase()] = i + 1; });
  return cols;
}

function pzColumn(sheet, name) {
  const col = pzHeader(sheet)[name];
  if (!col) throw new Error("no column " + name + " in " + sheet.getName());
  const n = sheet.getLastRow() - 1;
  return n > 0 ? sheet.getRange(2, col, n, 1).getDisplayValues().map((r) => r[0].trim()) : [];
}

function pzRows(sheet) {
  const n = sheet.getLastRow() - 1;
  if (n <= 0) return [];
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0].map((h) => h.trim().toLowerCase());
  return sheet.getRange(2, 1, n, header.length).getDisplayValues()
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i].trim()])));
}

// row number of the row whose column `name` is `value`, or 0
function pzFind(sheet, name, value) {
  const i = pzColumn(sheet, name).indexOf(String(value || "").trim());
  return i < 0 ? 0 : i + 2;
}

function pzSet(sheet, row, values) {
  const cols = pzHeader(sheet);
  Object.keys(values).forEach((k) => {
    if (!cols[k]) throw new Error("no column " + k + " in " + sheet.getName());
    const cell = sheet.getRange(row, cols[k]);
    if (values[k] instanceof Date) cell.setNumberFormat("d-m-yyyy");
    cell.setValue(values[k]);
  });
}

// a new row in the first empty row below the last row with an ID
function pzAppend(sheet, idName, values, formats) {
  const ids = pzColumn(sheet, idName);
  let last = 0;
  ids.forEach((v, i) => { if (v) last = i + 1; });
  const row = last + 2;
  if (row > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 50);
  const cols = pzHeader(sheet);
  Object.keys(values).forEach((k) => {
    if (!cols[k]) return; // a column that is not in this Sheet is skipped
    const cell = sheet.getRange(row, cols[k]);
    if (formats[k]) cell.setNumberFormat(formats[k]);
    cell.setValue(values[k]);
  });
  return row;
}

// "YYYY-MM-DD" -> a date at midnight in the Sheet's own time zone
function pzDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) throw new Error("date must be YYYY-MM-DD");
  return Utilities.parseDate(iso, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), "yyyy-MM-dd");
}

// names as the site writes them: trimmed, capital first, no doubles
function pzNames(list) {
  const seen = new Set();
  return (list || []).map((n) => String(n).replace(/\s+/g, " ").trim()).filter(Boolean)
    .map((n) => n.charAt(0).toUpperCase() + n.slice(1))
    .filter((n) => !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()))
    .sort((a, b) => a.localeCompare(b, "nl"));
}

function pzSlug(s) {
  return String(s).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// new names go to the Personen tab (for the lists), when there is one
function pzAddPersons(names) {
  const sheet = SpreadsheetApp.getActive().getSheetByName("Personen");
  if (!sheet) return;
  const have = new Set(pzColumn(sheet, "naam").map((n) => n.toLowerCase()));
  names.forEach((n) => {
    if (!have.has(n.toLowerCase())) {
      pzAppend(sheet, "naam", { naam: n }, {});
      have.add(n.toLowerCase());
    }
  });
}

function pzAnswer(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
