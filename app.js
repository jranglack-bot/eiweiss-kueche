import { GAENGE, BASIS, EINHEIT_G, REZEPTE, GRUNDREGELN } from "./data.js";

const VERSION = "1.5.0";
const OFF_FELDER = "code,product_name,product_name_de,brands,quantity,product_quantity,serving_quantity,nutriments";
// Barcode-Erkennung für Geräte ohne eingebauten Scanner (iPhone, Firefox), liegt in der App selbst
const BARCODE_POLYFILL = "./vendor/barcode-detector-2.3.1.min.js";
const ZXING_WASM = "./vendor/zxing_reader.wasm";

// ---------- Hilfen ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const zeitHtml = s => esc(s).replace(/\[\[(.+?)\]\]/g, '<span class="t">$1</span>');
const zeitRoh = s => String(s).replace(/\[\[(.+?)\]\]/g, '<span class="t">$1</span>');
const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
const zahl = s => { if (s == null) return null; const t = String(s).trim().replace(",", "."); if (t === "") return null; const v = Number(t); return isFinite(v) ? v : null; };
const pad = n => String(n).padStart(2, "0");
const heute = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const datumPlus = (iso, tage) => { const [y, m, d] = iso.split("-").map(Number); const x = new Date(y, m - 1, d + tage); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
const BR = { 0.25: "¼", 0.5: "½", 0.75: "¾" };
function fmtNum(v) {
  v = Math.round(v * 100) / 100;
  const ganz = Math.floor(v), rest = Math.round((v - ganz) * 100) / 100;
  if (BR[rest]) return (ganz ? ganz : "") + BR[rest];
  return v.toLocaleString("de-DE", { maximumFractionDigits: 1 });
}
const f0 = v => (v == null || isNaN(v)) ? "k. A." : Math.round(v).toLocaleString("de-DE");
const f1 = v => (v == null || isNaN(v)) ? "k. A." : (Math.round(v * 10) / 10).toLocaleString("de-DE", { maximumFractionDigits: 1 });

// ---------- Speicher ----------
const LS = "ek.";
function laden(k, def) { try { const v = localStorage.getItem(LS + k); return v ? JSON.parse(v) : def; } catch (e) { return def; } }
function sichern(k, v) {
  try { localStorage.setItem(LS + k, JSON.stringify(v)); return true; }
  catch (e) { fehlerMerken("Speichern fehlgeschlagen: " + e.message); toast("Speichern hat nicht geklappt. Speicher voll?"); return false; }
}
function fehlerMerken(msg) {
  try {
    const log = JSON.parse(localStorage.getItem(LS + "log") || "[]");
    log.unshift({ t: new Date().toISOString(), m: String(msg).slice(0, 300), v: VERSION });
    localStorage.setItem(LS + "log", JSON.stringify(log.slice(0, 20)));
  } catch (e) {}
}
window.addEventListener("error", e => fehlerMerken(`${e.message} @${(e.filename || "").split("/").pop()}:${e.lineno}`));
window.addEventListener("unhandledrejection", e => fehlerMerken("Promise: " + (e.reason && e.reason.message || e.reason)));

const STANDARD_ZIELE = { kcal: 2000, eiw: 150, kh: 200, fett: 65 };
const ui = { tab: laden("tab", "tagebuch"), datum: heute(), filter: laden("filter", "alle"), details: false };
if (!["tagebuch", "rezepte", "einkauf", "profil"].includes(ui.tab)) ui.tab = "tagebuch";
if (!["alle", "mild", "scharf"].includes(ui.filter)) ui.filter = "alle";

// ---------- Nährwerte ----------
const NK = ["kcal", "fett", "ges", "einf", "mehrf", "kh", "zucker", "ball", "eiw", "salz"];
const leer = () => Object.fromEntries(NK.map(k => [k, null]));
function skal(n100, g) { const o = {}; for (const k of NK) { const v = n100 && n100[k]; o[k] = (v == null || isNaN(v)) ? null : v * g / 100; } return o; }
function mal(n, f) { const o = {}; for (const k of NK) o[k] = (n && n[k] != null) ? n[k] * f : null; return o; }
function unges(n) {
  if (n.einf != null && n.mehrf != null) return { v: n.einf + n.mehrf, est: false };
  if (n.fett != null && n.ges != null) return { v: Math.max(0, n.fett - n.ges), est: true };
  return { v: null, est: false };
}
function summe(liste) {
  const s = Object.fromEntries(NK.map(k => [k, 0])); const fehlt = {}; let ug = 0, ugEst = false;
  for (const e of liste) {
    for (const k of NK) { const v = e.n && e.n[k]; if (v == null || isNaN(v)) fehlt[k] = (fehlt[k] || 0) + 1; else s[k] += v; }
    const u = unges(e.n || {}); if (u.v != null) { ug += u.v; if (u.est) ugEst = true; }
  }
  return { n: s, fehlt, unges: ug, ungesEst: ugEst, anzahl: liste.length };
}

// Nährwerte der Grundzutaten (aus dem BLS 4.0 erzeugt) und die BLS-Suche
let BN = {}; let bnGeladen = false;
let BLS = null; let blsLaden = null;
async function basisLaden() {
  try { const r = await fetch("./basis-naehrwerte.json"); if (r.ok) BN = (await r.json()).basis || {}; } catch (e) {}
  bnGeladen = true;
}
function blsHolen() {
  if (BLS) return Promise.resolve(BLS);
  if (!blsLaden) blsLaden = fetch("./bls.json").then(r => { if (!r.ok) throw new Error("BLS fehlt"); return r.json(); }).then(d => {
    const i = Object.fromEntries(d.f.map((k, n) => [k, n]));
    BLS = d.d.map(row => ({ code: row[i.code], name: row[i.name], nn: norm(row[i.name]), n100: Object.fromEntries(NK.map(k => [k, i[k] != null ? row[i[k]] : null])) }));
    return BLS;
  }).catch(e => { blsLaden = null; throw e; });
  return blsLaden;
}

function itemGramm(it) {
  if (typeof it.g === "number") return it.g;
  if (typeof it.a !== "number") return 0;
  const b = BASIS[it.c]; const u = it.u || b.u;
  if (u === "g" || u === "ml") return it.a;
  if (u === b.u && typeof b.g === "number") return it.a * b.g;
  if (EINHEIT_G[u]) return it.a * EINHEIT_G[u];
  return 0;
}
function rezeptProPortion(r) {
  let n = Object.fromEntries(NK.map(k => [k, 0])); let fehlt = false;
  if (r.eigen) {
    for (const z of r.zutaten || []) { const t = skal(z.n100, z.gramm); for (const k of NK) if (t[k] != null) n[k] += t[k]; else if (["kcal", "eiw", "fett", "kh"].includes(k)) fehlt = true; }
    return { n: mal(n, 1 / (r.portionen || 1)), fehlt };
  }
  for (const it of [...r.z, ...r.s]) {
    if (!it.c) continue; const g = itemGramm(it); if (!g) continue;
    const b = BN[it.c]; if (!b) { fehlt = true; continue; }
    const t = skal(b, g); for (const k of NK) if (t[k] != null) n[k] += t[k];
  }
  return { n, fehlt };
}

// ---------- Rezepte ----------
function alleRezepte() { return [...REZEPTE, ...eigeneRezepte.map((r, i) => Object.assign(r, { nr: REZEPTE.length + i + 1 }))]; }
const rezeptNach = id => alleRezepte().find(r => r.id === id);
const SCHARF = { mild: "mild", leicht: "leicht scharf", scharf: "scharf" };

// ---------- Gespeicherte Daten prüfen ----------
// Alles, was aus dem Speicher oder einer Sicherungsdatei kommt, wird hier auf Form und Größe gebracht.
const str = (v, max = 200) => (typeof v === "string" ? v : v == null ? "" : String(v)).slice(0, max);
const nz = (v, max) => { if (v == null || v === "") return null; const x = Number(v); return isFinite(x) && x >= 0 && x <= max ? x : null; };
const ID_OK = /^[A-Za-z0-9_-]{1,40}$/;
function nSauber(n, max) { const o = {}; for (const k of NK) o[k] = nz(n && n[k], max); return o; }
function refSauber(r) { return r && ["p", "b", "r"].includes(r.typ) ? { typ: r.typ, id: str(r.id, 60) } : { typ: "p", id: "unbekannt" }; }
function lmSauber(lm) {
  const o = { name: str(lm.name) || "Lebensmittel", sub: str(lm.sub), ref: refSauber(lm.ref) };
  if (lm.proPortion) o.proPortion = nSauber(lm.proPortion, 100000); else o.n100 = nSauber(lm.n100, 1000);
  const pg = nz(lm.portion_g, 100000), kg = nz(lm.packung_g, 100000), sg = nz(lm.stueck_g, 100000); if (pg) o.portion_g = pg; if (kg) o.packung_g = kg; if (sg) o.stueck_g = sg;
  return o;
}
function produktSauber(p, id) {
  return { id, code: /^\d{8,14}$/.test(p.code || "") ? p.code : "", name: str(p.name) || "Produkt", marke: str(p.marke), n100: nSauber(p.n100, 1000),
    portion_g: nz(p.portion_g, 100000), packung_g: nz(p.packung_g, 100000), stueck_g: nz(p.stueck_g, 100000), quelle: p.quelle === "off" ? "off" : "eigen", t: nz(p.t, 1e15) || 0 };
}
function rezeptSauber(r) {
  return { id: ID_OK.test(r.id || "") ? r.id : "eig" + Math.random().toString(36).slice(2, 9), eigen: true, name: str(r.name) || "Rezept", mit: str(r.mit),
    portionen: Math.max(1, Math.min(20, parseInt(r.portionen, 10) || 1)), scharf: SCHARF[r.scharf] ? r.scharf : "mild", mild: str(r.mild, 600),
    zutaten: (Array.isArray(r.zutaten) ? r.zutaten : []).slice(0, 60).filter(z => z && typeof z === "object").map(z => ({ name: str(z.name) || "Zutat", gramm: nz(z.gramm, 100000) || 0, anzeige: str(z.anzeige, 40), n100: nSauber(z.n100, 1000), ref: refSauber(z.ref) })),
    steps: (Array.isArray(r.steps) ? r.steps : []).slice(0, 40).map(x => str(x, 600)).filter(Boolean), tipp: str(r.tipp, 600) };
}
function eintragSauber(e) {
  return { id: ID_OK.test(e.id || "") ? e.id : "e" + Math.random().toString(36).slice(2, 10), meal: ["frueh", "mittag", "abend", "snack"].includes(e.meal) ? e.meal : "snack",
    name: str(e.name) || "Eintrag", sub: str(e.sub), ref: refSauber(e.ref), menge: nz(e.menge, 100000) || 0,
    einheit: ["g", "portion", "packung", "stueck"].includes(e.einheit) ? e.einheit : "g", gramm: nz(e.gramm, 100000), n: nSauber(e.n, 100000), t: nz(e.t, 1e15) || 0 };
}
function datenSauber(d) {
  d = d && typeof d === "object" ? d : {};
  const z = d.ziele || {}; const ziele = {};
  for (const k of ["kcal", "eiw", "kh", "fett"]) { const v = nz(z[k], 20000); ziele[k] = v > 0 ? Math.round(v) : STANDARD_ZIELE[k]; }
  const tagebuch = {};
  if (d.tagebuch && typeof d.tagebuch === "object") for (const [tag, l] of Object.entries(d.tagebuch)) if (/^\d{4}-\d{2}-\d{2}$/.test(tag) && Array.isArray(l)) tagebuch[tag] = l.slice(0, 300).filter(e => e && typeof e === "object").map(eintragSauber);
  const produkte = {};
  if (d.produkte && typeof d.produkte === "object") for (const [id, p] of Object.entries(d.produkte)) if (ID_OK.test(id) && p && typeof p === "object") produkte[id] = produktSauber(p, id);
  const rezepte = Array.isArray(d.rezepte) ? d.rezepte.slice(0, 200).filter(r => r && typeof r === "object").map(rezeptSauber) : [];
  const ids = new Set([...REZEPTE.map(r => r.id), ...rezepte.map(r => r.id)]);
  const l = d.liste && typeof d.liste === "object" ? d.liste : {};
  const schluessel = o => { const r = {}; if (o && typeof o === "object") for (const k of Object.keys(o).slice(0, 500)) if (k.length <= 120 && o[k]) r[k] = 1; return r; };
  const liste = {
    rezepte: (Array.isArray(l.rezepte) ? l.rezepte : []).filter(x => x && ids.has(x.id)).slice(0, 50).map(x => ({ id: x.id, por: Math.max(1, Math.min(20, parseInt(x.por, 10) || 1)) })),
    eigene: (Array.isArray(l.eigene) ? l.eigene : []).filter(x => x && typeof x === "object").slice(0, 300).map(x => ({ id: ID_OK.test(x.id || "") ? x.id : "l" + Math.random().toString(36).slice(2, 9), name: str(x.name, 120) || "Eintrag", menge: str(x.menge, 40), gang: GAENGE.some(g => g[0] === x.gang) ? x.gang : "sonst" })),
    weg: schluessel(l.weg), chk: schluessel(l.chk), anders: {}
  };
  if (l.anders && typeof l.anders === "object") for (const k of Object.keys(l.anders).slice(0, 300)) if (k.length <= 120 && typeof l.anders[k] === "string") liste.anders[k] = str(l.anders[k], 40);
  const zuletzt = Array.isArray(d.zuletzt) ? d.zuletzt.slice(0, 20).filter(x => x && typeof x === "object").map(lmSauber) : [];
  const p = d.profil && typeof d.profil === "object" ? d.profil : {};
  const ganz = (v, min, max, def) => { const x = parseInt(v, 10); return Number.isFinite(x) && x >= min && x <= max ? x : def; };
  const profil = { geschlecht: p.geschlecht === "w" ? "w" : "m", alter: str(p.alter, 4), groesse: str(p.groesse, 5), gewicht: str(p.gewicht, 6),
    alltag: ganz(p.alltag, 0, 3, 1), tage: ganz(p.tage, 0, 7, 3), dauer: ganz(p.dauer, 15, 150, 60), intens: ganz(p.intens, 0, 2, 1), tempo: ganz(p.tempo, 0, 2, 1),
    ziel: ["ab", "halten", "auf"].includes(p.ziel) ? p.ziel : "ab" };
  return { ziele, profil, tagebuch, produkte, rezepte, liste, zuletzt };
}
const SPEICHER_TEILE = ["ziele", "profil", "tagebuch", "produkte", "rezepte", "liste", "zuletzt"];
function allesSichern(neu) {
  const alt = {}; for (const k of SPEICHER_TEILE) alt[k] = localStorage.getItem(LS + k);
  try { for (const k of SPEICHER_TEILE) localStorage.setItem(LS + k, JSON.stringify(neu[k])); return true; }
  catch (e) {
    for (const k of SPEICHER_TEILE) { try { if (alt[k] == null) localStorage.removeItem(LS + k); else localStorage.setItem(LS + k, alt[k]); } catch (_) {} }
    fehlerMerken("Einspielen: " + e.message); return false;
  }
}
const gespeichert = datenSauber(Object.fromEntries(SPEICHER_TEILE.map(k => [k, laden(k, null)])));
let { ziele, profil, tagebuch, produkte, zuletzt, liste } = gespeichert;
try { localStorage.removeItem(LS + "einkauf"); } catch (e) {} // alte, feste Einkaufsliste aus Version 1.0
let eigeneRezepte = gespeichert.rezepte;

// ---------- Garmin ----------
// Die App fragt Julians Cloudflare-Worker (garmin-worker/worker.js) nach den Trainings eines Tages.
// Adresse und Zugangscode liegen nur auf dem Handy und kommen nicht in die Datensicherung.
function garminSauber(g) {
  if (!g || typeof g !== "object") return null;
  const url = str(g.url, 200).trim().replace(/\/+$/, "");
  if (!/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.workers\.dev$/i.test(url) || str(g.code, 100).length < 12) return null;
  return { url, code: str(g.code, 100), anteil: [50, 75, 100].includes(Number(g.anteil)) ? Number(g.anteil) : 75 };
}
function garminDatenSauber(d) {
  d = d && typeof d === "object" ? d : {};
  return { aktivitaeten: (Array.isArray(d.aktivitaeten) ? d.aktivitaeten : []).slice(0, 20).filter(a => a && typeof a === "object").map(a => ({ name: str(a.name, 80) || "Aktivität", kcal: nz(a.kcal, 20000) || 0, ruheKcal: nz(a.ruheKcal, 20000) || 0, minuten: nz(a.minuten, 2000) || 0, start: str(a.start, 16) })),
    aktivKcalTag: nz(d.aktivKcalTag, 20000), schritte: nz(d.schritte, 200000) };
}
let garmin = garminSauber(laden("garmin", null));
let garminTage = {};
{ const t = laden("garminTage", {}); if (t && typeof t === "object") for (const [k, v] of Object.entries(t)) if (/^\d{4}-\d{2}-\d{2}$/.test(k) && v && typeof v === "object") garminTage[k] = v.fehler ? { t: nz(v.t, 1e15) || 0, fehler: str(v.fehler, 160) } : { t: nz(v.t, 1e15) || 0, final: !!v.final, d: garminDatenSauber(v.d) }; }
const garminLaeuft = {};
// Trainingskalorien ohne Ruheverbrauch, davon der eingestellte Anteil (Uhren schätzen eher zu hoch)
function sportKcal(e) { if (!garmin || !e || !e.d) return 0; const netto = e.d.aktivitaeten.reduce((s, a) => s + Math.max(0, a.kcal - (a.ruheKcal || 0)), 0); return Math.round(netto * garmin.anteil / 100); }
async function garminAbfragen(cfg, datum) {
  const r = await fetch(`${cfg.url}/?datum=${datum}`, { headers: { "X-Zugang": cfg.code }, cache: "no-store" });
  let d = {}; try { d = await r.json(); } catch (e) {}
  if (!r.ok) throw new Error(str(d && d.fehler, 160) || "Antwort " + r.status);
  return garminDatenSauber(d);
}
async function garminAktualisieren(datum, erzwingen) {
  if (!garmin || garminLaeuft[datum]) return;
  const c = garminTage[datum]; const alter = c ? Date.now() - c.t : Infinity;
  if (!erzwingen && c && !c.fehler && (datum < heute() ? c.final : alter < 15 * 60e3)) return;
  if (!erzwingen && c && c.fehler && alter < 2 * 60e3) return;
  garminLaeuft[datum] = true;
  try { garminTage[datum] = { t: Date.now(), final: datum < heute(), d: await garminAbfragen(garmin, datum) }; }
  catch (e) { garminTage[datum] = { t: Date.now(), fehler: str(e.message, 160) || "keine Verbindung" }; fehlerMerken("Garmin: " + e.message); }
  finally { delete garminLaeuft[datum]; }
  const tage = Object.keys(garminTage).sort(); while (tage.length > 30) delete garminTage[tage.shift()];
  sichern("garminTage", garminTage);
  if (ui.tab === "tagebuch" && ui.datum === datum && !sheets.length) render();
}

// ---------- Toast und Sheets ----------
let toastT;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2400); }

