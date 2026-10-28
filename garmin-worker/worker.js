// Eiweiß-Küche: Garmin-Brücke als Cloudflare Worker.
// Hält den Garmin-Schlüssel geheim und gibt der App nur die Werte eines Tages: Aktivitäten mit Kalorien, aktive Kalorien, Schritte.
// Geheimnisse (in Cloudflare unter Settings, Variables and Secrets anlegen, nie in diese Datei schreiben):
//   GARMIN_SCHLUESSEL  der Personal-API-Schlüssel von connect.garmin.com
//   ZUGANG             ein selbst ausgedachter Zugangscode, den auch die App kennt
// Schnittstelle laut Garmins Beispiel-Client github.com/garmin/connect-personal-api-python (Apache 2.0).

const BASIS = "https://personal.connectapi.garmin.com";
const ERLAUBT = "https://jranglack-bot.github.io";
let tokenCache = null;

export default {
  async fetch(req, env) {
    const cors = {
      "Access-Control-Allow-Origin": ERLAUBT, "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "X-Zugang", "Access-Control-Max-Age": "86400", "Vary": "Origin"
    };
    const antwort = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "GET") return antwort({ fehler: "Nur Abfragen erlaubt" }, 405);
    if (!env.ZUGANG || env.ZUGANG.length < 16) return antwort({ fehler: "Worker noch nicht fertig eingerichtet" }, 500);
    if (!(await gleich(req.headers.get("X-Zugang") || "", env.ZUGANG))) return antwort({ fehler: "Zugangscode stimmt nicht" }, 401);
    if (!env.GARMIN_SCHLUESSEL) return antwort({ fehler: "Im Worker fehlt GARMIN_SCHLUESSEL" }, 500);

    const url = new URL(req.url);
    const datum = url.searchParams.get("datum") || "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) return antwort({ fehler: "Datum fehlt" }, 400);
    try {
      const token = await holeToken(env);
      const [akt, tag] = await Promise.all([
        garmin(token, `/activitylist-service/activities/search/activities?start=0&limit=20&startDate=${datum}&endDate=${datum}`),
        garmin(token, `/usersummary-service/v2/dailysummaries?startDate=${datum}&endDate=${datum}`).catch(() => null)
      ]);
      // ?roh=1 zeigt die Originaldaten, falls Garmin Feldnamen ändert. Nur mit der Variablen DEBUG=1, sonst nie
      // (die Rohdaten enthalten mehr als die App braucht, zum Beispiel Startorte).
      if (url.searchParams.get("roh") === "1" && env.DEBUG === "1") return antwort({ aktivitaeten: akt, tag });
      const liste = (Array.isArray(akt) ? akt : (akt && (akt.activityList || akt.activities)) || []).slice(0, 20).map(a => ({
        name: String(a.activityName || (a.activityType && a.activityType.typeKey) || "Aktivität").slice(0, 80),
        kcal: zahl(a.calories), ruheKcal: zahl(a.bmrCalories),
        minuten: Math.round(zahl(a.duration) / 60), start: String(a.startTimeLocal || "").slice(0, 16)
      }));
      return antwort({ datum, aktivitaeten: liste, aktivKcalTag: suche(tag, ["activeKilocalories", "activeCalories"]), schritte: suche(tag, ["totalSteps", "steps"]) });
    } catch (e) {
      return antwort({ fehler: String(e && e.message || e).slice(0, 200) }, 502);
    }
  }
};

async function holeToken(env) {
  // Token nur weiterverwenden, wenn es zum aktuell eingetragenen Schlüssel gehört
  if (tokenCache && tokenCache.schluessel === env.GARMIN_SCHLUESSEL && tokenCache.bis > Date.now() + 3600e3) return tokenCache.token;
  const r = await fetch(BASIS + "/personalapitoken-service/personal-api/personal-api-key/token", {
    method: "POST", headers: { Accept: "*/*", Authorization: "ApiKey " + env.GARMIN_SCHLUESSEL }
  });
  if (!r.ok) throw new Error(`Garmin lehnt den Schlüssel ab (${r.status}). Abgelaufen oder falsch kopiert?`);
  const token = (await r.text()).trim();
  let bis = Date.now() + 20 * 3600e3;
  try { const p = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); if (p.exp) bis = p.exp * 1000; } catch (e) {}
  tokenCache = { token, bis, schluessel: env.GARMIN_SCHLUESSEL };
  return token;
}
async function garmin(token, pfad) {
  const r = await fetch(BASIS + pfad, { headers: { Accept: "application/json", Authorization: "Bearer " + token } });
  if (r.status === 401) tokenCache = null;
  if (!r.ok) throw new Error(`Garmin antwortet ${r.status} bei ${pfad.split("?")[0]}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
function zahl(v) { const x = Number(v); return isFinite(x) && x > 0 ? x : 0; }
function suche(o, keys, tiefe = 0) {
  if (!o || tiefe > 5) return null;
  if (Array.isArray(o)) { for (const x of o) { const v = suche(x, keys, tiefe + 1); if (v != null) return v; } return null; }
  if (typeof o === "object") {
    for (const k of keys) if (typeof o[k] === "number") return o[k];
    for (const v of Object.values(o)) { const r = suche(v, keys, tiefe + 1); if (r != null) return r; }
  }
  return null;
}
// Vergleich ohne Zeitverrat: beide Werte hashen, dann gleich lange Hashes zeitkonstant vergleichen
async function gleich(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  if (crypto.subtle.timingSafeEqual) return crypto.subtle.timingSafeEqual(ha, hb);
  const x = new Uint8Array(ha), y = new Uint8Array(hb); let d = 0; for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}
