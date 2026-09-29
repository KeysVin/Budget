(() => {
  "use strict";

  const STORAGE_KEY = "clair-portfolio-v2";
  const LEGACY_STORAGE_KEY = "clair-portfolio-v1";
  const PRICE_KEY = "clair-price-cache-v2";
  const VIEW_KEY = "clair-view-filters-v1";

  const kinds = {
    "livret-a": { label: "Livret A", group: "Épargne", color: "#348d6c", segment: "Épargne" },
    "livret-jeune": { label: "Livret jeune", group: "Épargne", color: "#348d6c", segment: "Épargne" },
    pel: { label: "PEL", group: "Épargne", color: "#348d6c", segment: "Épargne" },
    "assurance-vie": { label: "Assurance-vie · globale", group: "Assurance-vie", color: "#c4bf9c", segment: "Assurance-vie" },
    "av-euro": { label: "Fonds en euros · assurance-vie", group: "Fonds en euros", color: "#a6bb6b", segment: "Assurance-vie" },
    "av-uc": { label: "Unité de compte · assurance-vie", group: "Unités de compte", color: "#847fc3", segment: "Assurance-vie" },
    etf: { label: "ETF · PEA", group: "PEA", color: "#91afa0", segment: "PEA" },
    btc: { label: "Bitcoin", group: "Bitcoin", color: "#e7b85b", segment: "Bitcoin" }
  };
  const segments = ["Épargne", "PEA", "Assurance-vie", "Bitcoin"];
  const allocationGroups = ["Épargne", "PEA", "Bitcoin", "Fonds en euros", "Unités de compte", "Assurance-vie"];
  const allocationColors = { "Épargne": "#348d6c", PEA: "#91afa0", Bitcoin: "#e7b85b", "Fonds en euros": "#a6bb6b", "Unités de compte": "#847fc3", "Assurance-vie": "#c4bf9c" };
  const knownTickers = { FR001400U5Q4: "DCAM", FR0013412020: "PAEEM", FR001400ZGR7: "PNAS" };
  const $ = id => document.getElementById(id);
  const money = n => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(n || 0);
  const shortMoney = n => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0, notation: n >= 1000000 ? "compact" : "standard" }).format(n || 0);
  const number = (n, digits = 4) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: digits }).format(n || 0);
  const percent = n => `${n >= 0 ? "+" : "−"}${number(Math.abs(n), 2)} %`;
  const signedMoney = n => `${n >= 0 ? "+" : "−"}${money(Math.abs(n))}`;
  const today = () => new Date().toLocaleDateString("sv-SE");
  const displayDate = value => value ? new Date(`${value}T12:00:00`).toLocaleDateString("fr-FR") : "";
  const safeNonNegative = value => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  const isMarket = kind => kind === "etf" || kind === "av-uc" || kind === "btc";
  const usesIsin = kind => kind === "etf" || kind === "av-uc";
  const makeId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const marketSlot = () => {
    const now = new Date();
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" }).format(now));
    return new Date(now.getTime() - (hour < 19 ? 24 * 60 * 60 * 1000 : 0)).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
  };

  let editingId = null;
  let state = loadState();
  let quoteCache = loadQuotes();
  let activeSegments = loadFilters();

  function normalizePurchases(asset) {
    if (!isMarket(asset.kind)) return [];
    const purchases = Array.isArray(asset.purchases) && asset.purchases.length
      ? asset.purchases
      : [{ id: makeId(), date: asset.openedOn || today(), quantity: asset.quantity, unitPrice: Number(asset.cost) / Number(asset.quantity) }];
    return purchases
      .map(p => ({
        id: typeof p.id === "string" && p.id ? p.id : makeId(),
        date: typeof p.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? p.date : today(),
        quantity: Number(p.quantity),
        unitPrice: Number(p.unitPrice)
      }))
      .filter(p => Number.isFinite(p.quantity) && p.quantity > 0 && Number.isFinite(p.unitPrice) && p.unitPrice >= 0)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  function normalizeMovements(asset) {
    if (isMarket(asset.kind)) return [];
    const movements = Array.isArray(asset.movements) ? asset.movements : [];
    return movements
      .map(m => ({
        id: typeof m.id === "string" && m.id ? m.id : makeId(),
        date: typeof m.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(m.date) ? m.date : "",
        amount: Number(m.amount),
        label: typeof m.label === "string" ? m.label.trim().slice(0, 120) : ""
      }))
      .filter(m => m.date && Number.isFinite(m.amount) && m.amount !== 0)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  function normalizeAsset(asset) {
    if (!asset || !kinds[asset.kind]) return null;
    const base = {
      id: typeof asset.id === "string" && asset.id ? asset.id : makeId(),
      kind: asset.kind,
      name: String(asset.name || "").trim().slice(0, 80),
      isin: typeof asset.isin === "string" ? asset.isin.toUpperCase() : "",
      ticker: typeof asset.ticker === "string" ? asset.ticker.toUpperCase() : "",
      manualPrice: asset.manualPrice !== undefined && asset.manualPrice !== null && asset.manualPrice !== "" ? Number(asset.manualPrice) : undefined,
      openedOn: typeof asset.openedOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(asset.openedOn) ? asset.openedOn : undefined
    };
    if (!base.name) return null;
    if (isMarket(asset.kind)) {
      const purchases = normalizePurchases(asset);
      const quantity = purchases.reduce((sum, p) => sum + Number(p.quantity), 0);
      const cost = purchases.reduce((sum, p) => sum + Number(p.quantity) * Number(p.unitPrice), 0);
      return { ...base, purchases, quantity, cost };
    }
    const currentValue = Number(asset.currentValue);
    const cost = asset.cost !== undefined && asset.cost !== null && asset.cost !== "" ? Number(asset.cost) : currentValue;
    const movements = normalizeMovements(asset);
    return { ...base, currentValue, cost, movements };
  }

  function validAsset(asset) {
    const a = normalizeAsset(asset);
    if (!a) return false;
    if (!a.name || !kinds[a.kind]) return false;
    if (isMarket(a.kind)) {
      if (!Array.isArray(a.purchases) || !a.purchases.length) return false;
      if (a.kind !== "btc") {
        if (!a.isin && !a.ticker) return false;
        if (a.isin && !/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(a.isin)) return false;
        if (a.ticker && !/^[A-Z0-9.:/-]{1,24}$/.test(a.ticker)) return false;
      }
      if (a.manualPrice !== undefined && (!Number.isFinite(a.manualPrice) || a.manualPrice <= 0)) return false;
      return Number.isFinite(a.quantity) && a.quantity > 0 && Number.isFinite(a.cost) && a.cost >= 0;
    }
    return Number.isFinite(a.currentValue) && a.currentValue >= 0 && Number.isFinite(a.cost) && a.cost >= 0;
  }

  function loadState() {
    const rawKeys = [STORAGE_KEY, LEGACY_STORAGE_KEY];
    for (const key of rawKeys) {
      try {
        const raw = JSON.parse(localStorage.getItem(key));
        if (raw && Array.isArray(raw.assets) && Array.isArray(raw.history)) {
          return {
            assets: raw.assets.map(normalizeAsset).filter(validAsset),
            history: raw.history.filter(x => typeof x.date === "string").slice(-2000)
          };
        }
      } catch (_) {}
    }
    return { assets: [], history: [] };
  }

  function loadQuotes() {
    try {
      const raw = JSON.parse(localStorage.getItem(PRICE_KEY));
      if (raw && typeof raw === "object" && raw.quotes && typeof raw.quotes === "object") return raw;
    } catch (_) {}
    return { quotes: {}, fetchedAt: null, etfFetchedAt: null };
  }

  function loadFilters() {
    try {
      const raw = JSON.parse(localStorage.getItem(VIEW_KEY));
      const values = Array.isArray(raw) ? raw.filter(x => segments.includes(x)) : segments.slice();
      return new Set(values.length ? values : segments);
    } catch (_) {}
    return new Set(segments);
  }

  function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, ...state })); }
  function saveQuotes() { localStorage.setItem(PRICE_KEY, JSON.stringify(quoteCache)); }
  function saveFilters() { localStorage.setItem(VIEW_KEY, JSON.stringify([...activeSegments])); }

  function quoteSymbol(asset) { return asset.kind === "btc" ? "BTC" : (asset.ticker || knownTickers[asset.isin] || asset.isin || "").toUpperCase(); }
  function marketPrice(asset) {
    const quote = quoteCache.quotes[quoteSymbol(asset)];
    if (quote && Number.isFinite(quote.price) && quote.price > 0) return { price: quote.price, source: quote.source, asOf: quote.asOf };
    if (Number.isFinite(Number(asset.manualPrice)) && Number(asset.manualPrice) > 0) return { price: Number(asset.manualPrice), source: "Cours saisi" };
    return null;
  }
  function assetQuantity(asset) {
    return isMarket(asset.kind) ? normalizePurchases(asset).reduce((sum, p) => sum + Number(p.quantity), 0) : null;
  }
  function assetCost(asset) {
    if (!isMarket(asset.kind)) return Number(asset.cost || 0);
    return normalizePurchases(asset).reduce((sum, p) => sum + Number(p.quantity) * Number(p.unitPrice), 0);
  }
  function assetValue(asset) {
    if (!isMarket(asset.kind)) return Number(asset.currentValue || 0);
    const quote = marketPrice(asset);
    return quote ? assetQuantity(asset) * quote.price : assetCost(asset);
  }
  function assetStats(asset) {
    const cost = assetCost(asset);
    const value = assetValue(asset);
    const gain = value - cost;
    const pct = cost > 0 ? (gain / cost) * 100 : 0;
    const quantity = assetQuantity(asset);
    return { cost, value, gain, pct, quantity, quote: isMarket(asset.kind) ? marketPrice(asset) : null };
  }
  function hasPrice(asset) { return !isMarket(asset.kind) || !!marketPrice(asset); }
  function assetSegment(asset) { return kinds[asset.kind]?.segment || "Épargne"; }
  function filteredAssets() { return state.assets.filter(a => activeSegments.has(assetSegment(a))); }

  function totals(assets = state.assets) {
    const cost = assets.reduce((sum, a) => sum + assetCost(a), 0);
    const value = assets.reduce((sum, a) => sum + assetValue(a), 0);
    const pending = assets.filter(a => !hasPrice(a)).length;
    const manual = assets.filter(a => isMarket(a.kind) && !quoteCache.quotes[quoteSymbol(a)] && a.manualPrice).length;
    return { cost, value, gain: value - cost, pct: cost > 0 ? ((value - cost) / cost) * 100 : 0, pending, manual };
  }
  function segmentBreakdown(assets = state.assets) {
    return Object.fromEntries(segments.map(segment => [segment, assets.filter(a => assetSegment(a) === segment).reduce((sum, a) => sum + assetValue(a), 0)]));
  }
  function snapshot() {
    if (!state.assets.length) return;
    const point = { date: today(), value: totals().value, breakdown: segmentBreakdown() };
    const existing = state.history.findIndex(x => x.date === point.date);
    if (existing >= 0) state.history[existing] = { ...state.history[existing], ...point };
    else state.history.push(point);
    state.history.sort((a, b) => a.date.localeCompare(b.date));
    state.history = state.history.slice(-2000);
    save();
  }

  function setSummaryTitle() {
    const label = activeSegments.size === segments.length ? "Portefeuille total" : [...activeSegments].join(" + ");
    $("summaryScope").textContent = label;
  }

  function render() {
    const assets = filteredAssets();
    const t = totals(assets);
    setSummaryTitle();
    $("totalValue").textContent = money(t.value);
    $("totalCost").textContent = money(t.cost);
    $("totalGain").textContent = signedMoney(t.gain);
    $("totalGain").classList.toggle("negative", t.gain < 0);
    $("totalDelta").textContent = `${signedMoney(t.gain)} (${percent(t.pct)})`;
    $("totalDelta").classList.toggle("negative", t.gain < 0);
    const asOf = quoteCache.fetchedAt ? new Date(quoteCache.fetchedAt) : null;
    $("priceState").textContent = t.pending ? `${t.pending} cours manquant${t.pending > 1 ? "s" : ""}` : t.manual ? `${t.manual} cours saisi${t.manual > 1 ? "s" : ""}` : (asOf && assets.some(a => isMarket(a.kind)) ? `Cours ${asOf.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : "Valeurs saisies");
    $("assetCount").textContent = `${assets.length} actif${assets.length > 1 ? "s" : ""}`;
    renderAssets(assets);
    renderAllocation(assets);
    renderChart(assets);
    renderFilterChips();
  }

  function renderAssets(assets) {
    const tbody = $("assetsBody");
    tbody.replaceChildren();
    $("emptyAssets").hidden = assets.length > 0;
    if (!assets.length) return;
    for (const asset of assets) {
      const stats = assetStats(asset);
      const tr = document.createElement("tr");
      const cell = () => { const td = document.createElement("td"); tr.append(td); return td; };
      const nameTd = cell();
      const title = document.createElement("div"); title.className = "asset-name"; title.textContent = asset.name; nameTd.append(title);
      const type = document.createElement("div"); type.className = "asset-type"; type.textContent = kinds[asset.kind].label + (usesIsin(asset.kind) && asset.isin ? ` · ${asset.isin}` : ""); nameTd.append(type);

      const position = cell();
      if (isMarket(asset.kind)) {
        position.textContent = `${number(stats.quantity, asset.kind === "btc" ? 8 : 4)} ${asset.kind === "btc" ? "BTC" : "parts"}`;
        const purchases = normalizePurchases(asset);
        const purchaseDates = purchases.map(p => displayDate(p.date));
        const sub = document.createElement("div");
        sub.className = "asset-sub";
        const preview = purchaseDates.slice(0, 3).join(", ");
        sub.textContent = `${purchases.length} achat${purchases.length > 1 ? "s" : ""} · ${preview}${purchaseDates.length > 3 ? ` +${purchaseDates.length - 3}` : ""}`;
        position.append(sub);
      } else {
        position.textContent = "Valeur saisie";
        const movements = normalizeMovements(asset);
        const sub = document.createElement("div");
        sub.className = "asset-sub";
        if (movements.length) {
          sub.textContent = `${movements.length} mouvement${movements.length > 1 ? "s" : ""} · depuis ${displayDate(movements[0].date)}`;
          position.append(sub);
        } else if (asset.openedOn) {
          sub.textContent = `Début : ${displayDate(asset.openedOn)}`;
          position.append(sub);
        }
      }

      const valueTd = cell();
      const valueNode = document.createElement("div"); valueNode.className = "value"; valueNode.textContent = money(stats.value); valueTd.append(valueNode);
      if (isMarket(asset.kind)) {
        const sub = document.createElement("div"); sub.className = "asset-sub";
        sub.textContent = stats.quote
          ? `${money(stats.quote.price)} / ${asset.kind === "btc" ? "BTC" : "part"} · ${stats.quote.source}${stats.quote.source === "EODHD · clôture" && stats.quote.asOf ? ` du ${displayDate(stats.quote.asOf)}` : ""}`
          : "Estimation au prix d’achat";
        valueTd.append(sub);
      }

      const gainTd = cell();
      gainTd.className = stats.gain > 0 ? "gain-positive" : stats.gain < 0 ? "gain-negative" : "gain-neutral";
      gainTd.textContent = `${signedMoney(stats.gain)} · ${percent(stats.pct)}`;

      const actions = cell();
      const wrap = document.createElement("div"); wrap.className = "row-actions";
      const edit = document.createElement("button"); edit.type = "button"; edit.className = "icon-btn"; edit.textContent = "✎"; edit.title = `Modifier ${asset.name}`; edit.setAttribute("aria-label", edit.title); edit.addEventListener("click", () => openDialog(asset));
      const del = document.createElement("button"); del.type = "button"; del.className = "icon-btn"; del.textContent = "×"; del.title = `Supprimer ${asset.name}`; del.setAttribute("aria-label", del.title); del.addEventListener("click", () => deleteAsset(asset));
      wrap.append(edit, del); actions.append(wrap);
      tbody.append(tr);
    }
  }

  function renderAllocation(assets) {
    const values = Object.fromEntries(allocationGroups.map(group => [group, assets.filter(a => kinds[a.kind].group === group).reduce((sum, a) => sum + assetValue(a), 0)]));
    const total = Object.values(values).reduce((a, b) => a + b, 0);
    $("donutTotal").textContent = shortMoney(total);
    let angle = 0;
    const stops = [];
    for (const group of allocationGroups) {
      if (values[group] <= 0 || total <= 0) continue;
      const next = angle + values[group] / total * 360;
      stops.push(`${allocationColors[group]} ${angle}deg ${next}deg`);
      angle = next;
    }
    $("donut").style.background = stops.length ? `conic-gradient(${stops.join(",")})` : "#edf2ed";
    const legend = $("allocationLegend"); legend.replaceChildren();
    for (const group of allocationGroups) {
      if (values[group] <= 0 || total <= 0) continue;
      const item = document.createElement("span"); item.className = "legend-item";
      const dot = document.createElement("span"); dot.className = "legend-dot"; dot.style.background = allocationColors[group];
      item.append(dot, document.createTextNode(`${group} ${number(values[group] / total * 100, 0)} %`));
      legend.append(item);
    }
  }

  function dayBefore(date) {
    const d = new Date(`${date}T12:00:00`);
    d.setDate(d.getDate() - 1);
    return d.toLocaleDateString("sv-SE");
  }

  function manualValueAtDate(asset, date) {
    if (isMarket(asset.kind)) return 0;
    const movements = normalizeMovements(asset);
    if (!movements.length) {
      if (asset.openedOn && date < asset.openedOn) return 0;
      return Number(asset.currentValue || 0);
    }
    let value = Number(asset.currentValue || 0);
    for (const movement of movements) {
      if (movement.date > date) value -= Number(movement.amount);
    }
    return value;
  }

  function marketCostAtDate(asset, date) {
    return normalizePurchases(asset)
      .filter(purchase => purchase.date <= date)
      .reduce((sum, purchase) => sum + Number(purchase.quantity) * Number(purchase.unitPrice), 0);
  }

  function syntheticValueAtDate(assets, date) {
    return assets.reduce((sum, asset) => {
      if (isMarket(asset.kind)) {
        if (date === today()) return sum + assetValue(asset);
        return sum + marketCostAtDate(asset, date);
      }
      return sum + manualValueAtDate(asset, date);
    }, 0);
  }

  function historyForSelection() {
    const assets = filteredAssets();
    if (!assets.length) return [];
    const selected = [...activeSegments];
    const allSelected = selected.length === segments.length;
    const snapshotPoints = state.history
      .map(point => {
        if (allSelected && Number.isFinite(point.value)) return { date: point.date, value: Number(point.value), source: "snapshot" };
        if (point.breakdown && typeof point.breakdown === "object") {
          const value = selected.reduce((sum, segment) => sum + Number(point.breakdown[segment] || 0), 0);
          return Number.isFinite(value) ? { date: point.date, value, source: "snapshot" } : null;
        }
        return null;
      })
      .filter(Boolean);

    const dates = new Set([today()]);
    for (const asset of assets) {
      if (isMarket(asset.kind)) {
        normalizePurchases(asset).forEach(purchase => dates.add(purchase.date));
      } else {
        const movements = normalizeMovements(asset);
        movements.forEach(movement => dates.add(movement.date));
        if (movements.length) dates.add(dayBefore(movements[0].date));
        else if (asset.openedOn) dates.add(asset.openedOn);
      }
    }
    snapshotPoints.forEach(point => dates.add(point.date));

    const byDate = new Map();
    [...dates].sort().forEach(date => byDate.set(date, { date, value: syntheticValueAtDate(assets, date), source: "reconstructed" }));
    snapshotPoints.forEach(point => byDate.set(point.date, point));
    byDate.set(today(), { date: today(), value: totals(assets).value, source: "current" });
    return [...byDate.values()].filter(point => Number.isFinite(point.value)).sort((a, b) => a.date.localeCompare(b.date));
  }

  function purchaseMarkers(assets, minTs, maxTs) {
    const seen = new Map();
    for (const asset of assets) {
      if (!isMarket(asset.kind)) continue;
      for (const purchase of normalizePurchases(asset)) {
        const ts = Date.parse(`${purchase.date}T12:00:00`);
        if (!Number.isFinite(ts) || ts < minTs || ts > maxTs) continue;
        const key = purchase.date;
        const bucket = seen.get(key) || { date: purchase.date, count: 0, labels: [] };
        bucket.count += 1;
        if (bucket.labels.length < 3) bucket.labels.push(asset.name);
        seen.set(key, bucket);
      }
    }
    return [...seen.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  function renderChart(assets) {
    const chart = $("chart"); const empty = $("chartEmpty"); const markerNote = $("chartMarkers");
    chart.replaceChildren(); markerNote.replaceChildren();
    if (!assets.length) { chart.hidden = true; empty.hidden = false; markerNote.textContent = ""; return; }
    const points = historyForSelection();
    const visible = points.length >= 2;
    chart.hidden = !visible; empty.hidden = visible;
    if (!visible) return;

    const width = 700, height = 230, pad = { top: 14, right: 18, bottom: 34, left: 59 };
    const enriched = points.map(p => ({ ...p, ts: Date.parse(`${p.date}T12:00:00`) })).filter(p => Number.isFinite(p.ts) && Number.isFinite(p.value)).sort((a, b) => a.ts - b.ts);
    const vals = enriched.map(p => p.value), min = Math.min(...vals), max = Math.max(...vals), range = Math.max(max - min, max * 0.05, 1);
    const low = Math.max(0, min - range * 0.25), high = max + range * 0.25;
    const minTs = enriched[0].ts, maxTs = enriched.at(-1).ts;
    const span = Math.max(maxTs - minTs, 1);
    const x = ts => pad.left + ((ts - minTs) / span) * (width - pad.left - pad.right);
    const y = value => pad.top + ((high - value) / (high - low)) * (height - pad.top - pad.bottom);
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `Évolution de ${money(enriched[0].value)} à ${money(enriched.at(-1).value)}`);

    for (let i = 0; i < 4; i++) {
      const v = low + ((high - low) * i / 3);
      const yy = y(v);
      const line = document.createElementNS(ns, "line");
      Object.entries({ x1: pad.left, x2: width - pad.right, y1: yy, y2: yy, stroke: "#edf2eb", "stroke-width": 1 }).forEach(([k, value]) => line.setAttribute(k, value));
      svg.append(line);
      const label = document.createElementNS(ns, "text");
      label.setAttribute("x", 0); label.setAttribute("y", yy + 4); label.setAttribute("fill", "#98a89a"); label.setAttribute("font-size", 11); label.textContent = shortMoney(v);
      svg.append(label);
    }

    const markers = purchaseMarkers(assets, minTs, maxTs);
    markers.slice(0, 8).forEach((marker, index) => {
      const markerTs = Date.parse(`${marker.date}T12:00:00`);
      const markerX = x(markerTs);
      const line = document.createElementNS(ns, "line");
      Object.entries({ x1: markerX, x2: markerX, y1: pad.top, y2: height - pad.bottom, stroke: "#c5d7cb", "stroke-dasharray": "4 4", "stroke-width": 1 }).forEach(([k, value]) => line.setAttribute(k, value));
      svg.append(line);
      if (index < 5) {
        const label = document.createElementNS(ns, "text");
        label.setAttribute("x", markerX + 4);
        label.setAttribute("y", pad.top + 12 + (index % 2) * 12);
        label.setAttribute("fill", "#73877b");
        label.setAttribute("font-size", 10);
        label.textContent = displayDate(marker.date);
        svg.append(label);
      }
    });

    const d = enriched.map((point, index) => `${index ? "L" : "M"}${x(point.ts)},${y(point.value)}`).join(" ");
    const area = document.createElementNS(ns, "path"); area.setAttribute("d", `${d} L${x(enriched.at(-1).ts)},${height - pad.bottom} L${x(enriched[0].ts)},${height - pad.bottom} Z`); area.setAttribute("fill", "#e9f5ec"); svg.append(area);
    const path = document.createElementNS(ns, "path"); path.setAttribute("d", d); path.setAttribute("fill", "none"); path.setAttribute("stroke", "#278761"); path.setAttribute("stroke-width", 3); path.setAttribute("stroke-linecap", "round"); path.setAttribute("stroke-linejoin", "round"); svg.append(path);
    const dot = document.createElementNS(ns, "circle"); dot.setAttribute("cx", x(enriched.at(-1).ts)); dot.setAttribute("cy", y(enriched.at(-1).value)); dot.setAttribute("r", 5); dot.setAttribute("fill", "#278761"); dot.setAttribute("stroke", "white"); dot.setAttribute("stroke-width", 2); svg.append(dot);

    const tickIndexes = [0, Math.floor((enriched.length - 1) / 2), enriched.length - 1].filter((value, index, arr) => arr.indexOf(value) === index);
    for (const idx of tickIndexes) {
      const tick = enriched[idx];
      const t = document.createElementNS(ns, "text");
      t.setAttribute("x", x(tick.ts));
      t.setAttribute("y", height - 6);
      t.setAttribute("text-anchor", idx === 0 ? "start" : idx === enriched.length - 1 ? "end" : "middle");
      t.setAttribute("font-size", 11);
      t.setAttribute("fill", "#98a89a");
      t.textContent = new Date(`${tick.date}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "2-digit" });
      svg.append(t);
    }
    chart.append(svg);

    if (markers.length) {
      const text = markers.slice(0, 6).map(marker => `${displayDate(marker.date)} · ${marker.labels.join(", ")}${marker.count > marker.labels.length ? ` +${marker.count - marker.labels.length}` : ""}`).join("  •  ");
      markerNote.textContent = `Repères d'achat : ${text}`;
    } else {
      markerNote.textContent = "";
    }
  }

  function renderFilterChips() {
    document.querySelectorAll('input[name="scopeFilter"]').forEach(input => {
      input.checked = activeSegments.has(input.value);
    });
    $("filterSummary").textContent = activeSegments.size === segments.length
      ? "Tous les compartiments sont affichés."
      : `Affichage : ${[...activeSegments].join(" + ")}.`;
  }

  function clearMovements() {
    $("movementRows").replaceChildren();
  }

  function addMovementRow(movement = {}) {
    const row = document.createElement("div");
    row.className = "movement-row";
    row.innerHTML = `
      <input type="date" class="movement-date" value="${movement.date || today()}" aria-label="Date du mouvement">
      <input type="number" class="movement-amount" step="any" inputmode="decimal" value="${movement.amount ?? ""}" placeholder="Ex. -200 ou 500" aria-label="Montant du mouvement">
      <input type="text" class="movement-label" maxlength="120" value="${String(movement.label || "").replaceAll('"', '&quot;')}" placeholder="Libellé (facultatif)" aria-label="Libellé du mouvement">
      <button type="button" class="icon-btn movement-remove" aria-label="Supprimer ce mouvement">×</button>
    `;
    row.querySelector(".movement-remove").addEventListener("click", () => row.remove());
    $("movementRows").append(row);
  }

  function collectMovements() {
    const movements = [];
    for (const row of $("movementRows").children) {
      const date = row.querySelector(".movement-date").value;
      const rawAmount = row.querySelector(".movement-amount").value;
      const amount = Number(rawAmount);
      const label = row.querySelector(".movement-label").value.trim();
      if (!date && !rawAmount && !label) continue;
      if (!date || !Number.isFinite(amount) || amount === 0) return { error: "Chaque mouvement doit avoir une date et un montant différent de 0." };
      movements.push({ id: makeId(), date, amount, label });
    }
    movements.sort((a, b) => a.date.localeCompare(b.date));
    return { movements };
  }

  function parseImportedDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toLocaleDateString("sv-SE");
    const text = String(value ?? "").trim();
    if (!text) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    let match = text.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
    if (match) return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
    match = text.match(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/);
    if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleDateString("sv-SE");
  }

  function parseImportedAmount(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    let text = String(value ?? "").trim().replace(/\s/g, "").replace(/€/g, "");
    if (!text) return null;
    if (text.includes(",") && text.includes(".")) {
      if (text.lastIndexOf(",") > text.lastIndexOf(".")) text = text.replaceAll(".", "").replace(",", ".");
      else text = text.replaceAll(",", "");
    } else {
      text = text.replace(",", ".");
    }
    const amount = Number(text);
    return Number.isFinite(amount) ? amount : null;
  }

  async function importMovementFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      if (!globalThis.XLSX) throw new Error("Le lecteur de tableur n’est pas chargé. Rechargez la page puis réessayez.");
      if (file.size > 5_000_000) throw new Error("Fichier trop volumineux (5 Mo maximum)");
      const workbook = globalThis.XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = globalThis.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
      if (!rows.length) throw new Error("Le tableur est vide");

      const headers = rows[0].map(value => String(value).trim().toLowerCase());
      let dateIndex = headers.findIndex(h => ["date", "date mouvement", "date du mouvement"].includes(h) || h.includes("date"));
      let amountIndex = headers.findIndex(h => ["mouvement", "montant", "amount", "variation"].includes(h) || h.includes("mouvement") || h.includes("montant"));
      let labelIndex = headers.findIndex(h => h.includes("libell") || h.includes("label") || h.includes("description"));
      let start = 1;
      if (dateIndex < 0 || amountIndex < 0) {
        dateIndex = 0; amountIndex = 1; labelIndex = rows[0].length > 2 ? 2 : -1; start = 0;
      }

      const imported = [];
      for (let i = start; i < rows.length; i++) {
        const row = rows[i];
        const date = parseImportedDate(row[dateIndex]);
        const amount = parseImportedAmount(row[amountIndex]);
        const label = labelIndex >= 0 ? String(row[labelIndex] ?? "").trim().slice(0, 120) : "";
        if (!date && amount === null && !label) continue;
        if (!date || amount === null || amount === 0) continue;
        imported.push({ id: makeId(), date, amount, label });
      }
      if (!imported.length) throw new Error("Aucun mouvement valide trouvé. Utilisez au minimum deux colonnes : Date et Mouvement.");
      imported.sort((a, b) => a.date.localeCompare(b.date));
      imported.forEach(addMovementRow);
      $("movementImportState").textContent = `${imported.length} mouvement${imported.length > 1 ? "s" : ""} importé${imported.length > 1 ? "s" : ""}. Ils seront appliqués à l’enregistrement.`;
    } catch (error) {
      formError(`Import des mouvements impossible : ${error.message}`);
    }
  }

  function updateFields() {
    const kind = $("kind").value;
    const market = isMarket(kind);
    $("manualFields").hidden = market;
    $("marketFields").hidden = !market;
    $("movementSection").hidden = market;
    $("isinFields").hidden = !usesIsin(kind);
    $("manualQuoteField").hidden = !usesIsin(kind);
    $("purchaseSection").hidden = !market;
    if (market && !$("purchaseRows").children.length) addPurchaseRow();
    if (!editingId && !$("name").dataset.userEdited) $("name").value = kind === "btc" ? "Bitcoin" : kinds[kind].label.replace("ETF · PEA", "Mon ETF PEA");
  }

  function clearPurchases() {
    $("purchaseRows").replaceChildren();
  }

  function addPurchaseRow(purchase = {}) {
    const row = document.createElement("div");
    row.className = "purchase-row";
    row.innerHTML = `
      <input type="date" class="purchase-date" value="${purchase.date || today()}" aria-label="Date d'achat">
      <input type="number" class="purchase-quantity" min="0" step="any" inputmode="decimal" value="${purchase.quantity ?? ""}" placeholder="Quantité" aria-label="Quantité">
      <input type="number" class="purchase-price" min="0" step="any" inputmode="decimal" value="${purchase.unitPrice ?? ""}" placeholder="Prix moyen" aria-label="Prix moyen d'achat">
      <button type="button" class="icon-btn purchase-remove" aria-label="Supprimer cet achat">×</button>
    `;
    row.querySelector(".purchase-remove").addEventListener("click", () => {
      row.remove();
      if (!$("purchaseRows").children.length) addPurchaseRow();
    });
    $("purchaseRows").append(row);
  }

  function openDialog(asset = null) {
    editingId = asset?.id || null;
    $("assetForm").reset();
    $("name").dataset.userEdited = "";
    $("formError").hidden = true;
    clearPurchases();
    clearMovements();
    $("movementImportState").textContent = "";
    $("dialogTitle").textContent = asset ? "Modifier un actif" : "Ajouter un actif";
    $("saveBtn").textContent = asset ? "Enregistrer les modifications" : "Enregistrer";

    if (asset) {
      $("kind").value = asset.kind;
      $("name").value = asset.name;
      $("currentValue").value = asset.currentValue ?? "";
      $("costManual").value = assetCost(asset);
      $("openedOn").value = asset.openedOn || "";
      $("isin").value = asset.isin || "";
      $("ticker").value = asset.ticker || "";
      $("manualPrice").value = asset.manualPrice ?? "";
      if (isMarket(asset.kind)) normalizePurchases(asset).forEach(addPurchaseRow);
      else normalizeMovements(asset).forEach(addMovementRow);
    } else {
      $("kind").value = "livret-a";
      $("openedOn").value = today();
      addPurchaseRow();
    }
    updateFields();
    if (asset && !isMarket(asset.kind) && !$("openedOn").value) $("openedOn").value = "";
    if (asset && isMarket(asset.kind) && !$("purchaseRows").children.length) addPurchaseRow();
    $("assetDialog").showModal();
  }
  function closeDialog() { $("assetDialog").close(); editingId = null; }
  function formError(message) { $("formError").textContent = message; $("formError").hidden = false; }

  function collectPurchases() {
    const purchases = [];
    for (const row of $("purchaseRows").children) {
      const date = row.querySelector(".purchase-date").value;
      const quantity = safeNonNegative(row.querySelector(".purchase-quantity").value);
      const unitPrice = safeNonNegative(row.querySelector(".purchase-price").value);
      if (!date && quantity === null && unitPrice === null) continue;
      if (!date || quantity === null || quantity <= 0 || unitPrice === null) return { error: "Complétez chaque achat avec une date, une quantité positive et un prix moyen valide." };
      purchases.push({ id: makeId(), date, quantity, unitPrice });
    }
    if (!purchases.length) return { error: "Ajoutez au moins un achat pour cet actif." };
    purchases.sort((a, b) => a.date.localeCompare(b.date));
    return { purchases };
  }

  function saveForm(event) {
    event.preventDefault();
    const kind = $("kind").value;
    const name = $("name").value.trim();
    if (!name) return formError("Indiquez un nom pour cet actif.");
    let asset = { id: editingId || makeId(), kind, name };
    if (isMarket(kind)) {
      const result = collectPurchases();
      if (result.error) return formError(result.error);
      const purchases = result.purchases;
      const quantity = purchases.reduce((sum, p) => sum + Number(p.quantity), 0);
      const cost = purchases.reduce((sum, p) => sum + Number(p.quantity) * Number(p.unitPrice), 0);
      asset = { ...asset, purchases, quantity, cost, openedOn: purchases[0]?.date };
      if (usesIsin(kind)) {
        const isin = $("isin").value.trim().toUpperCase();
        const ticker = $("ticker").value.trim().toUpperCase();
        const manualPrice = $("manualPrice").value ? safeNonNegative($("manualPrice").value) : null;
        if (!isin && !ticker) return formError("Indiquez l’ISIN ou le ticker du support.");
        if (isin && !/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)) return formError("L’ISIN doit contenir 12 caractères valides.");
        if (ticker && !/^[A-Z0-9.:/-]{1,24}$/.test(ticker)) return formError("Le ticker contient des caractères non valides.");
        if ($("manualPrice").value && (manualPrice === null || manualPrice <= 0)) return formError("Le cours de secours doit être positif.");
        asset.isin = isin;
        asset.ticker = ticker;
        if (manualPrice !== null) asset.manualPrice = manualPrice;
      }
    } else {
      const currentValue = safeNonNegative($("currentValue").value);
      const cost = $("costManual").value ? safeNonNegative($("costManual").value) : currentValue;
      const openedOn = $("openedOn").value || undefined;
      const movementResult = collectMovements();
      if (movementResult.error) return formError(movementResult.error);
      if (!$("currentValue").value || currentValue === null || cost === null) return formError("Indiquez une valeur et un total versé valides.");
      asset = { ...asset, currentValue, cost, openedOn, movements: movementResult.movements };
    }

    const index = state.assets.findIndex(a => a.id === asset.id);
    if (index >= 0) state.assets[index] = normalizeAsset(asset); else state.assets.push(normalizeAsset(asset));
    save(); snapshot(); closeDialog(); render();
    if (isMarket(kind)) refreshPrices(true);
  }

  function deleteAsset(asset) {
    if (!confirm(`Supprimer « ${asset.name} » ?`)) return;
    state.assets = state.assets.filter(a => a.id !== asset.id);
    save(); snapshot(); render();
  }

  function showNotice(message) { $("notice").textContent = message; $("notice").hidden = false; }

  async function refreshPrices(force = false) {
    const marketAssets = state.assets.filter(a => isMarket(a.kind));
    if (!marketAssets.length) return;
    const fetchEtfs = force || quoteCache.etfFetchedAt !== marketSlot();
    const fetchBtc = marketAssets.some(a => a.kind === "btc") && (force || !quoteCache.fetchedAt || Date.now() - Date.parse(quoteCache.fetchedAt) >= 5 * 60 * 1000);
    const symbols = fetchEtfs ? [...new Set(marketAssets.filter(a => usesIsin(a.kind)).map(quoteSymbol))] : [];
    if (!symbols.length && !fetchBtc) return;
    const url = `/api/prices?symbols=${encodeURIComponent(symbols.join(","))}&btc=${fetchBtc ? "1" : "0"}`;
    $("refreshBtn").disabled = true; $("refreshBtn").textContent = "Actualisation…";
    try {
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`service indisponible (${response.status})`);
      const data = await response.json();
      for (const [symbol, quote] of Object.entries(data.quotes || {})) if (quote.currency === "EUR" && Number.isFinite(quote.price)) quoteCache.quotes[symbol] = quote;
      if (symbols.length) quoteCache.etfFetchedAt = marketSlot();
      quoteCache.fetchedAt = data.fetchedAt || new Date().toISOString();
      saveQuotes(); snapshot(); render();
      const errors = Object.entries(data.errors || {});
      if (errors.length) {
        const details = errors.map(([symbol, error]) => `${symbol} (${error})`).join(" ; ");
        const advice = errors.some(([, error]) => error.includes("Clé EODHD absente"))
          ? " Ajoutez EODHD_API_KEY dans Netlify, puis relancez un déploiement."
          : " Vérifiez l’ISIN ou le ticker chez EODHD ; un cours actuel de secours peut être saisi en modifiant l’actif.";
        showNotice(`Cours non récupérés : ${details}.${advice}`);
      } else {
        $("notice").hidden = true;
      }
    } catch (error) {
      showNotice(`Cours indisponibles : ${error.message}. En local, lancez l’app avec Netlify Dev pour activer la fonction de prix.`);
    } finally {
      $("refreshBtn").disabled = false; $("refreshBtn").textContent = "↻ Actualiser les cours";
    }
  }

  function exportData() {
    const blob = new Blob([JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), ...state }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `clair-patrimoine-${today()}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importData(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error("Fichier trop volumineux");
      const data = JSON.parse(await file.text());
      if (![1, 2].includes(data.version) || !Array.isArray(data.assets) || !Array.isArray(data.history)) throw new Error("Format de sauvegarde invalide");
      const assets = data.assets.map(normalizeAsset).filter(validAsset);
      if (!confirm(`Importer ${assets.length} actif(s) ? Les données présentes sur cet appareil seront remplacées.`)) return;
      state = { assets, history: data.history.filter(x => typeof x.date === "string").slice(-2000) };
      quoteCache = { quotes: {}, fetchedAt: null, etfFetchedAt: null };
      save(); saveQuotes(); snapshot(); render(); refreshPrices(true);
      showNotice("Sauvegarde importée avec succès.");
    } catch (error) {
      showNotice(`Import impossible : ${error.message}.`);
    }
  }

  function toggleSegment(segment, checked) {
    if (checked) activeSegments.add(segment); else activeSegments.delete(segment);
    if (!activeSegments.size) activeSegments = new Set(segments);
    saveFilters(); render();
  }

  $("addBtn").addEventListener("click", () => openDialog());
  $("emptyAddBtn").addEventListener("click", () => openDialog());
  $("closeDialog").addEventListener("click", closeDialog);
  $("cancelDialog").addEventListener("click", closeDialog);
  $("assetDialog").addEventListener("click", event => { if (event.target === $("assetDialog")) closeDialog(); });
  $("kind").addEventListener("change", updateFields);
  $("name").addEventListener("input", () => { $("name").dataset.userEdited = "1"; });
  $("assetForm").addEventListener("submit", saveForm);
  $("refreshBtn").addEventListener("click", () => refreshPrices(true));
  $("exportBtn").addEventListener("click", exportData);
  $("importBtn").addEventListener("click", () => $("importFile").click());
  $("importFile").addEventListener("change", importData);
  $("addPurchaseBtn").addEventListener("click", () => addPurchaseRow());
  $("addMovementBtn").addEventListener("click", () => addMovementRow());
  $("importMovementsBtn").addEventListener("click", () => $("movementFile").click());
  $("movementFile").addEventListener("change", importMovementFile);
  document.querySelectorAll('input[name="scopeFilter"]').forEach(input => input.addEventListener("change", event => toggleSegment(event.target.value, event.target.checked)));

  snapshot();
  render();
  refreshPrices();
  setInterval(() => refreshPrices(), 5 * 60 * 1000);
})();