const sheets = [];
function sheetOeffnen(bau, opts = {}) {
  const wrap = document.createElement("div");
  wrap.className = "sheet-wrap" + (opts.voll ? " voll" : "");
  wrap.innerHTML = `<div class="sheet-bg"></div><section class="sheet" role="dialog" aria-modal="true"></section>`;
  document.body.appendChild(wrap);
  const eintrag = { wrap, sheet: $(".sheet", wrap), onClose: null, after: null };
  sheets.push(eintrag);
  history.pushState({ ek: sheets.length }, "");
  $(".sheet-bg", wrap).addEventListener("click", () => sheetSchliessen());
  bau(eintrag.sheet, eintrag);
  requestAnimationFrame(() => wrap.classList.add("offen"));
  return eintrag;
}
function sheetSchliessen(after) { if (!sheets.length) { if (after) after(); return; } sheets[sheets.length - 1].after = after || null; history.back(); }
window.addEventListener("popstate", () => {
  // history.go(-n) löst nur ein popstate aus: so viele Ebenen schließen, wie der Verlauf verlangt
  const soll = (history.state && history.state.ek) || 0;
  let after = null;
  while (sheets.length > soll) {
    const top = sheets.pop();
    try { top.onClose && top.onClose(); } catch (e) {}
    top.wrap.remove();
    if (!after && top.after) after = top.after;
  }
  if (after) setTimeout(after, 0);
  render();
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && sheets.length) sheetSchliessen(); });

// ---------- Hauptansicht ----------
const MAHLZEITEN = [["frueh", "Frühstück"], ["mittag", "Mittagessen"], ["abend", "Abendessen"], ["snack", "Snacks"]];
function mahlzeitJetzt() { const h = new Date().getHours() + new Date().getMinutes() / 60; return h < 10.5 ? "frueh" : h < 14.5 ? "mittag" : h < 17 ? "snack" : h < 21 ? "abend" : "snack"; }

function render() {
  $$(".nav button").forEach(b => b.setAttribute("aria-current", String(b.dataset.tab === ui.tab)));
  const main = $("#main");
  if (ui.tab === "tagebuch") main.innerHTML = viewTagebuch();
  else if (ui.tab === "rezepte") main.innerHTML = viewRezepte();
  else if (ui.tab === "einkauf") main.innerHTML = viewEinkauf();
  else main.innerHTML = viewProfil();
  $("#scan-fab").hidden = ui.tab !== "tagebuch";
  if (ui.tab === "tagebuch" && garmin) garminAktualisieren(ui.datum);
}
function tabSetzen(t) { ui.tab = t; sichern("tab", t); render(); window.scrollTo(0, 0); }

function datumText(iso) {
  if (iso === heute()) return "Heute";
  if (iso === datumPlus(heute(), -1)) return "Gestern";
  if (iso === datumPlus(heute(), 1)) return "Morgen";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short" });
}
function balken(wert, ziel, klasse = "") {
  const p = ziel > 0 ? Math.min(100, (wert / ziel) * 100) : 0; const ueber = ziel > 0 && wert > ziel;
  return `<div class="balken ${klasse}${ueber ? " ueber" : ""}"><span style="width:${p.toFixed(1)}%"></span></div>`;
}
function mengeText(e) {
  if (e.einheit === "portion") return `${fmtNum(e.menge)} ${e.menge === 1 ? "Portion" : "Portionen"}${e.gramm ? ` · ${f0(e.gramm)} g` : ""}`;
  if (e.einheit === "packung") return `${fmtNum(e.menge)} × Packung · ${f0(e.gramm)} g`;
  if (e.einheit === "stueck") return `${fmtNum(e.menge)} Stück · ${f0(e.gramm)} g`;
  return `${f0(e.menge)} g`;
}

function viewTagebuch() {
  const tag = tagebuch[ui.datum] || [];
  const s = summe(tag);
  const g = garmin ? garminTage[ui.datum] : null; const sport = sportKcal(g);
  // Sport von der Uhr erhöht das Tagesziel, die zusätzlichen Kalorien gehen in die Kohlenhydrate
  const zielKcal = ziele.kcal + sport, zielKh = ziele.kh + Math.round(sport / 4);
  const kcal = s.n.kcal; const rest = Math.round(zielKcal - kcal);
  const makro = (lab, k, ziel) => `<div class="makro"><div class="mk-kopf"><span>${lab}</span><span class="zahl">${f0(s.n[k])} / ${f0(ziel)} g</span></div>${balken(s.n[k], ziel, "m-" + k)}</div>`;
  const zeilen = MAHLZEITEN.map(([id, titel]) => {
    const liste = tag.filter(e => e.meal === id); const ks = liste.reduce((a, e) => a + (e.n.kcal || 0), 0);
    return `<section class="mahlzeit">
      <div class="mz-kopf"><h3>${titel}</h3><span class="zahl leise">${liste.length ? f0(ks) + " kcal" : ""}</span>
        <button class="rund" data-act="hinzu" data-meal="${id}" aria-label="${titel} hinzufügen">+</button></div>
      ${liste.length ? `<ul class="eintraege">${liste.map(e => `<li><button data-act="eintrag" data-id="${esc(e.id)}"><span class="en"><b>${esc(e.name)}</b><small>${esc(mengeText(e))}${e.sub ? " · " + esc(e.sub) : ""}</small></span><span class="zahl">${f0(e.n.kcal)} kcal</span></button></li>`).join("")}</ul>` : ""}
    </section>`;
  }).join("");
  const det = ui.details ? detailTabelle(s) : "";
  return `
  <div class="datum-leiste">
    <button class="rund" data-act="tag" data-d="-1" aria-label="Vorheriger Tag">‹</button>
    <button class="datum" data-act="kalender" aria-label="Kalender öffnen, ${esc(datumText(ui.datum))}">${esc(datumText(ui.datum))}<svg class="kal-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg></button>
    <button class="rund" data-act="tag" data-d="1" aria-label="Nächster Tag">›</button>
  </div>
  <section class="karte bilanz">
    <div class="b-oben">
      <div><span class="gross zahl">${rest >= 0 ? f0(rest) : f0(-rest)}</span><span class="leise">${rest >= 0 ? "kcal übrig" : "kcal drüber"}</span></div>
      <div class="b-rechts"><span class="zahl">${f0(kcal)}</span><span class="leise">von ${f0(zielKcal)} gegessen${sport ? `<br>inkl. ${f0(sport)} Sport` : ""}</span></div>
    </div>
    ${balken(kcal, zielKcal, "kcal")}
    <div class="makros">${makro("Eiweiß", "eiw", ziele.eiw)}${makro("Kohlenhydrate", "kh", zielKh)}${makro("Fett", "fett", ziele.fett)}</div>
    <button class="text-knopf" data-act="details">${ui.details ? "Weniger anzeigen" : "Alle Nährwerte des Tages"}</button>
    ${det}
  </section>
  ${garmin ? garminTagKarte(g, sport) : ""}
  ${zeilen}`;
}
// Monatskalender: Tag antippen springt ins Tagebuch. Punkt grün = im Ziel, orange = mehr als 5 % drüber.
function tagesStatus(iso) {
  const l = tagebuch[iso]; if (!l || !l.length) return null;
  const kcal = l.reduce((a, e) => a + (e.n.kcal || 0), 0); const eiw = l.reduce((a, e) => a + (e.n.eiw || 0), 0);
  const ziel = ziele.kcal + sportKcal(garmin ? garminTage[iso] : null);
  return { kcal, eiw, ziel, drueber: kcal > ziel * 1.05 };
}
function kalenderSheet() {
  let [y, m] = ui.datum.split("-").map(Number);
  const WT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  sheetOeffnen(s => {
    const zeichnen = () => {
      const tage = new Date(y, m, 0).getDate(); const versatz = (new Date(y, m - 1, 1).getDay() + 6) % 7;
      const titel = new Date(y, m - 1, 1).toLocaleDateString("de-DE", { month: "long", year: "numeric" });
      const h = heute(); let zellen = "", erfasst = 0, sumK = 0, sumE = 0, imZiel = 0;
      for (let i = 0; i < versatz; i++) zellen += `<span class="kal-leer"></span>`;
      for (let d = 1; d <= tage; d++) {
        const iso = `${y}-${pad(m)}-${pad(d)}`; const st = tagesStatus(iso);
        if (st) { erfasst++; sumK += st.kcal; sumE += st.eiw; if (!st.drueber) imZiel++; }
        const klasse = ["kal-tag", iso === h ? "heute" : "", iso === ui.datum ? "gewaehlt" : "", st ? (st.drueber ? "drueber" : "imziel") : ""].filter(Boolean).join(" ");
        const label = new Date(y, m - 1, d).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" }) + (st ? `, ${f0(st.kcal)} von ${f0(st.ziel)} kcal` : ", nichts eingetragen");
        zellen += `<button class="${klasse}" data-k="tag" data-d="${iso}" aria-label="${esc(label)}"${iso === ui.datum ? ' aria-current="date"' : ""}>${d}${st ? `<i></i>` : ""}</button>`;
      }
      s.innerHTML = `
        <div class="sh-kopf"><button class="rund" data-k="zu" aria-label="Schließen">×</button><span class="leise">Tag wählen</span>${ui.datum !== h ? `<button class="knopf" data-k="heute">Heute</button>` : ""}</div>
        <div class="kal-kopf"><button class="rund" data-k="monat" data-v="-1" aria-label="Voriger Monat">‹</button><h2>${esc(titel)}</h2><button class="rund" data-k="monat" data-v="1" aria-label="Nächster Monat">›</button></div>
        <div class="kal-raster">${WT.map(w => `<span class="kal-wt">${w}</span>`).join("")}${zellen}</div>
        <p class="kal-legende"><span><i class="imziel"></i>im Ziel</span><span><i class="drueber"></i>drüber</span></p>
        ${erfasst ? `<section class="karte"><h3>${esc(titel)} im Schnitt</h3>
          <div class="kal-schnitt"><div><b class="zahl">${f0(sumK / erfasst)}</b><span class="leise">kcal am Tag</span></div><div><b class="zahl">${f0(sumE / erfasst)} g</b><span class="leise">Eiweiß am Tag</span></div><div><b class="zahl">${erfasst}</b><span class="leise">Tage erfasst</span></div><div><b class="zahl">${imZiel}</b><span class="leise">davon im Ziel</span></div></div></section>`
          : `<p class="leise">In diesem Monat ist noch nichts eingetragen.</p>`}`;
    };
    zeichnen();
    s.onclick = ev => {
      const b = ev.target.closest("[data-k]"); if (!b) return; const a = b.dataset.k;
      if (a === "zu") sheetSchliessen();
      else if (a === "monat") { m += +b.dataset.v; if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; } zeichnen(); }
      else if (a === "tag") { ui.datum = b.dataset.d; sheetSchliessen(); }
      else if (a === "heute") { ui.datum = heute(); sheetSchliessen(); }
    };
  });
}
function garminTagKarte(g, sport) {
  let inhalt;
  if (!g) inhalt = `<p class="leise lade">Frage deine Garmin-Daten ab …</p>`;
  else if (g.fehler) inhalt = `<p class="leise">Garmin gerade nicht erreichbar: ${esc(g.fehler)}</p>`;
  else {
    const l = g.d.aktivitaeten;
    inhalt = (l.length ? `<ul class="g-liste">${l.map(a => `<li><span class="en"><b>${esc(a.name)}</b><small>${a.start ? esc(a.start.slice(11, 16)) + " Uhr · " : ""}${f0(a.minuten)} min</small></span><span class="zahl">${f0(Math.max(0, a.kcal - (a.ruheKcal || 0)))} kcal</span></li>`).join("")}</ul>` : `<p class="leise">Heute noch kein Training aufgezeichnet.</p>`)
      + `<p class="fuss">${l.length ? `Angerechnet: ${garmin.anteil} % der Trainingskalorien ohne Ruheverbrauch.` : ""}${g.d.schritte != null ? ` Schritte: ${f0(g.d.schritte)}.` : ""}</p>`;
  }
  return `<section class="karte garmin-karte"><div class="mz-kopf"><h3>Sport von der Uhr</h3><span class="zahl leise">${sport ? "+ " + f0(sport) + " kcal" : ""}</span><button class="rund" data-act="garmin-neu" aria-label="Garmin neu abfragen">↻</button></div>${inhalt}</section>`;
}
function detailTabelle(s) {
  const z = (lab, k, e = "g", einr = false) => `<tr class="${einr ? "einr" : ""}"><th>${lab}</th><td class="zahl">${k === "kcal" ? f0(s.n[k]) : f1(s.n[k])} ${e}${s.fehlt[k] ? ` <small title="bei ${s.fehlt[k]} Einträgen ohne Angabe">*</small>` : ""}</td></tr>`;
  const teil = Object.keys(s.fehlt).length > 0;
  return `<table class="naehr">
    ${z("Kalorien", "kcal", "kcal")}${z("Eiweiß", "eiw")}${z("Kohlenhydrate", "kh")}${z("davon Zucker", "zucker", "g", true)}${z("Ballaststoffe", "ball")}
    ${z("Fett", "fett")}${z("davon gesättigte Fettsäuren", "ges", "g", true)}
    <tr class="einr"><th>davon ungesättigte Fettsäuren</th><td class="zahl">${f1(s.unges)} g${s.ungesEst ? " <small>geschätzt</small>" : ""}</td></tr>
    ${z("einfach ungesättigt", "einf", "g", true)}${z("mehrfach ungesättigt", "mehrf", "g", true)}${z("Salz", "salz")}
  </table>
  <p class="fuss">${teil ? "* Bei manchen Einträgen fehlt dieser Wert, die Summe ist dann zu niedrig. " : ""}Ungesättigte Fettsäuren stehen selten auf Packungen. Fehlen sie, rechnet die App Fett minus gesättigte Fettsäuren und schreibt „geschätzt“ dazu.</p>`;
}

