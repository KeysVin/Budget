const json = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "public, max-age=300, s-maxage=3600" } });

async function fetchJson(url, key = "") {
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const raw = typeof data.message === "string" ? data.message : typeof data.error === "string" ? data.error : "";
    throw new Error(raw.replaceAll(key || "\u0000", "[clé masquée]").slice(0, 180) || `HTTP ${response.status}`);
  }
  return data;
}

function findListing(results, symbol) {
  if (!Array.isArray(results)) throw new Error("Réponse EODHD invalide");
  const isin = /^[A-Z]{2}[A-Z0-9]{10}$/.test(symbol);
  const [code, exchange] = symbol.split(".");
  const matching = results.filter(item => isin
    ? String(item.ISIN || item.Isin || "").toUpperCase() === symbol
    : String(item.Code || "").toUpperCase() === code && (!exchange || String(item.Exchange || "").toUpperCase() === exchange));
  if (!matching.length) throw new Error("Titre introuvable chez EODHD : vérifiez l’ISIN ou le ticker");
  return matching.find(item => item.Exchange === "PA" && item.Currency === "EUR")
    || matching.find(item => item.Currency === "EUR" && item.isPrimary)
    || matching.find(item => item.Currency === "EUR")
    || matching.find(item => item.isPrimary)
    || matching[0];
}

export default async (request) => {
  if (request.method !== "GET") return json({ error: "Méthode non autorisée" }, 405);
  const url = new URL(request.url);
  const symbols = [...new Set((url.searchParams.get("symbols") || "").split(",").map(x => x.trim().toUpperCase()).filter(Boolean))];
  if (symbols.length > 12 || symbols.some(x => !/^[A-Z0-9.:/-]{1,24}$/.test(x))) return json({ error: "Symboles invalides" }, 400);
  const quotes = {}, errors = {};
  const key = process.env.EODHD_API_KEY || process.env.EODHD_API_TOKEN;

  await Promise.all(symbols.map(async (symbol) => {
    if (!key) { errors[symbol] = "Clé EODHD absente sur Netlify"; return; }
    try {
      const query = symbol.includes(".") ? symbol.split(".")[0] : symbol;
      const target = new URL(`https://eodhd.com/api/search/${encodeURIComponent(query)}`);
      target.searchParams.set("api_token", key);
      target.searchParams.set("fmt", "json");
      target.searchParams.set("limit", "100");
      const listing = findListing(await fetchJson(target, key), symbol);
      const price = Number(listing.previousClose);
      const currency = String(listing.Currency || "").toUpperCase();
      if (!Number.isFinite(price) || price <= 0) throw new Error("Aucun cours de clôture disponible");
      if (currency !== "EUR") throw new Error(`Cours en ${currency || "devise inconnue"} : conversion EUR non disponible`);
      quotes[symbol] = { price, currency, asOf: listing.previousCloseDate || null, source: "EODHD · clôture" };
    } catch (error) { errors[symbol] = error.message; }
  }));

  if (url.searchParams.get("btc") === "1") {
    try {
      const data = await fetchJson("https://api.kraken.com/0/public/Ticker?pair=XBTEUR");
      if (data.error?.length) throw new Error(data.error.join(", "));
      const price = Number(Object.values(data.result || {})[0]?.c?.[0]);
      if (!Number.isFinite(price) || price <= 0) throw new Error("Cours BTC indisponible");
      quotes.BTC = { price, currency: "EUR", asOf: new Date().toISOString(), source: "Kraken" };
    } catch (error) { errors.BTC = error.message; }
  }

  return json({ quotes, errors, fetchedAt: new Date().toISOString() });
};

export const config = { path: "/api/prices" };
