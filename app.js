(() => {
  "use strict";
  const STORAGE_KEY = "clair-portfolio-v1";
  const PRICE_KEY = "clair-price-cache-v1";
  const kinds = {
    "livret-a": { label: "Livret A", group: "Épargne", color: "#348d6c" },
    "livret-jeune": { label: "Livret jeune", group: "Épargne", color: "#348d6c" },
    pel: { label: "PEL", group: "Épargne", color: "#348d6c" },
    "assurance-vie": { label: "Assurance-vie · globale", group: "Assurance-vie", color: "#a6bb6b" },
    "av-euro": { label: "Fonds en euros · assurance-vie", group: "Fonds en euros", color: "#a6bb6b" },
    "av-uc": { label: "Unité de compte · assurance-vie", group: "Unités de compte", color: "#847fc3" },
    etf: { label: "ETF · PEA", group: "PEA", color: "#91afa0" },
    btc: { label: "Bitcoin", group: "Bitcoin", color: "#e7b85b" }
  };
  const $ = id => document.getElementById(id);
  const money = n => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(n);
  const shortMoney = n => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0, notation: n >= 1000000 ? "compact" : "standard" }).format(n);
  const number = (n, digits = 4) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: digits }).format(n);
  const percent = n => `${n >= 0 ? "+" : "−"}${number(Math.abs(n), 2)} %`;
  const signedMoney = n => `${n >= 0 ? "+" : "−"}${money(Math.abs(n))}`;
  const isMarket = kind => kind === "etf" || kind === "av-uc" || kind === "btc";
  const usesIsin = kind => kind === "etf" || kind === "av-uc";
  const today = () => new Date().toLocaleDateString("sv-SE");
  const makeId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const safeNonNegative = value => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  let editingId = null;
  let state = loadState();
  let quoteCache = loadQuotes();

  function loadState() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (raw && Array.isArray(raw.assets) && Array.isArray(raw.history)) return {
        assets: raw.assets.filter(validAsset),
        history: raw.history.filter(x => typeof x.date === "string" && Number.isFinite(x.value)).slice(-365)
      };
    } catch (_) { /* malformed local data */ }
    return { assets: [], history: [] };
  }
  function loadQuotes() {
    try {
      const raw = JSON.parse(localStorage.getItem(PRICE_KEY));
      if (raw && typeof raw === "object" && raw.quotes && typeof raw.quotes === "object") return raw;
    } catch (_) { /* malformed cache */ }
    return { quotes: {}, fetchedAt: null };
  }
  function validAsset(a) {
    if (!a || typeof a.id !== "string" || !a.id || typeof a.name !== "string" || !a.name.trim() || a.name.length > 80 || !kinds[a.kind] || safeNonNegative(a.cost) === null) return false;
    if (!isMarket(a.kind)) return safeNonNegative(a.currentValue) !== null;
    if (safeNonNegative(a.quantity) === null || Number(a.quantity) <= 0) return false;
    if (a.kind === "btc") return true;
    return typeof a.isin === "string" && typeof a.ticker === "string" && (!a.isin || /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(a.isin)) && (!a.ticker || /^[A-Z0-9.:/-]{1,24}$/.test(a.ticker)) && Boolean(a.isin || a.ticker);
  }
  function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  function saveQuotes() { localStorage.setItem(PRICE_KEY, JSON.stringify(quoteCache)); }
  function quoteSymbol(asset) { return asset.kind === "btc" ? "BTC" : (asset.ticker || asset.isin || "").toUpperCase(); }
  function assetValue(asset) {
    if (!isMarket(asset.kind)) return Number(asset.currentValue);
    const quote = quoteCache.quotes[quoteSymbol(asset)];
    return quote && Number.isFinite(quote.price) && quote.price > 0 ? Number(asset.quantity) * quote.price : Number(asset.cost);
  }
  function hasQuote(asset) { return !isMarket(asset.kind) || !!quoteCache.quotes[quoteSymbol(asset)]; }
  function totals() {
    const cost = state.assets.reduce((sum, a) => sum + Number(a.cost), 0);
    const value = state.assets.reduce((sum, a) => sum + assetValue(a), 0);
    const pending = state.assets.filter(a => !hasQuote(a)).length;
    return { cost, value, gain: value - cost, pct: cost > 0 ? ((value - cost) / cost) * 100 : 0, pending };
  }
  function snapshot() {
    if (!state.assets.length) return;
    const point = { date: today(), value: totals().value };
    const existing = state.history.findIndex(x => x.date === point.date);
    if (existing >= 0) state.history[existing] = point;
    else state.history.push(point);
    state.history.sort((a, b) => a.date.localeCompare(b.date));
    state.history = state.history.slice(-365);
    save();
  }

  function render() {
    const t = totals();
    $("totalValue").textContent = money(t.value);
    $("totalCost").textContent = money(t.cost);
    $("totalGain").textContent = signedMoney(t.gain);
    $("totalGain").classList.toggle("negative", t.gain < 0);
    $("totalDelta").textContent = `${signedMoney(t.gain)} (${percent(t.pct)})`;
    $("totalDelta").classList.toggle("negative", t.gain < 0);
    const asOf = quoteCache.fetchedAt ? new Date(quoteCache.fetchedAt) : null;
    $("priceState").textContent = t.pending ? `${t.pending} cours manquant${t.pending > 1 ? "s" : ""}` : (asOf && state.assets.some(a => isMarket(a.kind)) ? `Cours ${asOf.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : "Valeurs saisies");
    $("assetCount").textContent = `${state.assets.length} actif${state.assets.length > 1 ? "s" : ""}`;
    renderAssets(); renderAllocation(); renderChart();
  }
  function renderAssets() {
    const tbody = $("assetsBody"); tbody.replaceChildren();
    $("emptyAssets").hidden = state.assets.length > 0;
    if (!state.assets.length) return;
    for (const a of state.assets) {
      const value = assetValue(a), gain = value - Number(a.cost), pct = Number(a.cost) > 0 ? gain / Number(a.cost) * 100 : 0;
      const tr = document.createElement("tr");
      const cell = () => { const td = document.createElement("td"); tr.append(td); return td; };
      const nameTd = cell();
      const title = document.createElement("div"); title.className = "asset-name"; title.textContent = a.name; nameTd.append(title);
      const type = document.createElement("div"); type.className = "asset-type"; type.textContent = kinds[a.kind].label + (usesIsin(a.kind) && a.isin ? ` · ${a.isin}` : ""); nameTd.append(type);
      const position = cell(); position.textContent = isMarket(a.kind) ? `${number(a.quantity, a.kind === "btc" ? 8 : 4)} ${a.kind === "btc" ? "BTC" : "parts"}` : "Valeur saisie";
      if (isMarket(a.kind)) { const costSub = document.createElement("div"); costSub.className = "asset-sub"; costSub.textContent = `Achat : ${money(Number(a.cost) / Number(a.quantity))} / ${a.kind === "btc" ? "BTC" : "part"}`; position.append(costSub); }
      const valueTd = cell(); const valueNode = document.createElement("div"); valueNode.className = "value"; valueNode.textContent = money(value); valueTd.append(valueNode);
      if (isMarket(a.kind)) { const sub = document.createElement("div"); sub.className = "asset-sub"; const quote = quoteCache.quotes[quoteSymbol(a)]; sub.textContent = quote ? `${money(quote.price)} / ${a.kind === "btc" ? "BTC" : "part"} · ${quote.source}` : "Estimation au prix d’achat"; valueTd.append(sub); }
      const gainTd = cell(); gainTd.className = gain > 0 ? "gain-positive" : gain < 0 ? "gain-negative" : "gain-neutral"; gainTd.textContent = `${signedMoney(gain)} · ${percent(pct)}`;
      const actions = cell(); const wrap = document.createElement("div"); wrap.className = "row-actions";
      const edit = document.createElement("button"); edit.type = "button"; edit.className = "icon-btn"; edit.textContent = "✎"; edit.title = `Modifier ${a.name}`; edit.setAttribute("aria-label", edit.title); edit.addEventListener("click", () => openDialog(a));
      const del = document.createElement("button"); del.type = "button"; del.className = "icon-btn"; del.textContent = "×"; del.title = `Supprimer ${a.name}`; del.setAttribute("aria-label", del.title); del.addEventListener("click", () => deleteAsset(a));
      wrap.append(edit, del); actions.append(wrap); tbody.append(tr);
    }
  }
  function renderAllocation() {
    const groups = ["Épargne", "PEA", "Bitcoin", "Fonds en euros", "Unités de compte", "Assurance-vie"];
    const colors = { "Épargne": "#348d6c", PEA: "#91afa0", Bitcoin: "#e7b85b", "Fonds en euros": "#a6bb6b", "Unités de compte": "#847fc3", "Assurance-vie": "#c4bf9c" };
    const values = Object.fromEntries(groups.map(g => [g, state.assets.filter(a => kinds[a.kind].group === g).reduce((sum, a) => sum + assetValue(a), 0)]));
    const total = Object.values(values).reduce((a, b) => a + b, 0);
    $("donutTotal").textContent = shortMoney(total);
    let angle = 0; const stops = [];
    for (const group of groups) { if (values[group] <= 0 || total <= 0) continue; const next = angle + values[group] / total * 360; stops.push(`${colors[group]} ${angle}deg ${next}deg`); angle = next; }
    $("donut").style.background = stops.length ? `conic-gradient(${stops.join(",")})` : "#edf2ed";
    const legend = $("allocationLegend"); legend.replaceChildren();
    for (const group of groups) { if (values[group] <= 0) continue; const item = document.createElement("span"); item.className = "legend-item"; const dot = document.createElement("span"); dot.className = "legend-dot"; dot.style.background = colors[group]; item.append(dot, document.createTextNode(`${group} ${number(values[group] / total * 100, 0)} %`)); legend.append(item); }
  }
  function renderChart() {
    const chart = $("chart"), empty = $("chartEmpty"); chart.replaceChildren();
    const points = state.history.filter(x => Number.isFinite(x.value));
    const visible = points.length >= 2;
    chart.hidden = !visible; empty.hidden = visible;
    if (!visible) return;
    const width = 700, height = 210, pad = { top: 12, right: 14, bottom: 29, left: 59 };
    const vals = points.map(p => p.value), min = Math.min(...vals), max = Math.max(...vals), range = Math.max(max - min, max * .05, 1);
    const low = Math.max(0, min - range * .25), high = max + range * .25;
    const x = i => pad.left + i / (points.length - 1) * (width - pad.left - pad.right);
    const y = v => pad.top + (high - v) / (high - low) * (height - pad.top - pad.bottom);
    const ns = "http://www.w3.org/2000/svg"; const svg = document.createElementNS(ns, "svg"); svg.setAttribute("viewBox", `0 0 ${width} ${height}`); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", `Évolution de ${money(points[0].value)} à ${money(points.at(-1).value)}`);
    for (let i = 0; i < 3; i++) { const v = low + (high - low) * i / 2, yy = y(v); const line = document.createElementNS(ns, "line"); Object.entries({ x1: pad.left, x2: width - pad.right, y1: yy, y2: yy, stroke: "#edf2eb", "stroke-width": 1 }).forEach(([k, val]) => line.setAttribute(k, val)); svg.append(line); const label = document.createElementNS(ns, "text"); label.setAttribute("x", 0); label.setAttribute("y", yy + 4); label.setAttribute("fill", "#98a89a"); label.setAttribute("font-size", 11); label.textContent = shortMoney(v); svg.append(label); }
    const d = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.value)}`).join(" ");
    const area = document.createElementNS(ns, "path"); area.setAttribute("d", `${d} L${x(points.length - 1)},${height - pad.bottom} L${x(0)},${height - pad.bottom} Z`); area.setAttribute("fill", "#e9f5ec"); svg.append(area);
    const path = document.createElementNS(ns, "path"); path.setAttribute("d", d); path.setAttribute("fill", "none"); path.setAttribute("stroke", "#278761"); path.setAttribute("stroke-width", 3); path.setAttribute("stroke-linecap", "round"); path.setAttribute("stroke-linejoin", "round"); svg.append(path);
    const dot = document.createElementNS(ns, "circle"); dot.setAttribute("cx", x(points.length - 1)); dot.setAttribute("cy", y(points.at(-1).value)); dot.setAttribute("r", 5); dot.setAttribute("fill", "#278761"); dot.setAttribute("stroke", "white"); dot.setAttribute("stroke-width", 2); svg.append(dot);
    for (const [i, anchor] of [[0, "start"], [points.length - 1, "end"]]) { const t = document.createElementNS(ns, "text"); t.setAttribute("x", x(i)); t.setAttribute("y", height - 4); t.setAttribute("text-anchor", anchor); t.setAttribute("font-size", 11); t.setAttribute("fill", "#98a89a"); t.textContent = new Date(`${points[i].date}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }); svg.append(t); }
    chart.append(svg);
  }

  function updateFields() {
    const kind = $("kind").value, market = isMarket(kind);
    $("manualFields").hidden = market; $("marketFields").hidden = !market; $("isinFields").hidden = !usesIsin(kind);
    $("quantityLabel").textContent = kind === "btc" ? "Quantité de BTC" : "Nombre de parts";
    $("purchasePriceLabel").textContent = kind === "btc" ? "Prix moyen d’achat (€ / BTC)" : "Prix moyen d’achat (€ / part)";
    if (!editingId && !$("name").dataset.userEdited) $("name").value = kind === "btc" ? "Bitcoin" : kinds[kind].label.replace("ETF · PEA", "Mon ETF PEA");
  }
  function openDialog(asset = null) {
    editingId = asset?.id || null;
    $("assetForm").reset(); $("name").dataset.userEdited = ""; $("formError").hidden = true;
    $("dialogTitle").textContent = asset ? "Modifier un actif" : "Ajouter un actif";
    $("saveBtn").textContent = asset ? "Enregistrer les modifications" : "Enregistrer";
    if (asset) { $("kind").value = asset.kind; $("name").value = asset.name; $("currentValue").value = asset.currentValue ?? ""; $("costManual").value = asset.cost; $("isin").value = asset.isin || ""; $("ticker").value = asset.ticker || ""; $("quantity").value = asset.quantity ?? ""; $("purchasePrice").value = isMarket(asset.kind) ? Number(asset.cost) / Number(asset.quantity) : ""; }
    else $("kind").value = "livret-a";
    updateFields(); if (asset) $("name").value = asset.name;
    $("assetDialog").showModal();
  }
  function closeDialog() { $("assetDialog").close(); editingId = null; }
  function formError(message) { $("formError").textContent = message; $("formError").hidden = false; }
  function saveForm(event) {
    event.preventDefault();
    const kind = $("kind").value, name = $("name").value.trim();
    if (!name) return formError("Indiquez un nom pour cet actif.");
    let asset = { id: editingId || makeId(), kind, name };
    if (isMarket(kind)) {
      const quantity = safeNonNegative($("quantity").value), purchasePrice = safeNonNegative($("purchasePrice").value);
      if (!$("quantity").value || quantity === null || quantity <= 0 || !$("purchasePrice").value || purchasePrice === null) return formError("Indiquez une quantité positive et le prix d’achat par part ou BTC.");
      const cost = quantity * purchasePrice;
      if (!Number.isFinite(cost)) return formError("Le montant investi est trop élevé.");
      asset = { ...asset, quantity, cost };
      if (usesIsin(kind)) {
        const isin = $("isin").value.trim().toUpperCase(), ticker = $("ticker").value.trim().toUpperCase();
        if (!isin && !ticker) return formError("Indiquez l’ISIN ou le ticker du support.");
        if (isin && !/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)) return formError("L’ISIN doit contenir 12 caractères valides.");
        if (ticker && !/^[A-Z0-9.:/-]{1,24}$/.test(ticker)) return formError("Le ticker contient des caractères non valides.");
        asset.isin = isin; asset.ticker = ticker;
      }
    } else {
      const currentValue = safeNonNegative($("currentValue").value), cost = $("costManual").value ? safeNonNegative($("costManual").value) : currentValue;
      if (!$("currentValue").value || currentValue === null || cost === null) return formError("Indiquez une valeur et un total versé valides.");
      asset = { ...asset, currentValue, cost };
    }
    const index = state.assets.findIndex(a => a.id === asset.id);
    if (index >= 0) state.assets[index] = asset; else state.assets.push(asset);
    save(); snapshot(); closeDialog(); render();
    if (isMarket(kind)) refreshPrices(true);
  }
  function deleteAsset(asset) {
    if (!confirm(`Supprimer « ${asset.name} » ?`)) return;
    state.assets = state.assets.filter(a => a.id !== asset.id); save(); snapshot(); render();
  }
  function showNotice(message) { $("notice").textContent = message; $("notice").hidden = false; }
  async function refreshPrices(force = false) {
    const market = state.assets.filter(a => isMarket(a.kind));
    if (!market.length) return;
    if (!force && quoteCache.fetchedAt && Date.now() - Date.parse(quoteCache.fetchedAt) < 5 * 60 * 1000) return;
    const symbols = [...new Set(market.filter(a => usesIsin(a.kind)).map(quoteSymbol))];
    const url = `/api/prices?symbols=${encodeURIComponent(symbols.join(","))}&btc=${market.some(a => a.kind === "btc") ? "1" : "0"}`;
    $("refreshBtn").disabled = true; $("refreshBtn").textContent = "Actualisation…";
    try {
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`service indisponible (${response.status})`);
      const data = await response.json();
      for (const [symbol, quote] of Object.entries(data.quotes || {})) if (quote.currency === "EUR" && Number.isFinite(quote.price)) quoteCache.quotes[symbol] = quote;
      quoteCache.fetchedAt = data.fetchedAt || new Date().toISOString(); saveQuotes(); snapshot(); render();
      const errors = Object.entries(data.errors || {});
      if (errors.length) showNotice(`Cours non récupérés : ${errors.map(([s, e]) => `${s} (${e})`).join(" ; ")}. Vérifiez le ticker et la configuration API.`);
      else $("notice").hidden = true;
    } catch (error) { showNotice(`Cours indisponibles : ${error.message}. En local, lancez l’app avec Netlify Dev pour activer la fonction de prix.`); }
    finally { $("refreshBtn").disabled = false; $("refreshBtn").textContent = "↻ Actualiser les cours"; }
  }
  function exportData() {
    const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), ...state }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = `clair-patrimoine-${today()}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importData(event) {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error("Fichier trop volumineux");
      const data = JSON.parse(await file.text());
      if (data.version !== 1 || !Array.isArray(data.assets) || !Array.isArray(data.history) || !data.assets.every(validAsset)) throw new Error("Format de sauvegarde invalide");
      if (!confirm(`Importer ${data.assets.length} actif(s) ? Les données présentes sur cet appareil seront remplacées.`)) return;
      state = { assets: data.assets, history: data.history.filter(x => typeof x.date === "string" && Number.isFinite(x.value)).slice(-365) };
      quoteCache = { quotes: {}, fetchedAt: null }; save(); saveQuotes(); snapshot(); render(); refreshPrices(true);
      showNotice("Sauvegarde importée avec succès.");
    } catch (error) { showNotice(`Import impossible : ${error.message}.`); }
  }

  $("addBtn").addEventListener("click", () => openDialog());
  $("emptyAddBtn").addEventListener("click", () => openDialog());
  $("closeDialog").addEventListener("click", closeDialog);
  $("cancelDialog").addEventListener("click", closeDialog);
  $("assetDialog").addEventListener("click", e => { if (e.target === $("assetDialog")) closeDialog(); });
  $("kind").addEventListener("change", updateFields);
  $("name").addEventListener("input", () => { $("name").dataset.userEdited = "1"; });
  $("assetForm").addEventListener("submit", saveForm);
  $("refreshBtn").addEventListener("click", () => refreshPrices(true));
  $("exportBtn").addEventListener("click", exportData);
  $("importBtn").addEventListener("click", () => $("importFile").click());
  $("importFile").addEventListener("change", importData);
  snapshot(); render(); refreshPrices();
  setInterval(() => refreshPrices(), 5 * 60 * 1000);
})();