// ---------- Rezepte-Ansicht ----------
function rezeptKarte(r) {
  const pp = rezeptProPortion(r);
  const naehr = pp.fehlt && !r.eigen ? `<li class="n">Nährwerte folgen</li>` : `<li class="n">${f0(pp.n.kcal)} kcal</li><li class="n">${f0(pp.n.eiw)} g Eiweiß</li>`;
  return `<li><button class="r-karte" data-act="rezept" data-id="${esc(r.id)}">
    <span class="r-nr">${r.nr}</span>
    <span class="r-text"><b>${esc(r.name)}</b><small>${r.mit ? "mit " + esc(r.mit) : "eigenes Rezept"}</small>
    <ul class="meta">${SCHARF[r.scharf] && r.scharf !== "mild" ? `<li class="scharf">${SCHARF[r.scharf]}</li>` : `<li class="mild">mild</li>`}${naehr}</ul></span>
  </button></li>`;
}
function viewRezepte() {
  const alle = alleRezepte();
  const liste = alle.filter(r => ui.filter === "alle" || (ui.filter === "mild" ? (r.scharf || "mild") === "mild" : (r.scharf || "mild") !== "mild"));
  const chip = (id, lab) => `<button class="chip" data-act="filter" data-f="${id}" aria-pressed="${ui.filter === id}">${lab}</button>`;
  return `<h2 class="seitentitel">Rezepte</h2>
  <div class="chips">${chip("alle", "Alle")}${chip("mild", "Nur mild")}${chip("scharf", "Scharf")}</div>
  ${ui.filter === "mild" ? `<p class="leise">Die scharfen Gerichte sind nur ausgeblendet. Bei jedem steht, wie es mild wird.</p>` : ""}
  <ul class="r-liste">${liste.map(rezeptKarte).join("") || `<li class="leise">Hier ist noch nichts.</li>`}</ul>
  <button class="knopf voll breit" data-act="rezept-neu">Eigenes Rezept anlegen</button>
  <details class="karte grund"><summary>Grundregeln für alle Rezepte</summary><ul>${GRUNDREGELN.map(g => `<li>${zeitRoh(g)}</li>`).join("")}</ul></details>`;
}

function rezeptZutatenHtml(items, por, eigen, portionen) {
  if (eigen) return items.map(z => `<li><span class="m">${f0(z.gramm * por / (portionen || 1))} g</span><span>${esc(z.name)}${z.anzeige && por === portionen ? `<span class="h">${esc(z.anzeige)}</span>` : ""}</span></li>`).join("");
  return items.map(it => {
    const b = it.c ? BASIS[it.c] : null; const name = it.t || (b.rn || b.n); const u = it.u || (b && b.u);
    let m = it.x ? it.x : (typeof it.a === "number" ? mengeFmt(it.a * por, u) : "");
    return `<li><span class="m">${esc(m)}</span><span>${esc(name)}${it.h ? `<span class="h">${esc(it.h)}</span>` : ""}</span></li>`;
  }).join("");
}
function mengeFmt(v, u) {
  if (u === "g" || u === "ml") return Math.round(v) + " " + u;
  if (u === "Stück") return fmtNum(v);
  if (u === "Stoß") return fmtNum(v) + (v > 1 ? " Stöße" : " Stoß");
  return fmtNum(v) + " " + u;
}

function rezeptOeffnen(id) {
  const r = rezeptNach(id); if (!r) return;
  let por = r.eigen ? (r.portionen || 1) : 1;
  sheetOeffnen((s, ent) => {
    const zeichnen = () => {
      const pp = rezeptProPortion(r);
      s.innerHTML = `
      <div class="sh-kopf"><button class="rund" data-sh="zu" aria-label="Schließen">×</button><span class="leise">Rezept ${r.nr}</span></div>
      <h2>${esc(r.name)}</h2>
      ${r.mit ? `<p class="mit">mit ${esc(r.mit)}</p>` : ""}
      <ul class="meta">${r.geraet ? `<li>${esc(r.geraet)}</li>` : ""}${r.zeit ? `<li>${esc(r.zeit)}</li>` : ""}${SCHARF[r.scharf] && r.scharf !== "mild" ? `<li class="scharf">${SCHARF[r.scharf]}</li>` : `<li class="mild">mild</li>`}</ul>
      ${r.mild && r.scharf !== "mild" ? `<p class="mildbox"><b>So wird es mild:</b> ${esc(r.mild)}</p>` : ""}
      <div class="por-zeile"><span>Portionen</span><div class="stepper"><button data-sh="por-" aria-label="Weniger">−</button><output class="zahl">${por}</output><button data-sh="por+" aria-label="Mehr">+</button></div></div>
      <div class="zutaten">
        <section><h4>Zutaten</h4><ul class="zl">${r.eigen ? rezeptZutatenHtml(r.zutaten || [], por, true, r.portionen) : rezeptZutatenHtml(r.z, por)}</ul></section>
        ${!r.eigen ? `<section class="sosse"><h4>${esc(r.mit)}</h4><ul class="zl">${rezeptZutatenHtml(r.s, por)}</ul></section>` : ""}
      </div>
      ${(r.steps || []).length ? `<ol class="schritte">${r.steps.map(x => `<li><span>${zeitHtml(x)}</span></li>`).join("")}</ol>` : ""}
      ${r.tipp ? `<p class="tipp">${zeitHtml(r.tipp)}</p>` : ""}
      <h4 class="unter">Nährwerte pro Portion</h4>
      ${pp.fehlt && !r.eigen ? `<p class="leise">Die Nährwerte erscheinen, sobald die Lebensmittel-Datenbank eingespielt ist.</p>` : naehrTabelleKurz(pp.n)}
      ${r.quelle ? `<p class="quelle">Quelle: ${esc(r.quelle)} ${/^https:\/\//.test(r.link || "") ? `<a href="${esc(r.link)}" target="_blank" rel="noopener noreferrer">Original ansehen</a>` : ""}</p>` : ""}
      <div class="sh-fuss">
        ${pp.fehlt && !r.eigen ? "" : `<button class="knopf voll" data-sh="ins">Portion ins Tagebuch</button>`}
        <button class="knopf" data-sh="liste">Auf die Einkaufsliste (${por} P.)</button>
        <button class="knopf" data-sh="wach" aria-pressed="false">Bildschirm anlassen</button>
        ${r.eigen ? `<button class="knopf" data-sh="bearb">Bearbeiten</button><button class="knopf warn" data-sh="loesch">Löschen</button>` : ""}
      </div>`;
    };
    zeichnen();
    let loeschBereit = false;
    s.addEventListener("click", ev => {
      const b = ev.target.closest("[data-sh]"); if (!b) return; const a = b.dataset.sh;
      if (a === "zu") sheetSchliessen();
      else if (a === "por-") { if (por > 1) { por--; zeichnen(); } }
      else if (a === "por+") { if (por < 12) { por++; zeichnen(); } }
      else if (a === "ins") { const lm = lmAusRezept(r); sheetSchliessen(() => mengeSheet(lm, { meal: mahlzeitJetzt() })); }
      else if (a === "wach") wachUmschalten(b);
      else if (a === "liste") { rezeptAufListe(r.id, por); toast(`Auf der Einkaufsliste: ${por} ${por === 1 ? "Portion" : "Portionen"}`); }
      else if (a === "bearb") sheetSchliessen(() => rezeptEditor(r));
      else if (a === "loesch") {
        if (!loeschBereit) { loeschBereit = true; b.textContent = "Wirklich löschen?"; return; }
        eigeneRezepte = eigeneRezepte.filter(x => x.id !== r.id); sichern("rezepte", eigeneRezepte);
        liste.rezepte = liste.rezepte.filter(x => x.id !== r.id); sichern("liste", liste);
        sheetSchliessen(() => toast("Rezept gelöscht"));
      }
    });
    ent.onClose = () => wachAus();
  }, { voll: true });
}
function naehrTabelleKurz(n) {
  const u = unges(n);
  const z = (lab, v, e = "g", einr = false) => `<tr class="${einr ? "einr" : ""}"><th>${lab}</th><td class="zahl">${e === "kcal" ? f0(v) : f1(v)} ${e}</td></tr>`;
  return `<table class="naehr">${z("Kalorien", n.kcal, "kcal")}${z("Eiweiß", n.eiw)}${z("Kohlenhydrate", n.kh)}${z("davon Zucker", n.zucker, "g", true)}${z("Ballaststoffe", n.ball)}${z("Fett", n.fett)}${z("davon gesättigte Fettsäuren", n.ges, "g", true)}
  <tr class="einr"><th>davon ungesättigte Fettsäuren</th><td class="zahl">${f1(u.v)} g${u.est ? " <small>geschätzt</small>" : ""}</td></tr>${z("Salz", n.salz)}</table>`;
}

// Bildschirm anlassen
let wl = null, wlWill = false, wlBusy = false;
async function wachUmschalten(btn) {
  if (wlBusy) return; wlBusy = true;
  try {
    if (wl) { await wl.release().catch(() => {}); wl = null; wlWill = false; }
    else if ("wakeLock" in navigator) { wl = await navigator.wakeLock.request("screen"); wlWill = true; wl.addEventListener("release", () => { wl = null; }); }
    else toast("Dein Browser kann den Bildschirm nicht wach halten");
  } catch (e) { wl = null; wlWill = false; toast("Bildschirm anlassen geht gerade nicht"); }
  wlBusy = false;
  if (btn) { btn.setAttribute("aria-pressed", String(!!wl)); btn.classList.toggle("voll", !!wl); btn.textContent = wl ? "Bildschirm bleibt an" : "Bildschirm anlassen"; }
}
function wachAus() { wlWill = false; if (wl) wl.release().catch(() => {}); wl = null; }
document.addEventListener("visibilitychange", async () => {
  if (wlWill && !wl && document.visibilityState === "visible") { try { wl = await navigator.wakeLock.request("screen"); } catch (e) {} }
});

// ---------- Lebensmittel-Objekte ----------
function lmAusRezept(r) { const pp = rezeptProPortion(r); return { name: r.name, sub: "Rezept", ref: { typ: "r", id: r.id }, proPortion: pp.n }; }
function lmAusProdukt(p) { return { name: p.name, sub: p.marke || (p.quelle === "eigen" ? "eigenes Produkt" : ""), ref: { typ: "p", id: p.id }, n100: p.n100, portion_g: p.portion_g, packung_g: p.packung_g, stueck_g: p.stueck_g }; }
function lmAusBLS(b) { return { name: b.name, sub: "BLS", ref: { typ: "b", id: b.code }, n100: b.n100 }; }
const refKey = r => r.typ + ":" + r.id;
function zuletztMerken(lm) {
  const k = refKey(lm.ref); const kopie = JSON.parse(JSON.stringify(lm));
  zuletzt = [kopie, ...zuletzt.filter(x => refKey(x.ref) !== k)].slice(0, 20); sichern("zuletzt", zuletzt);
}
function lmAktuell(lm) {
  if (lm.ref.typ === "p" && produkte[lm.ref.id]) return lmAusProdukt(produkte[lm.ref.id]);
  if (lm.ref.typ === "r") { const r = rezeptNach(lm.ref.id); if (r) return lmAusRezept(r); }
  return lm;
}

// ---------- Menge eintragen ----------
function einheiten(lm) {
  if (lm.proPortion) return [{ u: "portion", lab: "Portion", g: null }];
  const l = [{ u: "g", lab: "Gramm", g: 1 }];
  if (lm.portion_g > 0) l.push({ u: "portion", lab: `Portion (${f0(lm.portion_g)} g)`, g: lm.portion_g });
  if (lm.packung_g > 0) l.push({ u: "packung", lab: `Packung (${f0(lm.packung_g)} g)`, g: lm.packung_g });
  if (lm.stueck_g > 0) l.push({ u: "stueck", lab: `Stück (${f0(lm.stueck_g)} g)`, g: lm.stueck_g });
  return l;
}
function berechnen(lm, menge, einheit) {
  if (lm.proPortion) return { gramm: null, n: mal(lm.proPortion, menge) };
  const e = einheiten(lm).find(x => x.u === einheit) || { g: 1 };
  const gramm = menge * e.g; return { gramm, n: skal(lm.n100, gramm) };
}
function mengeSheet(lm, opts) { sheetOeffnen(s => mengeInhalt(s, lm, opts)); }
function mengeInhalt(s, lm, opts) {
  const eintrag = opts.eintrag || null;
  const zutatModus = opts.modus === "zutat";
  const einh = einheiten(lm);
  let einheit = eintrag ? eintrag.einheit : (zutatModus ? "g" : lm.proPortion ? "portion" : (lm.portion_g > 0 ? "portion" : "g"));
  if (!einh.some(x => x.u === einheit)) einheit = einh[0].u;
  let menge = eintrag ? eintrag.menge : (einheit === "g" ? 100 : 1);
  let meal = eintrag ? eintrag.meal : (opts.meal || mahlzeitJetzt());
  const zeichnen = () => {
    const r = berechnen(lm, menge || 0, einheit);
    const u = unges(r.n);
    s.innerHTML = `
      <div class="sh-kopf">${opts.zurueck ? `<button class="rund" data-m="zurueck" aria-label="Zurück">‹</button>` : `<button class="rund" data-m="zu" aria-label="Schließen">×</button>`}<span class="leise">${eintrag ? "Eintrag ändern" : zutatModus ? "Zutat" : "Eintragen"}</span></div>
      <h2>${esc(lm.name)}</h2>${lm.sub ? `<p class="leise">${esc(lm.sub)}</p>` : ""}
      ${zutatModus ? "" : `<div class="chips">${MAHLZEITEN.map(([id, t]) => `<button class="chip" data-m="meal" data-v="${id}" aria-pressed="${meal === id}">${t}</button>`).join("")}</div>`}
      <div class="menge-zeile">
        <div class="stepper gross"><button data-m="minus" aria-label="Weniger">−</button><input id="menge" class="zahl" inputmode="decimal" value="${esc(String(menge).replace(".", ","))}" aria-label="Menge"><button data-m="plus" aria-label="Mehr">+</button></div>
        <div class="einheiten">${einh.map(x => `<button class="chip" data-m="einheit" data-v="${x.u}" aria-pressed="${einheit === x.u}">${esc(x.lab)}</button>`).join("")}</div>
      </div>
      <div class="vorschau">
        <div><span class="gross zahl">${f0(r.n.kcal)}</span><span class="leise">kcal</span></div>
        <div><b class="zahl">${f1(r.n.eiw)} g</b><span class="leise">Eiweiß</span></div>
        <div><b class="zahl">${f1(r.n.kh)} g</b><span class="leise">Kohlenh.</span></div>
        <div><b class="zahl">${f1(r.n.fett)} g</b><span class="leise">Fett</span></div>
      </div>
      <details class="mehr"><summary>Alle Nährwerte für diese Menge</summary>${naehrTabelleKurz(r.n)}</details>
      ${lm.ref.typ === "p" ? `<button class="text-knopf" data-m="produkt">Produktdaten ansehen oder ändern</button>` : ""}
      ${zutatModus || lm.proPortion ? "" : `<button class="text-knopf" data-m="liste">Auf die Einkaufsliste setzen</button>`}
      <div class="sh-fuss">
        <button class="knopf voll" data-m="ok">${eintrag ? "Speichern" : zutatModus ? "Übernehmen" : "Eintragen"}</button>
        ${eintrag ? `<button class="knopf warn" data-m="loesch">Löschen</button>` : ""}
      </div>`;
    const inp = $("#menge", s);
    inp.addEventListener("input", () => { const v = zahl(inp.value); if (v != null && v >= 0) { menge = v; vorschauNeu(); } });
  };
  const vorschauNeu = () => {
    const r = berechnen(lm, menge || 0, einheit); const v = $$(".vorschau b, .vorschau .gross", s);
    if (v.length >= 4) { v[0].textContent = f0(r.n.kcal); v[1].textContent = f1(r.n.eiw) + " g"; v[2].textContent = f1(r.n.kh) + " g"; v[3].textContent = f1(r.n.fett) + " g"; }
    const d = $(".mehr", s); if (d) { const offen = d.open; d.innerHTML = `<summary>Alle Nährwerte für diese Menge</summary>${naehrTabelleKurz(r.n)}`; d.open = offen; }
  };
  zeichnen();
  let loeschBereit = false;
  s.onclick = ev => {
    const b = ev.target.closest("[data-m]"); if (!b) return; const a = b.dataset.m;
    const schritt = einheit === "g" ? (menge >= 100 ? 25 : 10) : 0.5;
    if (a === "zu") sheetSchliessen();
    else if (a === "zurueck") opts.zurueck();
    else if (a === "meal") { meal = b.dataset.v; zeichnen(); }
    else if (a === "einheit") { const neu = b.dataset.v; if (neu !== einheit) { einheit = neu; menge = neu === "g" ? 100 : 1; zeichnen(); } }
    else if (a === "minus") { menge = Math.max(0, Math.round(((menge || 0) - schritt) * 100) / 100); zeichnen(); }
    else if (a === "plus") { menge = Math.round(((menge || 0) + schritt) * 100) / 100; zeichnen(); }
    else if (a === "liste") produktAufListe(lm);
    else if (a === "produkt") { const p = produkte[lm.ref.id]; if (p) produktForm(s, { produkt: p, weiter: neu => mengeInhalt(s, lmAusProdukt(neu), opts) }); }
    else if (a === "loesch") {
      if (!loeschBereit) { loeschBereit = true; b.textContent = "Wirklich löschen?"; return; }
      tagebuch[ui.datum] = (tagebuch[ui.datum] || []).filter(x => x.id !== eintrag.id); if (!tagebuch[ui.datum].length) delete tagebuch[ui.datum];
      sichern("tagebuch", tagebuch); sheetSchliessen(() => toast("Eintrag gelöscht"));
    }
    else if (a === "ok") {
      if (!(menge > 0)) { toast("Bitte eine Menge eingeben"); return; }
      const r = berechnen(lm, menge, einheit);
      if (zutatModus) {
        const e = einh.find(x => x.u === einheit);
        const anzeige = einheit === "g" ? "" : `${fmtNum(menge)} ${e ? e.lab.replace(/ \(.*\)$/, "") : einheit}`;
        opts.onPick(lm, r.gramm, anzeige); return;
      }
      const datum = opts.datum || ui.datum;
      const neu = { id: eintrag ? eintrag.id : "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), meal, name: lm.name, sub: lm.sub || "", ref: lm.ref, menge, einheit, gramm: r.gramm, n: r.n, t: eintrag ? eintrag.t : Date.now() };
      const liste = tagebuch[datum] || (tagebuch[datum] = []);
      const i = liste.findIndex(x => x.id === neu.id); if (i >= 0) liste[i] = neu; else liste.push(neu);
      sichern("tagebuch", tagebuch); zuletztMerken(lm);
      const anzahl = sheets.length; // alle offenen Ebenen schließen
      const fertig = () => toast(eintrag ? "Gespeichert" : `Eingetragen: ${f0(r.n.kcal)} kcal`);
      if (anzahl > 1) { history.go(-anzahl); setTimeout(fertig, 200); } else sheetSchliessen(fertig);
    }
  };
}

// ---------- Suchen und Hinzufügen ----------
function suchSheet(opts) {
  sheetOeffnen((s, ent) => {
    let q = "";
    const kopf = () => `
      <div class="sh-kopf"><button class="rund" data-s="zu" aria-label="Schließen">×</button><span class="leise">${opts.modus === "zutat" ? "Zutat wählen" : "Hinzufügen zu " + (MAHLZEITEN.find(m => m[0] === opts.meal) || [0, "Mahlzeit"])[1]}</span></div>
      <input id="suche" type="search" placeholder="Suchen, zum Beispiel Skyr oder Hähnchen" autocomplete="off" value="${esc(q)}" aria-label="Lebensmittel suchen">
      <div class="knoepfe"><button class="knopf voll" data-s="scan">Barcode scannen</button><button class="knopf" data-s="neu">Neues Produkt</button></div>
      <div id="treffer" aria-live="polite"></div>`;
    const startseite = () => { s.innerHTML = kopf(); const i = $("#suche", s); i.addEventListener("input", () => { q = i.value; trefferZeigen(); }); trefferZeigen(); if (!opts.ohneFokus) setTimeout(() => i.focus(), 50); };
    const zeile = (lm, kcalTxt) => `<li><button data-s="wahl" data-k="${esc(refKey(lm.ref))}"><span class="en"><b>${esc(lm.name)}</b><small>${esc(lm.sub || "")}</small></span><span class="zahl leise">${kcalTxt}</span></button></li>`;
    let kandidaten = {};
    const kcal100 = lm => lm.proPortion ? `${f0(lm.proPortion.kcal)} kcal/Port.` : (lm.n100 && lm.n100.kcal != null ? `${f0(lm.n100.kcal)} kcal/100 g` : "");
    const gruppe = (titel, l) => l.length ? `<h4 class="unter">${titel}</h4><ul class="treffer">${l.map(lm => { kandidaten[refKey(lm.ref)] = lm; return zeile(lm, kcal100(lm)); }).join("")}</ul>` : "";
    let lauf = 0;
    const trefferZeigen = async () => {
      const ziel = $("#treffer", s); const nr = ++lauf; kandidaten = {};
      const nq = norm(q).trim(); const woerter = nq.split(/\s+/).filter(Boolean);
      const passt = t => woerter.every(w => t.includes(w));
      if (!woerter.length) {
        const zl = zuletzt.map(lmAktuell).filter(lm => opts.modus !== "zutat" || lm.ref.typ !== "r");
        const prod = Object.values(produkte).sort((a, b) => (b.t || 0) - (a.t || 0)).slice(0, 15).map(lmAusProdukt);
        const rez = opts.modus === "zutat" ? [] : alleRezepte().map(lmAusRezept);
        ziel.innerHTML = gruppe("Zuletzt", zl) + gruppe("Meine Produkte", prod) + gruppe("Rezepte", rez) || `<p class="leise">Tippe einen Namen ein oder scanne einen Barcode.</p>`;
        return;
      }
      const prod = Object.values(produkte).filter(p => passt(norm(p.name + " " + (p.marke || "")))).slice(0, 20).map(lmAusProdukt);
      const rez = opts.modus === "zutat" ? [] : alleRezepte().filter(r => passt(norm(r.name))).map(lmAusRezept);
      let html = gruppe("Meine Produkte", prod) + gruppe("Rezepte", rez);
      ziel.innerHTML = html + `<p class="leise lade">Suche in der Lebensmittel-Datenbank …</p>`;
      let blsHtml = "";
      try {
        const bls = await blsHolen(); if (nr !== lauf) return;
        const t = bls.filter(b => passt(b.nn)).sort((a, b) => (b.nn.startsWith(woerter[0]) - a.nn.startsWith(woerter[0])) || a.name.length - b.name.length).slice(0, 40).map(lmAusBLS);
        blsHtml = gruppe("Lebensmittel (BLS)", t);
      } catch (e) { if (nr !== lauf) return; blsHtml = `<p class="leise">Die Lebensmittel-Datenbank ist noch nicht eingespielt.</p>`; }
      ziel.innerHTML = html + blsHtml + `<button class="knopf breit" data-s="online">„${esc(q)}“ online bei Open Food Facts suchen</button>` + (html || blsHtml.includes("<li") ? "" : `<p class="leise">Nichts gefunden.</p>`);
    };
    const onlineSuchen = async () => {
      const ziel = $("#treffer", s); ziel.insertAdjacentHTML("beforeend", `<p class="leise lade">Frage Open Food Facts …</p>`);
      try {
        const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=25&fields=${OFF_FELDER}&tagtype_0=countries&tag_contains_0=contains&tag_0=germany`;
        const r = await fetch(url); if (!r.ok) throw new Error("HTTP " + r.status);
        const d = await r.json();
        const l = (Array.isArray(d.products) ? d.products : []).filter(p => p && /^\d{8,14}$/.test(String(p.code || "")) && p.nutriments).map(p => vonOFF(p, String(p.code))).filter(p => p.n100.kcal != null);
        ziel.querySelectorAll(".lade").forEach(x => x.remove());
        const lms = l.map(p => { const lm = lmAusProdukt(p); lm._off = p; return lm; });
        ziel.insertAdjacentHTML("beforeend", lms.length ? gruppe("Open Food Facts", lms) : `<p class="leise">Online nichts gefunden.</p>`);
      } catch (e) { ziel.querySelectorAll(".lade").forEach(x => x.remove()); ziel.insertAdjacentHTML("beforeend", `<p class="leise">Open Food Facts lässt die Suche gerade nicht zu, entweder kein Netz oder zu viele Anfragen. Versuch es in einer Minute noch einmal, oder scanne einfach den Barcode, der geht immer.</p>`); }
    };
    const weiterMit = lm => {
      if (lm._off) { const p = lm._off; delete lm._off; produkte[p.id] = p; sichern("produkte", produkte); lm = lmAusProdukt(p); }
      const zurueck = () => startseite();
      if (opts.modus === "zutat") mengeInhalt(s, lm, { modus: "zutat", zurueck, onPick: (l, g, anzeige) => { sheetSchliessen(() => opts.onPick(l, g, anzeige)); } });
      else mengeInhalt(s, lm, { meal: opts.meal, zurueck });
    };
    s.addEventListener("click", ev => {
      const b = ev.target.closest("[data-s]"); if (!b) return; const a = b.dataset.s;
      if (a === "zu") sheetSchliessen();
      else if (a === "wahl") { const lm = kandidaten[b.dataset.k]; if (lm) weiterMit(lm); }
      else if (a === "online") onlineSuchen();
      else if (a === "neu") produktForm(s, { zurueck: startseite, weiter: p => weiterMit(lmAusProdukt(p)) });
      else if (a === "scan") scannerOeffnen(code => barcodeVerarbeiten(s, code, { zurueck: startseite, weiter: p => weiterMit(lmAusProdukt(p)) }));
    });
    startseite();
  });
}

