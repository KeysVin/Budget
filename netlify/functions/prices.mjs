const json = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "public, max-age=60, s-maxage=180" } });

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export default async (request) => {
  if (request.method !== "GET") return json({ error: "Méthode non autorisée" }, 405);
  const url = new URL(request.url);
  const raw = url.searchParams.get("symbols") || "";
  const symbols = [...new Set(raw.split(",").map(x => x.trim().toUpperCase()).filter(Boolean))];
  if (symbols.length > 12 || symbols.some(x => !/^[A-Z0-9.:/-]{1,24}$/.test(x))) return json({ error: "Symboles invalides" }, 400);
  const wantBtc = url.searchParams.get("btc") === "1";
  const quotes = {};
  const errors = {};
  const key = process.env.TWELVE_DATA_API_KEY;

  await Promise.all(symbols.map(async (symbol) => {
    if (!key) { errors[symbol] = "Clé Twelve Data absente sur Netlify"; return; }
    try {
      const target = new URL("https://api.twelvedata.com/quote");
      target.searchParams.set(/^([A-Z]{2}[A-Z0-9]{10})$/.test(symbol) ? "isin" : "symbol", symbol);
      target.searchParams.set("apikey", key);
      const data = await fetchJson(target);
      const price = Number(data.close ?? data.price);
      if (data.status === "error" || !Number.isFinite(price) || price <= 0) throw new Error(data.message || "Cours indisponible");
      const currency = String(data.currency || "").toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Devise du cours inconnue");
      quotes[symbol] = { price, currency, asOf: data.datetime || new Date().toISOString(), source: "Twelve Data" };
    } catch (error) { errors[symbol] = error.message; }
  }));

  if (wantBtc) {
    try {
      const data = await fetchJson("https://api.kraken.com/0/public/Ticker?pair=XBTEUR");
      if (data.error?.length) throw new Error(data.error.join(", "));
      const item = Object.values(data.result || {})[0];
      const price = Number(item?.c?.[0]);
      if (!Number.isFinite(price) || price <= 0) throw new Error("Cours BTC indisponible");
      quotes.BTC = { price, currency: "EUR", asOf: new Date().toISOString(), source: "Kraken" };
    } catch (error) { errors.BTC = error.message; }
  }

  const currencies = [...new Set(Object.values(quotes).map(x => x.currency).filter(x => x !== "EUR"))];
  await Promise.all(currencies.map(async (currency) => {
    if (!key) return;
    try {
      const target = new URL("https://api.twelvedata.com/exchange_rate");
      target.searchParams.set("symbol", `${currency}/EUR`);
      target.searchParams.set("apikey", key);
      const data = await fetchJson(target);
      const rate = Number(data.rate);
      if (!Number.isFinite(rate) || rate <= 0) throw new Error(data.message || "Conversion indisponible");
      for (const [symbol, quote] of Object.entries(quotes)) {
        if (quote.currency === currency) quotes[symbol] = { ...quote, price: quote.price * rate, currency: "EUR", conversionRate: rate };
      }
    } catch (error) {
      for (const [symbol, quote] of Object.entries(quotes)) if (quote.currency === currency) { delete quotes[symbol]; errors[symbol] = `Conversion ${currency}/EUR indisponible : ${error.message}`; }
    }
  }));

  return json({ quotes, errors, fetchedAt: new Date().toISOString() });
};

export const config = { path: "/api/prices" };
