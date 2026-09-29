const json = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "public, max-age=60, s-maxage=180" } });
const parisTickers = new Set(["DCAM", "PAEEM", "PNAS"]);

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(8000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof data.message === "string" ? data.message.replaceAll(process.env.TWELVE_DATA_API_KEY || "\u0000", "[clé masquée]").slice(0, 180) : "";
    const error = new Error(detail || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function parseQuote(data, symbol, daily = false) {
  if (data.status === "error") throw new Error(data.message || "Cours indisponible");
  const price = Number(daily ? data.values?.[0]?.close : data.close ?? data.price);
  const currency = String(daily ? data.meta?.currency || "" : data.currency || "").toUpperCase();
  if (!Number.isFinite(price) || price <= 0) throw new Error(`Aucun cours disponible pour ${symbol}`);
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Devise du cours inconnue");
  return { price, currency, asOf: daily ? data.values[0].datetime : data.datetime || new Date().toISOString(), source: daily ? "Twelve Data · clôture" : "Twelve Data" };
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
      if (parisTickers.has(symbol)) target.searchParams.set("mic_code", "XPAR");
      target.searchParams.set("apikey", key);
      quotes[symbol] = parseQuote(await fetchJson(target), symbol);
    } catch (quoteError) {
      try {
        const target = new URL("https://api.twelvedata.com/time_series");
        target.searchParams.set(/^([A-Z]{2}[A-Z0-9]{10})$/.test(symbol) ? "isin" : "symbol", symbol);
        if (parisTickers.has(symbol)) target.searchParams.set("mic_code", "XPAR");
        target.searchParams.set("interval", "1day");
        target.searchParams.set("outputsize", "1");
        target.searchParams.set("apikey", key);
        quotes[symbol] = parseQuote(await fetchJson(target), symbol, true);
      } catch (dailyError) { errors[symbol] = `${quoteError.message} ; clôture : ${dailyError.message}`; }
    }
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