// ---------- Open Food Facts ----------
function vonOFF(p, code) {
  const n = p.nutriments || {};
  const v = k => { const x = n[k + "_100g"]; return (x === undefined || x === null || x === "") ? null : Number(x); };
  let kcal = v("energy-kcal");
  if (kcal == null) { const kj = v("energy-kj") != null ? v("energy-kj") : v("energy"); if (kj != null) kcal = Math.round(kj / 4.184 * 10) / 10; }
  const num = x => { const y = Number(x); return isFinite(y) && y > 0 && y <= 100000 ? y : null; };
  // Fremddaten: unplausible Werte (negativ, unendlich, über 1000 pro 100 g) werden verworfen
  return {
    id: String(code), code: String(code), name: str(p.product_name_de || p.product_name) || "Unbekanntes Produkt", marke: str(String(p.brands || "").split(",")[0].trim()),
    n100: nSauber({ kcal, fett: v("fat"), ges: v("saturated-fat"), einf: v("monounsaturated-fat"), mehrf: v("polyunsaturated-fat"), kh: v("carbohydrates"), zucker: v("sugars"), ball: v("fiber"), eiw: v("proteins"), salz: v("salt") }, 1000),
    portion_g: num(p.serving_quantity), packung_g: num(p.product_quantity), quelle: "off", t: Date.now()
  };
}
const vollstaendig = p => ["kcal", "eiw", "fett", "kh"].every(k => p.n100[k] != null);
async function barcodeVerarbeiten(s, code, opts) {
  code = String(code).replace(/\D/g, "");
  if (!/^\d{8,14}$/.test(code)) { toast("Das ist kein gültiger Barcode"); return; }
  if (produkte[code]) { produkte[code].t = Date.now(); sichern("produkte", produkte); opts.weiter(produkte[code]); return; }
  s.innerHTML = `<div class="sh-kopf"><span class="leise">Barcode ${esc(code)}</span></div><p class="lade gross-lade">Suche das Produkt …</p>`;
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}?fields=${OFF_FELDER}`);
    if (r.status === 404) { produktForm(s, { code, hinweis: "Das Produkt kennt noch niemand. Trag die Werte einmal von der Packung ein, beim nächsten Scan reicht der Barcode.", zurueck: opts.zurueck, weiter: opts.weiter }); return; }
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = await r.json();
    if (d.status !== 1 || !d.product) { produktForm(s, { code, hinweis: "Das Produkt kennt noch niemand. Trag die Werte einmal von der Packung ein, beim nächsten Scan reicht der Barcode.", zurueck: opts.zurueck, weiter: opts.weiter }); return; }
    const p = vonOFF(d.product, code);
    if (vollstaendig(p)) { produkte[code] = p; sichern("produkte", produkte); opts.weiter(p); }
    else produktForm(s, { produkt: p, neu: true, hinweis: "Bei Open Food Facts fehlen Werte. Ergänze sie einmal von der Packung.", zurueck: opts.zurueck, weiter: opts.weiter });
  } catch (e) {
    fehlerMerken("OFF: " + e.message);
    produktForm(s, { code, hinweis: "Keine Verbindung zu Open Food Facts. Du kannst die Werte von der Packung eintragen.", zurueck: opts.zurueck, weiter: opts.weiter });
  }
}

// ---------- Produkt anlegen oder ändern ----------
const PF = [["kcal", "Kalorien (kcal)", true], ["fett", "Fett (g)", true], ["ges", "davon gesättigte Fettsäuren (g)"], ["einf", "einfach ungesättigte (g), falls angegeben"], ["mehrf", "mehrfach ungesättigte (g), falls angegeben"], ["kh", "Kohlenhydrate (g)", true], ["zucker", "davon Zucker (g)"], ["ball", "Ballaststoffe (g)"], ["eiw", "Eiweiß (g)", true], ["salz", "Salz (g)"]];
function produktForm(s, opts) {
  const p = opts.produkt || { code: opts.code || "", name: "", marke: "", n100: leer(), portion_g: null, packung_g: null };
  const wert = v => v == null ? "" : String(Math.round(v * 100) / 100).replace(".", ",");
  s.innerHTML = `
    <div class="sh-kopf">${opts.zurueck ? `<button class="rund" data-p="zurueck" aria-label="Zurück">‹</button>` : `<button class="rund" data-p="zu" aria-label="Schließen">×</button>`}<span class="leise">${opts.produkt && !opts.neu ? "Produkt ändern" : "Neues Produkt"}</span></div>
    ${opts.hinweis ? `<p class="mildbox">${esc(opts.hinweis)}</p>` : ""}
    <form id="pform" class="formular" novalidate>
      <label>Was ist das?<input id="pf-name" required value="${esc(p.name)}" placeholder="zum Beispiel Schinkenwurst, Brokkoli oder Chips" autocomplete="off"></label>
      <label>Marke<input id="pf-marke" value="${esc(p.marke || "")}" autocomplete="off"></label>
      <label>Barcode<input id="pf-code" inputmode="numeric" value="${esc(p.code || "")}" autocomplete="off"></label>
      <h4 class="unter">Nährwerte pro 100 g</h4>
      <div class="foto">
        <label class="knopf voll breit">Foto der Nährwerttabelle<input id="pf-foto" type="file" accept="image/*" capture="environment" hidden></label>
        <p class="fuss">Tabelle gerade und bildfüllend fotografieren, ohne Spiegelung. Beim ersten Mal lädt die Texterkennung einmalig etwa 5 MB, danach geht es auch ohne Internet.</p>
        <div id="pf-ocr" aria-live="polite"></div>
      </div>
      <div class="raster">${PF.map(([k, lab, pflicht]) => `<label>${lab}${pflicht ? " *" : ""}<input id="pf-${k}" inputmode="decimal" value="${wert(p.n100[k])}"></label>`).join("")}</div>
      <div class="raster">
        <label>Portion in g<input id="pf-portion" inputmode="decimal" value="${wert(p.portion_g)}"></label>
        <label>Packung in g<input id="pf-packung" inputmode="decimal" value="${wert(p.packung_g)}"></label>
        <label>1 Stück wiegt (g)<input id="pf-stueck" inputmode="decimal" value="${wert(p.stueck_g)}" placeholder="zum Beispiel Ei 60"></label>
      </div>
      <p class="leise">* Pflichtfelder. Komma oder Punkt, beides geht.</p>
      <div class="sh-fuss"><button class="knopf voll" type="submit">Speichern</button>${opts.produkt && produkte[p.id] && !opts.neu ? `<button class="knopf warn" type="button" data-p="loesch">Produkt löschen</button>` : ""}</div>
    </form>`;
  $("#pf-foto", s).addEventListener("change", ev => { const f = ev.target.files && ev.target.files[0]; ev.target.value = ""; if (f) etikettAuslesen(s, f); });
  let loeschBereit = false;
  s.onclick = ev => {
    const b = ev.target.closest("[data-p]"); if (!b) return;
    if (b.dataset.p === "zurueck") opts.zurueck();
    else if (b.dataset.p === "zu") sheetSchliessen();
    else if (b.dataset.p === "loesch") {
      if (!loeschBereit) { loeschBereit = true; b.textContent = "Wirklich löschen?"; return; }
      delete produkte[p.id]; sichern("produkte", produkte); sheetSchliessen(() => toast("Produkt gelöscht"));
    }
  };
  $("#pform", s).addEventListener("submit", ev => {
    ev.preventDefault();
    const name = $("#pf-name", s).value.trim(); const code = $("#pf-code", s).value.replace(/\D/g, "");
    const n100 = {}; for (const [k] of PF) n100[k] = zahl($(`#pf-${k}`, s).value);
    const fehlt = PF.filter(([k, , pf]) => pf && n100[k] == null).map(x => x[1].replace(/ \(.*\)/, ""));
    if (!name) { toast("Bitte einen Namen eingeben"); return; }
    if (fehlt.length) { toast("Es fehlt noch: " + fehlt.join(", ")); return; }
    if (code && !/^\d{8,14}$/.test(code)) { toast("Der Barcode hat 8 bis 14 Ziffern"); return; }
    const id = code || p.id || "eig" + Date.now().toString(36);
    if (p.id && p.id !== id) delete produkte[p.id];
    const neu = produktSauber({ id, code, name, marke: $("#pf-marke", s).value.trim(), n100, portion_g: zahl($("#pf-portion", s).value), packung_g: zahl($("#pf-packung", s).value), stueck_g: zahl($("#pf-stueck", s).value), quelle: "eigen", t: Date.now() }, id);
    produkte[id] = neu; sichern("produkte", produkte); toast("Produkt gespeichert");
    if (opts.weiter) opts.weiter(neu); else sheetSchliessen();
  });
}

// ---------- Foto der Nährwerttabelle (Texterkennung auf dem Handy) ----------
// Tesseract 5.1.1 liegt in vendor/ocr und wird erst beim ersten Foto geladen. Nach 90 Sekunden ohne Foto wird es beendet,
// damit das Handy den Speicher zurückbekommt.
const OCR_PFAD = "./vendor/ocr/";
let ocrArbeiter = null, ocrLaden = null, ocrTimer = null, ocrMelden = null;
function ocrHolen() {
  if (ocrArbeiter) return Promise.resolve(ocrArbeiter);
  if (!ocrLaden) ocrLaden = (async () => {
    const T = (await import(OCR_PFAD + "tesseract.esm.min.js")).default;
    const basis = new URL(OCR_PFAD, location.href).href;
    const w = await T.createWorker("deu", 1, { workerPath: basis + "worker.min.js", corePath: basis, langPath: basis, workerBlobURL: false, gzip: true, logger: m => ocrMelden && ocrMelden(m) });
    await w.setParameters({ preserve_interword_spaces: "1" });
    ocrArbeiter = w; return w;
  })().finally(() => { ocrLaden = null; });
  return ocrLaden;
}
function ocrSpaeterBeenden() {
  clearTimeout(ocrTimer);
  ocrTimer = setTimeout(async () => { const w = ocrArbeiter; ocrArbeiter = null; if (w) { try { await w.terminate(); } catch (e) {} } }, 90000);
}
async function bildVorbereiten(datei) {
  // verkleinern, Graustufen, Kontrast strecken: das liest Tesseract deutlich besser
  // kleine Bilder werden vergrößert (Tesseract liest Ziffern ab etwa 30 px Höhe sicher), große verkleinert
  const bmp = await createImageBitmap(datei, { imageOrientation: "from-image" });
  const lang = Math.max(bmp.width, bmp.height); const f = lang > 2000 ? 2000 / lang : lang < 1600 ? Math.min(3, 2000 / lang) : 1;
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * f); c.height = Math.round(bmp.height * f);
  const g = c.getContext("2d", { willReadFrequently: true }); g.imageSmoothingQuality = "high"; g.drawImage(bmp, 0, 0, c.width, c.height); if (bmp.close) bmp.close();
  const d = g.getImageData(0, 0, c.width, c.height); const p = d.data; const n = c.width * c.height;
  const grau = new Uint8Array(n); const hist = new Uint32Array(256);
  for (let i = 0, j = 0; j < n; i += 4, j++) { const v = (p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114) | 0; grau[j] = v; hist[v]++; }
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > n * 0.02) { lo = v; break; } }
  acc = 0; for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > n * 0.02) { hi = v; break; } }
  const span = Math.max(1, hi - lo);
  for (let i = 0, j = 0; j < n; i += 4, j++) { const v = Math.max(0, Math.min(255, ((grau[j] - lo) * 255 / span) | 0)); p[i] = p[i + 1] = p[i + 2] = v; }
  g.putImageData(d, 0, 0);
  return c;
}
// Sucht in den erkannten Zeilen die Werte pro 100 g. Bei zwei Spalten (100 g und Portion) zählt die erste Zahl hinter der Bezeichnung.
function naehrwerteAusText(text) {
  const zahl1 = s => { const t = s.trim().split(/\s+/); for (let i = 0; i < t.length; i++) { const v = wertAusWort({ t: t[i], nach: t[i + 1] || "" }); if (v != null) return v; } return null; };
  let kcalErst = null;
  const regeln = [["einf", /einfach|mono/i], ["mehrf", /mehrfach|poly/i], ["skip", /unges/i], ["ges", /ges[äa]tt|gesatt|saturat/i], ["zucker", /zucker|sugar/i], ["ball", /ballast|fibre|fiber/i],
    ["eiw", /eiwei|eiweis|protein/i], ["salz", /salz|\bsalt\b/i], ["kh", /kohlen\s*-?\s*hydrat|carbohydrat/i], ["fett", /\bfett|\bfat\b/i]];
  const o = {}; let kj = null;
  for (let z of text.replace(/\r/g, "").split("\n")) {
    z = z.trim(); if (!z) continue;
    z = z.replace(/\b[oO](?=[,.]\d)/g, "0").replace(/(\d)[oO]\b/g, "$10").replace(/(\d)\s+([,.])\s*(\d)/g, "$1$2$3");
    const kc = z.match(/(\d+(?:[.,]\d+)?)\s*k\s*c\s*a\s*[l1iI|]/i);
    if (kc && kcalErst == null) kcalErst = Number(kc[1].replace(",", "."));
    const kjm = z.match(/(\d+(?:[.,]\d+)?)\s*k\s*[jJ)]/); if (kjm && kj == null) kj = Number(kjm[1].replace(",", "."));
    if (kc || kjm) continue;
    if (/brennwert|energie/i.test(z) && kcalErst == null) {
      // Schreibweise „Brennwert kJ/kcal 1046/250“: erst kJ, dann kcal
      const nums = [...z.matchAll(/(\d+(?:[.,]\d+)?)/g)].map(m => Number(m[1].replace(",", ".")));
      if (nums.length >= 2 && nums[0] > nums[1] * 3) { kj = nums[0]; kcalErst = nums[1]; }
      else if (nums.length === 1 && /kcal/i.test(z)) kcalErst = nums[0];
      continue;
    }
    for (const [k, re] of regeln) {
      const m = re.exec(z); if (!m) continue;
      if (k === "skip") break;
      if (k === "fett" && /s[äa]ure/i.test(z)) break;
      if (o[k] == null) { const v = zahl1(z.slice(m.index + m[0].length)); if (v != null) o[k] = v; }
      break;
    }
  }
  // kJ steht immer in der ersten Spalte (pro 100 g). Passt die erste kcal-Zahl nicht dazu, stammt sie meist aus der Portionsspalte.
  if (kj != null) { const ausKj = kj / 4.184; o.kcal = kcalErst != null && Math.abs(kcalErst - ausKj) <= ausKj * 0.06 ? kcalErst : Math.round(ausKj); }
  else if (kcalErst != null) o.kcal = kcalErst;
  // unplausible Zahlen verwerfen
  for (const k of Object.keys(o)) if (!(o[k] >= 0) || o[k] > (k === "kcal" ? 950 : 100)) delete o[k];
  return o;
}
// Zweiter Weg über die Lage der Wörter im Bild: Die Reihenfolge der Zeilen in der Nährwerttabelle ist gesetzlich
// festgelegt (LMIV Anhang XV). Auf gewölbten Bechern stehen Bezeichnung und Zahl oft nicht auf einer Zeile,
// deshalb werden die Zahlen der ersten Spalte von oben nach unten der Reihe nach den Zeilen zugeordnet.
const LMIV_REIHE = ["fett", "ges", "einf", "mehrf", "kh", "zucker", "ball", "eiw", "salz"];
const LMIV_PFLICHT = ["fett", "ges", "kh", "zucker", "eiw", "salz"];
const LABEL = { fett: /^(fett|fat)[,.:]?$/i, ges: /ges[äa]tt|saturat/i, einf: /einfach|mono/i, mehrf: /mehrfach|poly/i, kh: /kohlen|carbohydrat/i, zucker: /zucker|sugar/i, ball: /ballast|fibre|fiber/i, eiw: /eiwe|eiwei|protein|^ei.{1,3}[ßsB]$/i, salz: /^(salz|salt)/i };
function woerterAus(data) {
  const l = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const li of p.lines || []) {
    const ws = li.words || [];
    ws.forEach((w, i) => l.push({ t: w.text || "", x: (w.bbox.x0 + w.bbox.x1) / 2, y: (w.bbox.y0 + w.bbox.y1) / 2, h: Math.max(1, w.bbox.y1 - w.bbox.y0), nach: ws[i + 1] ? ws[i + 1].text : "" }));
  }
  return l;
}
function wertAusWort(w) {
  if (/%|\//.test(w.t)) return null;
  const t = w.t.replace(/^[<≤(]+/, "").replace(/[)]+$/, "").replace(/[oO](?=[,.-]?\d)/g, "0").replace(/(\d[,.-]?)[oO]/g, "$10").replace(/(\d)-(\d)/, "$1,$2");
  const m = t.match(/^(\d{1,3})(?:[,.](\d{1,3}))?(g|9)?$/i); if (!m) return null;
  let dez = m[2] || "";
  // „5,2g“ liest Tesseract oft als „5,29“: zweite Nachkommastelle 9 ohne eigenes g dahinter ist meist das g
  if (!m[3] && dez.length >= 2 && dez.endsWith("9") && !/^g$/i.test(w.nach)) dez = dez.slice(0, -1);
  let ganz = m[1];
  // „19 g“ wird zu „199g“: über 100 g pro 100 g geht nicht, dann war die letzte 9 das Leerzeichen mit g
  if (!dez && ganz.length >= 2 && Number(ganz) >= 100 && ganz.endsWith("9")) ganz = ganz.slice(0, -1);
  const v = Number(ganz + (dez ? "." + dez : ""));
  return isFinite(v) && v < 100 ? v : null;
}
function naehrwerteAusLage(data, breite) {
  const w = woerterAus(data); if (!w.length) return {};
  const energie = w.filter(x => /kcal|k[jJ)]/.test(x.t));
  const yE = energie.length ? Math.max(...energie.map(x => x.y)) : -Infinity;
  const hE = energie.length ? Math.max(...energie.map(x => x.h)) : 0;
  const labels = [];
  for (const x of w) for (const k of LMIV_REIHE) if (LABEL[k].test(x.t) && !(k === "ges" && /unges/i.test(x.t))) { labels.push({ k, y: x.y, x: x.x }); break; }
  const labelX = labels.length ? Math.max(...labels.map(l => l.x)) : 0;
  const zahlen = w.filter(x => x.y > yE + hE * 0.6 && x.x > labelX).map(x => ({ ...x, v: wertAusWort(x) })).filter(x => x.v != null).sort((a, b) => a.x - b.x);
  if (!zahlen.length) return {};
  // Spalten bilden, die linke ist „pro 100 g“
  const spalten = []; for (const z of zahlen) { const s = spalten[spalten.length - 1]; if (s && z.x - s[s.length - 1].x < breite * 0.07) s.push(z); else spalten.push([z]); }
  const spalte = (spalten.find(s => s.length >= 2) || spalten[0]).sort((a, b) => a.y - b.y);
  const gefunden = new Set(labels.map(l => l.k));
  const reihe = LMIV_REIHE.filter(k => LMIV_PFLICHT.includes(k) || gefunden.has(k));
  const o = {};
  if (spalte.length === reihe.length) reihe.forEach((k, i) => { o[k] = spalte[i].v; });
  else {
    // Zahl und Bezeichnung passen nicht auf: nächstgelegene Zahl je Bezeichnung nehmen
    const frei = new Set(spalte);
    for (const l of labels.sort((a, b) => a.y - b.y)) {
      let best = null; for (const z of frei) if (!best || Math.abs(z.y - l.y) < Math.abs(best.y - l.y)) best = z;
      // eng halten: lieber ein Feld leer lassen als einen Wert aus der Nachbarzeile eintragen
      if (best && Math.abs(best.y - l.y) < best.h * 0.7 && o[l.k] == null) { o[l.k] = best.v; frei.delete(best); }
    }
  }
  return o;
}
async function etikettAuslesen(s, datei) {
  const box = $("#pf-ocr", s); if (!box) return;
  const url = URL.createObjectURL(datei);
  box.innerHTML = `<img class="ocr-bild" src="${url}" alt="Dein Foto der Nährwerttabelle"><p class="lade" id="ocr-status">Bereite das Foto vor …</p>`;
  const status = t => { const e = $("#ocr-status", s); if (e) e.textContent = t; };
  ocrMelden = m => {
    const pz = m.progress ? ` ${Math.round(m.progress * 100)} %` : "";
    status(m.status === "recognizing text" ? "Lese die Tabelle …" + pz : "Texterkennung wird geladen …" + pz);
  };
  try {
    const bild = await bildVorbereiten(datei);
    const w = await ocrHolen();
    status("Lese die Tabelle …");
    const { data } = await w.recognize(bild, {}, { text: true, blocks: true });
    const ausText = naehrwerteAusText(data.text || ""); const ausLage = naehrwerteAusLage(data, bild.width);
    const werte = Object.assign({}, ausText, ausLage); if (ausText.kcal != null) werte.kcal = ausText.kcal;
    const keys = Object.keys(werte);
    for (const [k] of PF) { const inp = $("#pf-" + k, s); if (!inp) continue; inp.classList.remove("auto"); if (werte[k] != null) { inp.value = String(werte[k]).replace(".", ","); inp.classList.add("auto"); } }
    let warn = "";
    if (werte.kcal != null && werte.eiw != null && werte.kh != null && werte.fett != null) {
      const rechn = werte.eiw * 4 + werte.kh * 4 + werte.fett * 9;
      if (rechn > 0 && Math.abs(rechn - werte.kcal) / werte.kcal > 0.2) warn = " Die Kalorien passen nicht ganz zu Eiweiß, Fett und Kohlenhydraten, schau bitte genau hin.";
    }
    status(keys.length ? `${keys.length} ${keys.length === 1 ? "Wert" : "Werte"} erkannt und grün markiert. Bitte mit dem Foto vergleichen und fehlende Felder ergänzen.${warn}` : "Auf dem Foto habe ich keine Werte gefunden. Versuch es näher und gerader, oder trag die Werte von Hand ein.");
    fehlerMerken("Info, Foto ausgelesen: " + (keys.join(",") || "nichts erkannt"));
  } catch (e) {
    fehlerMerken("Texterkennung: " + (e && e.message || e));
    status("Das Foto ließ sich nicht auslesen. Trag die Werte bitte von Hand ein.");
  } finally {
    ocrMelden = null; ocrSpaeterBeenden();
  }
}

// ---------- Barcode-Scanner ----------
async function detektorHolen() {
  if ("BarcodeDetector" in window) {
    try { const f = await window.BarcodeDetector.getSupportedFormats(); if (f.includes("ean_13")) return window.BarcodeDetector; } catch (e) {}
  }
  const m = await import(BARCODE_POLYFILL);
  const wasm = new URL(ZXING_WASM, location.href).href;
  m.setZXingModuleOverrides({ locateFile: (pfad, prefix) => pfad.endsWith(".wasm") ? wasm : prefix + pfad });
  return m.BarcodeDetector;
}
function scannerOeffnen(beiCode) {
  let stream = null, timer = null, aus = false, gefunden = null;
  sheetOeffnen((s, ent) => {
    s.classList.add("scanner");
    s.innerHTML = `
      <div class="sh-kopf"><button class="rund" data-c="zu" aria-label="Schließen">×</button><span>Barcode scannen</span><button class="rund" data-c="licht" hidden aria-label="Licht">☀</button></div>
      <div class="kamera"><video id="vid" playsinline muted></video><div class="rahmen"></div></div>
      <p class="leise" id="sc-status">Kamera startet …</p>
      <form id="sc-form" class="code-hand"><input id="sc-code" inputmode="numeric" placeholder="Oder Zahlen unter dem Strichcode eintippen" autocomplete="off"><button class="knopf voll" type="submit">Los</button></form>`;
    const stop = () => { aus = true; clearTimeout(timer); if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; };
    ent.onClose = stop;
    const fertig = code => { if (gefunden) return; gefunden = code; stop(); if (navigator.vibrate) navigator.vibrate(60); sheetSchliessen(() => beiCode(code)); };
    s.onclick = async ev => {
      const b = ev.target.closest("[data-c]"); if (!b) return;
      if (b.dataset.c === "zu") sheetSchliessen();
      else if (b.dataset.c === "licht" && stream) {
        const tr = stream.getVideoTracks()[0]; const an = b.getAttribute("aria-pressed") !== "true";
        try { await tr.applyConstraints({ advanced: [{ torch: an }] }); b.setAttribute("aria-pressed", String(an)); } catch (e) { toast("Licht geht hier nicht"); }
      }
    };
    $("#sc-form", s).addEventListener("submit", ev => { ev.preventDefault(); const c = $("#sc-code", s).value.replace(/\D/g, ""); if (c) fertig(c); });
    (async () => {
      const status = $("#sc-status", s);
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { status.textContent = "Kamera geht nur über https. Tippe die Zahlen unter dem Strichcode ein."; return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        if (aus) { stream.getTracks().forEach(t => t.stop()); return; }
        const v = $("#vid", s); v.srcObject = stream; await v.play();
        const tr = stream.getVideoTracks()[0]; const caps = tr.getCapabilities ? tr.getCapabilities() : {};
        if (caps.torch) $("[data-c=licht]", s).hidden = false;
        status.textContent = "Halte den Strichcode in den Rahmen.";
        const Det = await detektorHolen(); const det = new Det({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] });
        const runde = async () => {
          if (aus) return;
          try { if (v.readyState >= 2) { const c = await det.detect(v); if (c && c.length) { fertig(c[0].rawValue); return; } } } catch (e) { fehlerMerken("Scan: " + e.message); }
          timer = setTimeout(runde, 250);
        };
        runde();
      } catch (e) {
        fehlerMerken("Kamera: " + e.name + " " + e.message);
        status.textContent = e.name === "NotAllowedError" ? "Kamera nicht erlaubt. Erlaube sie in den Browser-Einstellungen oder tippe die Zahlen ein." : "Kamera startet nicht. Tippe die Zahlen unter dem Strichcode ein.";
      }
    })();
  }, { voll: true });
}

// ---------- Eigenes Rezept ----------
// Live-Übersicht im Editor: alle Zutaten zusammengerechnet, geteilt durch die Portionen
function editorSumme(r) {
  if (!r.zutaten.length) return "";
  const pp = rezeptProPortion(r); const n = pp.n; const g = r.zutaten.reduce((a, z) => a + (z.gramm || 0), 0) / (r.portionen || 1);
  return `<section class="karte summe-karte">
    <h4 class="unter">Eine Portion (${f0(g)} g)</h4>
    <div class="vorschau"><div><span class="gross zahl">${f0(n.kcal)}</span><span class="leise">kcal</span></div><div><b class="zahl">${f1(n.eiw)} g</b><span class="leise">Eiweiß</span></div><div><b class="zahl">${f1(n.kh)} g</b><span class="leise">Kohlenh.</span></div><div><b class="zahl">${f1(n.fett)} g</b><span class="leise">Fett</span></div></div>
    <details class="mehr"><summary>Alle Nährwerte pro Portion</summary>${naehrTabelleKurz(n)}</details>
    ${pp.fehlt ? `<p class="fuss">Bei einer Zutat fehlen Werte, die Summe ist dann zu niedrig.</p>` : ""}
  </section>`;
}
function rezeptEditor(alt) {
  const r = alt ? JSON.parse(JSON.stringify(alt)) : { id: "eig" + Date.now().toString(36), eigen: true, name: "", portionen: 2, scharf: "mild", mild: "", zutaten: [], steps: [], tipp: "" };
  sheetOeffnen(s => {
    const zeichnen = () => {
      s.innerHTML = `
      <div class="sh-kopf"><button class="rund" data-e="zu" aria-label="Schließen">×</button><span class="leise">${alt ? "Rezept ändern" : "Neues Rezept"}</span></div>
      <div class="formular">
        <label>Name<input id="re-name" value="${esc(r.name)}" autocomplete="off"></label>
        <label>Soße oder Zusatz (optional)<input id="re-mit" value="${esc(r.mit || "")}" placeholder="zum Beispiel Kräuterquark" autocomplete="off"></label>
        <div class="raster">
          <label>Portionen<input id="re-por" inputmode="numeric" value="${esc(r.portionen)}"></label>
          <label>Schärfe<select id="re-scharf">${Object.entries(SCHARF).map(([k, v]) => `<option value="${k}" ${r.scharf === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        </div>
        <h4 class="unter">Zutaten für alle Portionen</h4>
        <ul class="zl edit">${r.zutaten.map((z, i) => `<li><span class="m">${f0(z.gramm)} g</span><span>${esc(z.name)}${z.anzeige ? `<span class="h">${esc(z.anzeige)}</span>` : ""}</span><button class="rund klein" data-e="z-weg" data-i="${i}" aria-label="${esc(z.name)} entfernen">×</button></li>`).join("") || `<li class="leise">Noch keine Zutaten. Füg sie aus deinen Produkten, der Lebensmittelsuche oder per Barcode hinzu, in Gramm oder Stück.</li>`}</ul>
        <button class="knopf breit" data-e="z-neu" type="button">Zutat hinzufügen</button>
        <div id="re-summe">${editorSumme(r)}</div>
        <label>Zubereitung, ein Schritt pro Zeile<textarea id="re-steps" rows="6">${esc((r.steps || []).join("\n"))}</textarea></label>
        <label>So wird es mild (optional)<textarea id="re-mild" rows="2">${esc(r.mild || "")}</textarea></label>
      </div>
      <div class="sh-fuss"><button class="knopf voll" data-e="speichern">Rezept speichern</button></div>`;
    };
    const lesen = () => {
      r.name = $("#re-name", s).value.trim(); r.mit = $("#re-mit", s).value.trim();
      r.portionen = Math.max(1, Math.min(20, parseInt($("#re-por", s).value, 10) || 1));
      r.scharf = $("#re-scharf", s).value; r.mild = $("#re-mild", s).value.trim();
      r.steps = $("#re-steps", s).value.split("\n").map(x => x.trim()).filter(Boolean);
    };
    zeichnen();
    // Portionen ändern: Übersicht sofort neu rechnen
    s.addEventListener("input", ev => { if (ev.target.id === "re-por") { const p = parseInt(ev.target.value, 10); if (p >= 1 && p <= 20) { r.portionen = p; $("#re-summe", s).innerHTML = editorSumme(r); } } });
    s.addEventListener("click", ev => {
      const b = ev.target.closest("[data-e]"); if (!b) return; const a = b.dataset.e;
      if (a === "zu") sheetSchliessen();
      else if (a === "z-weg") { lesen(); r.zutaten.splice(+b.dataset.i, 1); zeichnen(); }
      else if (a === "z-neu") { lesen(); suchSheet({ modus: "zutat", onPick: (lm, g, anzeige) => { r.zutaten.push({ name: lm.name, gramm: Math.round(g), anzeige: anzeige || "", n100: lm.n100, ref: lm.ref }); zeichnen(); } }); }
      else if (a === "speichern") {
        lesen();
        if (!r.name) { toast("Bitte einen Namen eingeben"); return; }
        if (!r.zutaten.length) { toast("Bitte mindestens eine Zutat hinzufügen"); return; }
        const i = eigeneRezepte.findIndex(x => x.id === r.id); const sauber = Object.assign({}, r); delete sauber.nr;
        if (i >= 0) eigeneRezepte[i] = sauber; else eigeneRezepte.push(sauber);
        sichern("rezepte", eigeneRezepte); sheetSchliessen(() => toast("Rezept gespeichert"));
      }
    });
  }, { voll: true });
}

// ---------- Einkauf ----------
// Die Liste startet leer. Rezepte kommen mit Portionen dazu, ihre Zutaten werden zusammengezählt.
// Einzelne Rezeptzutaten lassen sich ausblenden (weg) oder mit eigener Menge versehen (anders).
// Eigene Einträge stehen frei daneben.
function rezeptSchluessel(r) { return r.eigen ? (r.zutaten || []).map(z => "o:" + norm(z.name)) : [...r.z, ...r.s].filter(i => i.c).map(i => i.c); }
function rezeptAufListe(id, por) {
  const r = rezeptNach(id); if (!r) return;
  const x = liste.rezepte.find(e => e.id === id);
  if (x) x.por = Math.min(20, x.por + por); else liste.rezepte.push({ id, por: Math.min(20, por) });
  for (const k of rezeptSchluessel(r)) { delete liste.weg[k]; delete liste.chk[k]; }
  sichern("liste", liste);
}
function sammeln() {
  const map = {};
  for (const lr of liste.rezepte) {
    const r = rezeptNach(lr.id); if (!r) continue;
    if (r.eigen) {
      const f = lr.por / (r.portionen || 1);
      for (const z of r.zutaten || []) { const k = "o:" + norm(z.name); const m = map[k] || (map[k] = { key: k, name: z.name, gang: "sonst", u: "g", sum: 0, refs: new Set() }); m.sum += z.gramm * f; m.refs.add(r.nr); }
      continue;
    }
    for (const it of [...r.z, ...r.s]) {
      if (!it.c) continue; const b = BASIS[it.c];
      const m = map[it.c] || (map[it.c] = { key: it.c, c: it.c, name: b.n, gang: b.gang, u: b.u, sum: 0, refs: new Set() });
      if (typeof it.a === "number" && (!it.u || it.u === b.u)) m.sum += it.a * lr.por;
      m.refs.add(r.nr);
    }
  }
  const zeilen = Object.values(map).filter(m => !liste.weg[m.key]).map(m => Object.assign(m, { aus: "rezept",
    t: liste.anders[m.key] != null ? { main: liste.anders[m.key] } : (m.gang === "vorrat" ? null : kaufText(m)) }));
  for (const e of liste.eigene) zeilen.push({ key: "e:" + e.id, id: e.id, name: e.name, gang: e.gang, aus: "eigen", refs: new Set(), t: e.menge ? { main: e.menge } : null });
  return zeilen;
}
function kaufText(m) {
  const b = m.c ? BASIS[m.c] : null; const s = m.sum;
  if (b && b.buy) return b.buy(s);
  if (m.u === "g") return { main: s >= 1000 ? (s / 1000).toLocaleString("de-DE", { maximumFractionDigits: 2 }) + " kg" : Math.round(s) + " g" };
  if (m.u === "Stück") return { main: Math.ceil(s) + " Stück", sub: s % 1 ? "du brauchst " + fmtNum(s) : "" };
  return { main: fmtNum(s) + " " + m.u };
}
function viewEinkauf() {
  const zeilen = sammeln();
  const rez = liste.rezepte.map(lr => ({ lr, r: rezeptNach(lr.id) })).filter(x => x.r);
  let gesamt = 0, erledigt = 0, html = "";
  for (const [g, titel] of GAENGE) {
    const l = zeilen.filter(z => z.gang === g); if (!l.length) continue;
    html += `<div class="gang${g === "vorrat" ? " vorrat" : ""}"><h3>${titel}<small>${l.length}</small></h3><ul class="posten">${l.map(z => {
      const on = !!liste.chk[z.key]; gesamt++; if (on) erledigt++;
      const refs = [...z.refs].sort((a, b) => a - b).map(n => `<button type="button" data-act="zu-rezept" data-nr="${n}">${n}</button>`).join(" · ");
      return `<li><label><input type="checkbox" data-chk="${esc(z.key)}" ${on ? "checked" : ""}><span class="name">${esc(z.name)}<span class="refs">${refs ? "für Rezept " + refs : "eigener Eintrag"}</span></span><span class="menge">${z.t ? esc(z.t.main) + (z.t.sub ? `<small>${esc(z.t.sub)}</small>` : "") : ""}</span></label><button class="rund klein" data-act="l-edit" data-k="${esc(z.key)}" aria-label="${esc(z.name)} ändern oder entfernen">✎</button></li>`;
    }).join("")}</ul></div>`;
  }
  return `<h2 class="seitentitel">Einkaufsliste</h2>
  <div class="knoepfe"><button class="knopf voll" data-act="l-bib">Rezept hinzufügen</button><button class="knopf" data-act="l-eigen">Eigener Eintrag</button></div>
  ${rez.length ? `<section class="karte"><h3>Rezepte auf der Liste</h3><ul class="l-rez">${rez.map(({ lr, r }) => `<li>
      <span class="en"><b>${esc(r.name)}</b><small>Rezept ${r.nr} · ${lr.por === 1 ? "1 Portion" : lr.por + " Portionen"}</small></span>
      <div class="stepper"><button data-act="l-por" data-id="${esc(r.id)}" data-d="-1" aria-label="Eine Portion weniger" ${lr.por <= 1 ? "disabled" : ""}>−</button><output class="zahl">${lr.por}</output><button data-act="l-por" data-id="${esc(r.id)}" data-d="1" aria-label="Eine Portion mehr">+</button></div>
      <button class="rund klein" data-act="l-rez-weg" data-id="${esc(r.id)}" aria-label="${esc(r.name)} von der Liste nehmen">×</button></li>`).join("")}</ul></section>` : ""}
  ${gesamt ? `<div class="stand"><span class="zahl">${erledigt} von ${gesamt} erledigt</span><div class="knoepfe"><button class="knopf" data-act="kopieren">Kopieren</button>${erledigt ? `<button class="knopf" data-act="l-erledigt">Erledigte entfernen</button>` : ""}<button class="knopf warn" data-act="l-leeren">Liste leeren</button></div></div>` : ""}
  ${html || `<section class="karte"><h3>Deine Liste ist leer</h3><p class="leise">Füg Rezepte aus deiner Sammlung hinzu, dann stehen ihre Zutaten hier zusammengerechnet. Oder trag selbst ein, was du brauchst, zum Beispiel Gemüse oder Obst.</p></section>`}`;
}
function listeAlsText() {
  const zeilen = sammeln(); const out = [];
  for (const [g, titel] of GAENGE) {
    const l = zeilen.filter(z => z.gang === g && !liste.chk[z.key]); if (!l.length) continue;
    out.push(titel + ":"); for (const z of l) out.push("• " + z.name + (z.t ? ": " + z.t.main : "")); out.push("");
  }
  return out.join("\n").trim() || "Alles erledigt.";
}

// Rezept-Bibliothek: alle Rezepte durchsuchen und mit Portionen auf die Liste setzen
function rezeptBibliothek() {
  let filter = ui.filter === "mild" ? "mild" : "alle", q = "", gewaehlt = null, por = 2;
  sheetOeffnen(s => {
    const liste_ = () => alleRezepte().filter(r => (filter === "alle" || (r.scharf || "mild") === "mild") && (!q || norm(r.name + " " + (r.mit || "")).includes(norm(q))));
    const zeichnen = () => {
      if (gewaehlt) {
        const r = rezeptNach(gewaehlt); const pp = rezeptProPortion(r);
        s.innerHTML = `<div class="sh-kopf"><button class="rund" data-b="zurueck" aria-label="Zurück">‹</button><span class="leise">Rezept ${r.nr}</span></div>
          <h2>${esc(r.name)}</h2>${r.mit ? `<p class="mit">mit ${esc(r.mit)}</p>` : ""}
          ${pp.fehlt && !r.eigen ? "" : `<p class="leise">${f0(pp.n.kcal)} kcal und ${f0(pp.n.eiw)} g Eiweiß pro Portion</p>`}
          <div class="por-zeile"><span>Wie viele Portionen?</span><div class="stepper gross"><button data-b="por-" aria-label="Weniger" ${por <= 1 ? "disabled" : ""}>−</button><output class="zahl">${por}</output><button data-b="por+" aria-label="Mehr">+</button></div></div>
          <div class="sh-fuss"><button class="knopf voll" data-b="dazu">Auf die Einkaufsliste</button></div>`;
        return;
      }
      const l = liste_();
      s.innerHTML = `<div class="sh-kopf"><button class="rund" data-b="zu" aria-label="Schließen">×</button><span class="leise">Rezept auf die Liste setzen</span><button class="knopf" data-b="zu">Fertig</button></div>
        <input id="bib-suche" type="search" placeholder="Rezept suchen" autocomplete="off" value="${esc(q)}" aria-label="Rezept suchen">
        <div class="chips"><button class="chip" data-b="f" data-v="alle" aria-pressed="${filter === "alle"}">Alle</button><button class="chip" data-b="f" data-v="mild" aria-pressed="${filter === "mild"}">Nur mild</button></div>
        <ul class="treffer">${l.map(r => { const auf = liste.rezepte.find(x => x.id === r.id); const pp = rezeptProPortion(r);
          return `<li><button data-b="wahl" data-id="${esc(r.id)}"><span class="en"><b>${esc(r.name)}</b><small>${r.mit ? "mit " + esc(r.mit) : "eigenes Rezept"}${SCHARF[r.scharf] && r.scharf !== "mild" ? " · " + SCHARF[r.scharf] : ""}${auf ? ` · schon auf der Liste (${auf.por} P.)` : ""}</small></span><span class="zahl leise">${pp.fehlt && !r.eigen ? "" : f0(pp.n.kcal) + " kcal"}</span></button></li>`; }).join("") || `<li class="leise">Kein Rezept gefunden.</li>`}</ul>`;
      const i = $("#bib-suche", s); i.addEventListener("input", () => { q = i.value; const pos = i.selectionStart; zeichnen(); const n = $("#bib-suche", s); n.focus(); n.setSelectionRange(pos, pos); });
    };
    zeichnen();
    s.onclick = ev => {
      const b = ev.target.closest("[data-b]"); if (!b) return; const a = b.dataset.b;
      if (a === "zu") sheetSchliessen();
      else if (a === "f") { filter = b.dataset.v; zeichnen(); }
      else if (a === "wahl") { gewaehlt = b.dataset.id; por = 2; zeichnen(); }
      else if (a === "zurueck") { gewaehlt = null; zeichnen(); }
      else if (a === "por-") { if (por > 1) { por--; zeichnen(); } }
      else if (a === "por+") { if (por < 20) { por++; zeichnen(); } }
      else if (a === "dazu") { const r = rezeptNach(gewaehlt); rezeptAufListe(gewaehlt, por); toast(`${r.name}: ${por} ${por === 1 ? "Portion" : "Portionen"} auf der Liste`); gewaehlt = null; zeichnen(); }
    };
  }, { voll: true });
}

// Eigenen Eintrag anlegen oder einen Listeneintrag ändern
function listenEintragSheet(key) {
  const zeile = key ? sammeln().find(z => z.key === key) : null;
  const eigen = !zeile || zeile.aus === "eigen";
  const e = zeile && eigen ? liste.eigene.find(x => "e:" + x.id === key) : null;
  sheetOeffnen(s => {
    const zeichnen = () => {
      const gaenge = GAENGE.map(([g, t]) => `<option value="${g}" ${(e ? e.gang : "gemuese") === g ? "selected" : ""}>${esc(t)}</option>`).join("");
      s.innerHTML = `<div class="sh-kopf"><button class="rund" data-l="zu" aria-label="Schließen">×</button><span class="leise">${zeile ? "Eintrag ändern" : "Eigener Eintrag"}</span></div>
        ${zeile && !eigen ? `<h2>${esc(zeile.name)}</h2><p class="leise">Kommt aus Rezept ${[...zeile.refs].sort((a, b) => a - b).join(", ")}.${zeile.sum > 0 ? " Gerechnet: " + esc(kaufText(zeile).main) + "." : ""}</p>` : ""}
        <form id="l-form" class="formular" novalidate>
          ${eigen ? `<label>Was?<input id="l-name" value="${esc(e ? e.name : "")}" placeholder="zum Beispiel Zucchini" autocomplete="off"></label>` : ""}
          <label>Menge (optional)<input id="l-menge" value="${esc(eigen ? (e ? e.menge : "") : (liste.anders[key] != null ? liste.anders[key] : (zeile.t ? zeile.t.main : "")))}" placeholder="zum Beispiel 2 Stück oder 500 g" autocomplete="off"></label>
          ${eigen ? `<label>Wo im Laden?<select id="l-gang">${gaenge}</select></label>` : ""}
          <div class="sh-fuss">
            <button class="knopf voll" type="submit">${zeile ? "Speichern" : "Hinzufügen"}</button>
            ${!zeile ? `<button class="knopf" type="button" data-l="zu">Fertig</button>` : ""}
            ${zeile && !eigen && liste.anders[key] != null ? `<button class="knopf" type="button" data-l="rechnen">Gerechnete Menge</button>` : ""}
            ${zeile ? `<button class="knopf warn" type="button" data-l="weg">Von der Liste nehmen</button>` : ""}
          </div>
        </form>`;
      if (eigen && !zeile) setTimeout(() => $("#l-name", s) && $("#l-name", s).focus(), 50);
      $("#l-form", s).addEventListener("submit", ev => {
        ev.preventDefault();
        const menge = str($("#l-menge", s).value.trim(), 40);
        if (eigen) {
          const name = str($("#l-name", s).value.trim(), 120); if (!name) { toast("Bitte eintragen, was du brauchst"); return; }
          const gang = $("#l-gang", s).value;
          if (e) Object.assign(e, { name, menge, gang });
          else liste.eigene.push({ id: "l" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name, menge, gang });
          sichern("liste", liste);
          if (zeile) sheetSchliessen(() => toast("Gespeichert"));
          else { toast(`${name} steht auf der Liste`); $("#l-name", s).value = ""; $("#l-menge", s).value = ""; $("#l-name", s).focus(); }
        } else {
          if (menge) liste.anders[key] = menge; else delete liste.anders[key];
          sichern("liste", liste); sheetSchliessen(() => toast("Gespeichert"));
        }
      });
    };
    zeichnen();
    s.onclick = ev => {
      const b = ev.target.closest("[data-l]"); if (!b) return;
      if (b.dataset.l === "zu") sheetSchliessen();
      else if (b.dataset.l === "rechnen") { delete liste.anders[key]; sichern("liste", liste); sheetSchliessen(() => toast("Gerechnete Menge gilt wieder")); }
      else if (b.dataset.l === "weg") {
        if (eigen) liste.eigene = liste.eigene.filter(x => "e:" + x.id !== key); else liste.weg[key] = 1;
        delete liste.chk[key]; delete liste.anders[key]; sichern("liste", liste); sheetSchliessen(() => toast("Von der Liste genommen"));
      }
    };
  });
}
function produktAufListe(lm) {
  const name = lm.sub && lm.sub !== "BLS" && lm.sub !== "eigenes Produkt" ? `${lm.name} (${lm.sub})` : lm.name;
  if (liste.eigene.some(x => x.name === name)) { toast("Steht schon auf der Liste"); return; }
  liste.eigene.push({ id: "l" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: str(name, 120), menge: "", gang: "sonst" });
  sichern("liste", liste); toast("Auf der Einkaufsliste");
}

// ---------- Profil ----------
function viewProfil() {
  const prod = Object.values(produkte).sort((a, b) => a.name.localeCompare(b.name, "de"));
  const log = laden("log", []);
  const p = profil;
  return `<h2 class="seitentitel">Profil und Ziele</h2>
  <section class="karte">
    <h3>Tagesziele</h3>
    <form id="ziele-form" class="formular raster" novalidate>
      <label>Kalorien (kcal)<input id="z-kcal" inputmode="numeric" value="${esc(ziele.kcal)}"></label>
      <label>Eiweiß (g)<input id="z-eiw" inputmode="numeric" value="${esc(ziele.eiw)}"></label>
      <label>Kohlenhydrate (g)<input id="z-kh" inputmode="numeric" value="${esc(ziele.kh)}"></label>
      <label>Fett (g)<input id="z-fett" inputmode="numeric" value="${esc(ziele.fett)}"></label>
      <button class="knopf voll" type="submit">Ziele speichern</button>
    </form>
  </section>
  <details class="karte">
    <summary>Ziele ausrechnen lassen</summary>
    <form id="rechner" class="formular" novalidate>
      <div class="raster">
        <label>Geschlecht<select id="p-geschlecht"><option value="m" ${p.geschlecht === "m" ? "selected" : ""}>Mann</option><option value="w" ${p.geschlecht === "w" ? "selected" : ""}>Frau</option></select></label>
        <label>Alter<input id="p-alter" inputmode="numeric" value="${esc(p.alter)}"></label>
        <label>Größe (cm)<input id="p-groesse" inputmode="numeric" value="${esc(p.groesse)}"></label>
        <label>Gewicht (kg)<input id="p-gewicht" inputmode="decimal" value="${esc(String(p.gewicht).replace(".", ","))}"></label>
      </div>
      ${regler("alltag", "Alltag und Beruf, ohne Sport", 0, 3, 1, p.alltag)}
      ${garmin ? `<p class="mildbox">Dein Sport kommt jeden Tag von der Garmin-Uhr dazu. Deshalb rechnet der Rechner hier ohne Sport, sonst würde er doppelt zählen.</p>` : ""}
      <div id="sport-box" ${garmin ? "hidden" : ""}>
      ${regler("tage", "Sport pro Woche", 0, 7, 1, p.tage)}
      ${regler("dauer", "Dauer einer Einheit", 15, 150, 15, p.dauer)}
      ${regler("intens", "Wie anstrengend?", 0, 2, 1, p.intens)}
      </div>
      <label>Ziel<select id="p-ziel">
        <option value="ab" ${p.ziel === "ab" ? "selected" : ""}>Abnehmen und Muskeln halten</option>
        <option value="halten" ${p.ziel === "halten" ? "selected" : ""}>Gewicht halten</option>
        <option value="auf" ${p.ziel === "auf" ? "selected" : ""}>Muskeln aufbauen</option></select></label>
      <div id="tempo-box" ${p.ziel === "ab" ? "" : "hidden"}>${regler("tempo", "Wie schnell abnehmen?", 0, 2, 1, p.tempo)}</div>
    </form>
    <div id="rechner-erg">${rechnerErgebnis(p)}</div>
    <p class="fuss">Grundumsatz nach Mifflin-St Jeor. Alltag als PAL-Wert nach der Deutschen Gesellschaft für Ernährung. Sport über MET-Werte aus dem Compendium of Physical Activities, Ruheumsatz abgezogen. Abnehmen: rund 7.700 kcal je Kilo Körperfett. Eiweiß 2 g je kg beim Abnehmen, sonst 1,6 bis 1,8 g, bei starkem Übergewicht bezogen auf das Normalgewicht. Fett 25 % der Kalorien, der Rest Kohlenhydrate. Ein Startwert, keine ärztliche Beratung: nach 2 bis 3 Wochen am Gewichtsverlauf nachjustieren.</p>
  </details>
  ${garminProfilKarte()}
  <details class="karte">
    <summary>Meine Produkte (${prod.length})</summary>
    <ul class="treffer">${prod.map(x => `<li><button data-act="produkt-edit" data-id="${esc(x.id)}"><span class="en"><b>${esc(x.name)}</b><small>${esc(x.marke || "")}${x.code ? " · " + esc(x.code) : ""}${x.quelle === "off" ? " · Open Food Facts" : " · selbst erfasst"}</small></span><span class="zahl leise">${f0(x.n100.kcal)} kcal/100 g</span></button></li>`).join("") || `<li class="leise">Noch keine. Jedes gescannte Produkt landet hier.</li>`}</ul>
  </details>
  <section class="karte">
    <h3>Datensicherung</h3>
    <p class="leise">Alles liegt nur auf diesem Handy. Sichere ab und zu eine Datei, zum Beispiel in Google Drive.</p>
    <div class="knoepfe"><button class="knopf voll" data-act="export">Sicherung herunterladen</button><label class="knopf">Sicherung einspielen<input id="import" type="file" accept="application/json,.json" hidden></label></div>
  </section>
  <section class="karte">
    <h3>App-Version ${esc(VERSION)}</h3>
    <p class="leise">Die App sucht beim Öffnen selbst nach Updates. Hier kannst du sofort nachsehen.</p>
    <button class="knopf voll" data-act="update-suchen">Nach Updates suchen</button>
  </section>
  <details class="karte">
    <summary>Quellen und Version</summary>
    <p class="fuss">Produktdaten: Open Food Facts, freie Datenbank unter der Open Database License (ODbL). Lose Lebensmittel: Max Rubner-Institut (2025), Bundeslebensmittelschlüssel (BLS) 4.0, DOI 10.25826/Data20251217-134202-0. Rezepte: siehe Quelle beim jeweiligen Rezept. App-Version ${VERSION}.</p>
    ${log.length ? `<h4 class="unter">Fehlerprotokoll</h4><pre class="log">${esc(log.map(l => l.t.slice(0, 16).replace("T", " ") + "  " + l.m).join("\n"))}</pre><button class="knopf" data-act="log-weg">Protokoll leeren</button>` : `<p class="fuss">Keine Fehler aufgezeichnet.</p>`}
  </details>`;
}
function garminProfilKarte() {
  const anleitung = `<a href="https://github.com/jranglack-bot/eiweiss-kueche/blob/main/garmin-worker/ANLEITUNG.md" target="_blank" rel="noopener noreferrer">Anleitung Schritt für Schritt</a>`;
  if (garmin) return `<section class="karte"><h3>Garmin-Uhr</h3>
    <p class="leise">Verbunden mit ${esc(garmin.url.replace("https://", ""))}. Deine Trainings zählen automatisch zum Tagesziel.</p>
    <label class="formular">Wie viel der Trainingskalorien anrechnen?<select id="g-anteil">${[50, 75, 100].map(v => `<option value="${v}" ${garmin.anteil === v ? "selected" : ""}>${v} %${v === 75 ? " (empfohlen, Uhren schätzen eher zu hoch)" : ""}</option>`).join("")}</select></label>
    <div class="knoepfe"><button class="knopf voll" data-act="garmin-test">Verbindung testen</button><button class="knopf warn" data-act="garmin-weg">Trennen</button></div>
    <div id="garmin-status" aria-live="polite"></div></section>`;
  return `<details class="karte"><summary>Garmin-Uhr verbinden</summary>
    <p class="leise">Dann zählen deine Trainings von der Uhr automatisch zum Tagesziel. Einmalig brauchst du dafür einen Garmin-Schlüssel und einen kostenlosen Cloudflare-Worker: ${anleitung}.</p>
    <form id="garmin-form" class="formular" novalidate>
      <label>Adresse deines Workers<input id="g-url" value="https://eiweiss-garmin.j-ranglack.workers.dev" autocomplete="off" inputmode="url"></label>
      <label>Zugangscode<input id="g-code" type="password" autocomplete="off"></label>
      <button class="knopf voll" type="submit">Verbinden und testen</button>
    </form>
    <div id="garmin-status" aria-live="polite"></div></details>`;
}
function garminStatusText(d) {
  const n = d.aktivitaeten.length;
  return `Verbunden. Heute ${n === 0 ? "noch kein Training" : n === 1 ? "1 Training" : n + " Trainings"}${d.schritte != null ? `, ${f0(d.schritte)} Schritte` : ""}.`;
}
function exportieren() {
  const daten = { app: "eiweiss-kueche", version: VERSION, gesichert: new Date().toISOString(), ziele, profil, tagebuch, produkte, rezepte: eigeneRezepte, liste, zuletzt };
  const url = URL.createObjectURL(new Blob([JSON.stringify(daten)], { type: "application/json" }));
  const l = document.createElement("a"); l.href = url; l.download = `eiweiss-kueche-${heute()}.json`; document.body.appendChild(l); l.click(); l.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000); toast("Sicherung erstellt");
}
// Schieberegler mit Beispielen, damit klar ist, was jede Stufe bedeutet
const REGLER = {
  // jeweils der untere Wert der DGE-Spanne, damit der Bedarf beim Abnehmen nicht zu hoch geschätzt wird
  alltag: { werte: [1.4, 1.6, 1.8, 2.0], text: [
    "Fast nur Sitzen: Büro, Auto, abends Sofa",
    "Sitzen mit Bewegung: Büro, aber Wege zu Fuß, Kinder, Haushalt",
    "Viel auf den Beinen: Verkauf, Pflege, Gastronomie, leichtes Handwerk",
    "Körperlich schwer: Bau, Lager, Landwirtschaft"] },
  tage: { text: v => v === 0 ? "Gar kein Sport" : v === 1 ? "1 Mal pro Woche, zum Beispiel samstags Fußball" : v <= 3 ? `${v} Mal pro Woche, zum Beispiel ${v} Mal Fitnessstudio` : v <= 5 ? `${v} Mal pro Woche, regelmäßiges Training` : `${v} Mal pro Woche, fast jeden Tag` },
  dauer: { text: v => `${v} Minuten pro Einheit` },
  intens: { werte: [3.5, 5.5, 8.5], text: [
    "Leicht: zügig spazieren, Yoga, gemütlich Rad fahren",
    "Mittel: Krafttraining, locker joggen, Schwimmen",
    "Hart: schnell laufen, Spinning, Fußball, HIIT oder Crossfit"] },
  tempo: { werte: [0.25, 0.5, 0.75], text: ["Langsam: etwa 0,25 kg pro Woche, leicht durchzuhalten", "Mittel: etwa 0,5 kg pro Woche", "Schnell: etwa 0,75 kg pro Woche, nur mit viel Eiweiß und Krafttraining"] }
};
function reglerText(id, v) { const r = REGLER[id]; return typeof r.text === "function" ? r.text(v) : r.text[v]; }
function regler(id, titel, min, max, schritt, wert) {
  return `<label class="regler"><span class="r-kopf">${titel}</span><input type="range" id="p-${id}" min="${min}" max="${max}" step="${schritt}" value="${esc(wert)}"><span class="r-wert" id="p-${id}-txt">${esc(reglerText(id, wert))}</span></label>`;
}
function rechnen(p) {
  const kg = zahl(p.gewicht), cm = zahl(p.groesse), alter = zahl(p.alter);
  if (!(kg > 30 && kg < 350 && cm > 120 && cm < 250 && alter > 12 && alter < 110)) return null;
  const bmr = 10 * kg + 6.25 * cm - 5 * alter + (p.geschlecht === "w" ? -161 : 5);
  const alltag = bmr * REGLER.alltag.werte[p.alltag];
  // Sport: (MET minus Ruhe) mal kg mal Stunden, auf den Tag verteilt
  const sport = garmin ? 0 : (REGLER.intens.werte[p.intens] - 1) * kg * (p.dauer / 60) * p.tage / 7;
  const bedarf = alltag + sport;
  let kcal = bedarf, aenderung = 0, untergrenze = false;
  if (p.ziel === "ab") {
    aenderung = -REGLER.tempo.werte[p.tempo] * 7700 / 7; kcal = bedarf + aenderung;
    const min = Math.max(bmr, p.geschlecht === "w" ? 1200 : 1500); if (kcal < min) { kcal = min; untergrenze = true; }
  } else if (p.ziel === "auf") { aenderung = 250; kcal = bedarf + 250; }
  kcal = Math.round(kcal / 10) * 10;
  const bmi = kg / ((cm / 100) ** 2); const refKg = bmi > 30 ? 25 * (cm / 100) ** 2 : kg;
  const eiw = Math.round((p.ziel === "ab" ? 2.0 : p.ziel === "auf" ? 1.8 : 1.6) * refKg);
  const fett = Math.max(Math.round(kcal * 0.25 / 9), Math.round(0.7 * refKg));
  const kh = Math.max(0, Math.round((kcal - eiw * 4 - fett * 9) / 4));
  return { kcal, eiw, fett, kh, bmr: Math.round(bmr), alltag: Math.round(alltag), sport: Math.round(sport), bedarf: Math.round(bedarf), aenderung: Math.round(aenderung), untergrenze };
}
function rechnerErgebnis(p) {
  const r = rechnen(p);
  if (!r) return `<p class="leise">Trag Alter, Größe und Gewicht ein, dann rechnet die App sofort.</p>`;
  const zeile = (a, b, k = "") => `<tr class="${k}"><th>${a}</th><td class="zahl">${b}</td></tr>`;
  return `<table class="naehr">
      ${zeile("Grundumsatz in Ruhe", f0(r.bmr) + " kcal")}
      ${zeile("mit Alltag und Beruf", f0(r.alltag) + " kcal")}
      ${garmin ? zeile("Sport", "kommt täglich von Garmin") : zeile("plus Sport, im Schnitt pro Tag", "+ " + f0(r.sport) + " kcal")}
      ${zeile("Dein Bedarf", f0(r.bedarf) + " kcal", "summe")}
      ${r.aenderung ? zeile(r.aenderung < 0 ? "minus für das Abnehmen" : "plus für den Muskelaufbau", (r.aenderung < 0 ? "− " : "+ ") + f0(Math.abs(r.aenderung)) + " kcal") : ""}
    </table>
    ${r.untergrenze ? `<p class="mildbox">Weniger wäre zu wenig. Die App bleibt bei ${f0(r.kcal)} kcal, deinem Grundumsatz oder der Untergrenze.</p>` : ""}
    <div class="vorschau"><div><span class="gross zahl">${f0(r.kcal)}</span><span class="leise">kcal am Tag</span></div><div><b class="zahl">${r.eiw} g</b><span class="leise">Eiweiß</span></div><div><b class="zahl">${r.kh} g</b><span class="leise">Kohlenh.</span></div><div><b class="zahl">${r.fett} g</b><span class="leise">Fett</span></div></div>
    <button class="knopf voll breit" data-act="uebernehmen" data-w='${JSON.stringify({ kcal: r.kcal, eiw: r.eiw, kh: r.kh, fett: r.fett })}'>Als Tagesziele übernehmen</button>`;
}

// ---------- Ereignisse ----------
document.addEventListener("click", ev => {
  const nav = ev.target.closest(".nav button"); if (nav) { tabSetzen(nav.dataset.tab); return; }
  const b = ev.target.closest("[data-act]"); if (!b || b.closest(".sheet")) return;
  const a = b.dataset.act;
  if (a === "tag") { ui.datum = datumPlus(ui.datum, +b.dataset.d); render(); }
  else if (a === "heute") { ui.datum = heute(); render(); }
  else if (a === "kalender") kalenderSheet();
  else if (a === "details") { ui.details = !ui.details; render(); }
  else if (a === "hinzu") suchSheet({ meal: b.dataset.meal });
  else if (a === "eintrag") {
    const e = (tagebuch[ui.datum] || []).find(x => x.id === b.dataset.id); if (!e) return;
    let lm = null;
    if (e.ref.typ === "p" && produkte[e.ref.id]) lm = lmAusProdukt(produkte[e.ref.id]);
    else if (e.ref.typ === "r" && rezeptNach(e.ref.id)) lm = lmAusRezept(rezeptNach(e.ref.id));
    else { const z = zuletzt.find(x => refKey(x.ref) === refKey(e.ref)); lm = z || (e.gramm ? { name: e.name, sub: e.sub, ref: e.ref, n100: mal(e.n, 100 / e.gramm) } : { name: e.name, sub: e.sub, ref: e.ref, proPortion: mal(e.n, 1 / e.menge) }); }
    mengeSheet(lm, { eintrag: e });
  }
  else if (a === "filter") { ui.filter = b.dataset.f; sichern("filter", ui.filter); render(); }
  else if (a === "rezept") rezeptOeffnen(b.dataset.id);
  else if (a === "rezept-neu") rezeptEditor(null);
  else if (a === "l-bib") rezeptBibliothek();
  else if (a === "l-eigen") listenEintragSheet(null);
  else if (a === "l-edit") listenEintragSheet(b.dataset.k);
  else if (a === "l-por") { const x = liste.rezepte.find(e => e.id === b.dataset.id); if (x) { x.por = Math.min(20, Math.max(1, x.por + +b.dataset.d)); sichern("liste", liste); render(); } }
  else if (a === "l-rez-weg") { liste.rezepte = liste.rezepte.filter(e => e.id !== b.dataset.id); sichern("liste", liste); render(); toast("Rezept von der Liste genommen"); }
  else if (a === "l-erledigt") {
    for (const z of sammeln()) if (liste.chk[z.key]) { if (z.aus === "eigen") liste.eigene = liste.eigene.filter(x => x.id !== z.id); else liste.weg[z.key] = 1; delete liste.chk[z.key]; delete liste.anders[z.key]; }
    sichern("liste", liste); render(); toast("Erledigte entfernt");
  }
  else if (a === "l-leeren") {
    if (b.dataset.bereit !== "1") { b.dataset.bereit = "1"; b.textContent = "Wirklich alles löschen?"; setTimeout(() => { if (b.isConnected) { b.dataset.bereit = ""; b.textContent = "Liste leeren"; } }, 3000); return; }
    liste = { rezepte: [], eigene: [], weg: {}, chk: {}, anders: {} }; sichern("liste", liste); render(); toast("Liste geleert");
  }
  else if (a === "zu-rezept") { ev.preventDefault(); const r = alleRezepte().find(x => x.nr === +b.dataset.nr); if (r) rezeptOeffnen(r.id); }
  else if (a === "kopieren") {
    const text = listeAlsText();
    const zeigen = () => sheetOeffnen(s => { s.innerHTML = `<div class="sh-kopf"><button class="rund" data-k="zu" aria-label="Schließen">×</button><span class="leise">Markieren und kopieren</span></div><textarea class="kopie" readonly>${esc(text)}</textarea>`; s.onclick = e => { if (e.target.closest("[data-k]")) sheetSchliessen(); }; const t = $("textarea", s); t.focus(); t.select(); });
    try { navigator.clipboard.writeText(text).then(() => toast("Liste kopiert"), zeigen); } catch (e) { zeigen(); }
  }
  else if (a === "produkt-edit") { const p = produkte[b.dataset.id]; if (p) sheetOeffnen(s => produktForm(s, { produkt: p })); }
  else if (a === "export") exportieren();
  else if (a === "garmin-neu") { garminAktualisieren(ui.datum, true); toast("Frage Garmin ab …"); }
  else if (a === "garmin-test") {
    const st = $("#garmin-status"); st.innerHTML = `<p class="leise lade">Teste die Verbindung …</p>`;
    garminAbfragen(garmin, heute()).then(d => { garminTage[heute()] = { t: Date.now(), final: false, d }; sichern("garminTage", garminTage); st.innerHTML = `<p class="leise">${esc(garminStatusText(d))}</p>`; },
      e => { st.innerHTML = `<p class="leise">Klappt nicht: ${esc(e.message)}</p>`; });
  }
  else if (a === "garmin-weg") {
    if (b.dataset.bereit !== "1") { b.dataset.bereit = "1"; b.textContent = "Wirklich trennen?"; setTimeout(() => { if (b.isConnected) { b.dataset.bereit = ""; b.textContent = "Trennen"; } }, 3000); return; }
    garmin = null; garminTage = {}; try { localStorage.removeItem(LS + "garmin"); localStorage.removeItem(LS + "garminTage"); } catch (e) {}
    render(); toast("Garmin getrennt");
  }
  else if (a === "log-weg") { sichern("log", []); render(); }
});
document.addEventListener("change", ev => {
  const c = ev.target.dataset && ev.target.dataset.chk;
  if (c) { if (ev.target.checked) liste.chk[c] = 1; else delete liste.chk[c]; sichern("liste", liste); render(); return; }
  if (ev.target.id === "g-anteil" && garmin) { garmin.anteil = [50, 75, 100].includes(+ev.target.value) ? +ev.target.value : 75; sichern("garmin", garmin); toast(`Es zählen jetzt ${garmin.anteil} % der Trainingskalorien`); return; }
  if (ev.target.id === "import" && ev.target.files[0]) {
    const datei = ev.target.files[0]; const leser = new FileReader();
    leser.onload = () => {
      try {
        if (datei.size > 4 * 1024 * 1024) throw new Error("Datei ist zu groß");
        const d = JSON.parse(leser.result);
        if (!d || d.app !== "eiweiss-kueche" || !d.tagebuch || typeof d.tagebuch !== "object") throw new Error("keine Sicherung dieser App");
        const neu = datenSauber(d);
        const datum = new Date(d.gesichert); const datumText = isNaN(datum) ? "ohne Datum" : "vom " + datum.toLocaleString("de-DE");
        const anz = (n, eins, viele) => `${n} ${n === 1 ? eins : viele}`;
        sheetOeffnen(s => {
          s.innerHTML = `<div class="sh-kopf"><button class="rund" data-i="zu" aria-label="Schließen">×</button><span class="leise">Sicherung einspielen</span></div>
            <p>Sicherung ${esc(datumText)} mit ${anz(Object.keys(neu.tagebuch).length, "Tag", "Tagen")}, ${anz(Object.keys(neu.produkte).length, "Produkt", "Produkten")} und ${anz(neu.rezepte.length, "eigenem Rezept", "eigenen Rezepten")}.</p>
            <p class="mildbox">Das ersetzt alle Daten auf diesem Handy. Lade vorher eine Sicherung der jetzigen Daten herunter, wenn du sie behalten willst.</p>
            <div class="sh-fuss"><button class="knopf voll" data-i="ok">Ersetzen</button><button class="knopf" data-i="vorher">Erst jetzige Daten sichern</button><button class="knopf" data-i="zu">Abbrechen</button></div>`;
          s.onclick = e => {
            const b = e.target.closest("[data-i]"); if (!b) return;
            if (b.dataset.i === "zu") { sheetSchliessen(); return; }
            if (b.dataset.i === "vorher") { exportieren(); return; }
            if (!allesSichern(neu)) { toast("Einspielen hat nicht geklappt, deine bisherigen Daten sind noch da"); return; }
            ({ ziele, profil, tagebuch, produkte, zuletzt, liste } = neu); eigeneRezepte = neu.rezepte;
            sheetSchliessen(() => toast("Sicherung eingespielt"));
          };
        });
      } catch (e) { toast("Die Datei passt nicht: " + e.message); }
      ev.target.value = "";
    };
    leser.readAsText(datei);
  }
});
document.addEventListener("submit", ev => {
  if (ev.target.id === "ziele-form") {
    ev.preventDefault();
    const n = {}; for (const k of ["kcal", "eiw", "kh", "fett"]) { const v = zahl($("#z-" + k).value); if (!(v > 0)) { toast("Bitte alle Ziele als Zahl eingeben"); return; } n[k] = Math.round(v); }
    ziele = n; sichern("ziele", ziele); toast("Ziele gespeichert");
  } else if (ev.target.id === "rechner") ev.preventDefault();
  else if (ev.target.id === "garmin-form") {
    ev.preventDefault();
    const cfg = garminSauber({ url: $("#g-url").value, code: $("#g-code").value, anteil: 75 });
    const st = $("#garmin-status");
    if (!cfg) { st.innerHTML = `<p class="leise">Die Adresse muss mit https:// beginnen und auf .workers.dev enden, der Zugangscode braucht mindestens 12 Zeichen.</p>`; return; }
    st.innerHTML = `<p class="leise lade">Teste die Verbindung …</p>`;
    garminAbfragen(cfg, heute()).then(d => {
      garmin = cfg; sichern("garmin", garmin); garminTage = { [heute()]: { t: Date.now(), final: false, d } }; sichern("garminTage", garminTage);
      render(); toast(garminStatusText(d));
    }, e => { st.innerHTML = `<p class="leise">Klappt noch nicht: ${esc(e.message)}. Prüf Adresse und Zugangscode, und ob im Worker beide Geheimnisse eingetragen sind.</p>`; });
  }
});
// Zielrechner rechnet bei jeder Änderung sofort neu
function rechnerLesen() {
  const v = id => $("#p-" + id); if (!v("alter")) return;
  profil = datenSauber({ tagebuch: {}, profil: { geschlecht: v("geschlecht").value, alter: v("alter").value, groesse: v("groesse").value, gewicht: v("gewicht").value,
    alltag: v("alltag").value, tage: v("tage").value, dauer: v("dauer").value, intens: v("intens").value, tempo: v("tempo").value, ziel: v("ziel").value } }).profil;
  sichern("profil", profil);
  for (const id of ["alltag", "tage", "dauer", "intens", "tempo"]) { const t = $("#p-" + id + "-txt"); if (t) t.textContent = reglerText(id, profil[id]); }
  $("#tempo-box").hidden = profil.ziel !== "ab";
  $("#rechner-erg").innerHTML = rechnerErgebnis(profil);
}
document.addEventListener("input", ev => { if (ev.target.closest && ev.target.closest("#rechner")) rechnerLesen(); });
document.addEventListener("change", ev => { if (ev.target.closest && ev.target.closest("#rechner")) rechnerLesen(); });
document.addEventListener("click", ev => {
  const b = ev.target.closest("[data-act=uebernehmen]"); if (!b) return;
  try { ziele = JSON.parse(b.dataset.w); sichern("ziele", ziele); toast("Ziele übernommen"); render(); } catch (e) {}
});
$("#scan-fab").addEventListener("click", () => {
  const meal = mahlzeitJetzt();
  scannerOeffnen(code => sheetOeffnen(s => barcodeVerarbeiten(s, code, { weiter: p => mengeInhalt(s, lmAusProdukt(p), { meal }) })));
});

// ---------- Start ----------
render();
basisLaden().then(render);
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
// Updates: Der Service Worker lädt eine neue Fassung komplett und übernimmt sofort. Die App fragt beim Start,
// bei jeder Rückkehr in die App (höchstens alle 30 Minuten) und auf Knopfdruck nach.
let swReg = null, letzteSuche = 0, neuLadenNachUpdate = false;
async function nachUpdatesSuchen(manuell) {
  if (!swReg) { if (manuell) toast("Updates gehen nur in der installierten App"); return; }
  letzteSuche = Date.now();
  try {
    await swReg.update();
    const neu = swReg.installing || swReg.waiting;
    if (neu) { if (manuell) { neuLadenNachUpdate = true; toast("Update gefunden, wird geladen …"); } }
    else if (manuell) toast(`Du hast die neueste Version (${VERSION})`);
  } catch (e) { if (manuell) toast("Keine Verbindung, versuch es später noch einmal"); }
}
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).then(r => { swReg = r; }).catch(e => fehlerMerken("SW: " + e.message));
  let hatteController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hatteController) { hatteController = true; return; }
    if (neuLadenNachUpdate && !sheets.length) { location.reload(); return; }
    $("#update").hidden = false;
  });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && Date.now() - letzteSuche > 30 * 60e3) nachUpdatesSuchen(false); });
}
$("#update-knopf").addEventListener("click", () => location.reload());
document.addEventListener("click", ev => { if (ev.target.closest("[data-act=update-suchen]")) nachUpdatesSuchen(true); });
