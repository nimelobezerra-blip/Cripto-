"use strict";

// Cripto — preços ao vivo, análise com projeção estatística, carteira e alertas.
// Dados: API pública da CoinGecko (sem chave). Carteira e alertas ficam no localStorage.

const API = "https://api.coingecko.com/api/v3";
const REFRESH_MS = 60 * 1000;
const CHART_TTL_MS = 5 * 60 * 1000;
const Z80 = 1.2816; // quantil para faixa de 80%

const state = {
  cur: load("cripto.cur", "brl"),
  fx: null, // reais por dólar
  markets: [], // preços em USD
  showAll: false,
  selected: load("cripto.selected", "bitcoin"),
  days: 90,
  horizon: 14,
  wallet: load("cripto.wallet", []),
  alerts: load("cripto.alerts", []),
  updatedAt: null,
  analysisToken: 0,
};
const chartCache = new Map();

// ---------- utilidades ----------

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* armazenamento indisponível: segue sem guardar */
  }
}

const $ = (sel) => document.querySelector(sel);

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

const SVG_NS = "http://www.w3.org/2000/svg";
function svg(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
  return node;
}

function toCur(usd, cur = state.cur) {
  if (usd == null) return null;
  return cur === "brl" ? usd * (state.fx || 0) : usd;
}
function convert(value, from, to) {
  if (from === to || value == null) return value;
  if (!state.fx) return null;
  return from === "usd" ? value * state.fx : value / state.fx;
}

function fmtMoney(v, cur = state.cur, opts = {}) {
  if (v == null || !isFinite(v)) return "—";
  const currency = cur.toUpperCase();
  const abs = Math.abs(v);
  const o = { style: "currency", currency };
  if (opts.compact) Object.assign(o, { notation: "compact", maximumFractionDigits: 2 });
  else if (abs >= 1 || abs === 0) Object.assign(o, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  else Object.assign(o, { minimumSignificantDigits: 2, maximumSignificantDigits: 4 });
  return new Intl.NumberFormat("pt-BR", o).format(v);
}
function fmtNum(v, digits = 2) {
  if (v == null || !isFinite(v)) return "—";
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(v);
}
function pctNode(p) {
  if (p == null || !isFinite(p)) return el("span", { class: "muted" }, "—");
  const up = p >= 0;
  return el(
    "span",
    { class: up ? "up" : "down" },
    (up ? "▲ " : "▼ ") + new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(Math.abs(p)) + "%"
  );
}
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
function fmtDate(ms, withYear) {
  const d = new Date(ms);
  if (withYear) return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function setStatus(text, isError) {
  const s = $("#status");
  s.textContent = text;
  s.classList.toggle("error", !!isError);
}

function toast(text) {
  const t = el("div", { class: "toast" }, text);
  $("#toasts").append(t);
  setTimeout(() => t.remove(), 9000);
}

async function getJSON(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (res.status === 429) throw new Error("limite");
  if (!res.ok) throw new Error("http " + res.status);
  return res.json();
}

// ---------- mercado ----------

async function loadMarkets() {
  try {
    const [markets, rates] = await Promise.all([
      getJSON(`${API}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=20&page=1&price_change_percentage=24h,7d,30d`),
      getJSON(`${API}/exchange_rates`),
    ]);
    state.fx = rates.rates.brl.value / rates.rates.usd.value;
    state.markets = markets;
    state.updatedAt = new Date();
    setStatus("");
    $("#updated").textContent = "Atualizado às " + state.updatedAt.toLocaleTimeString("pt-BR");
    renderMarket();
    fillSelects();
    renderWallet();
    checkAlerts();
    renderAlerts();
    if (!state.analysisLoaded) loadAnalysis();
  } catch (err) {
    const why = err.message === "limite" ? "a CoinGecko limitou os pedidos" : "sem conexão com os dados";
    setStatus(`Não foi possível atualizar (${why}). Tentando de novo em 1 minuto.`, true);
  }
}

function coinById(id) {
  return state.markets.find((c) => c.id === id);
}

function renderMarket() {
  const body = $("#market-body");
  body.replaceChildren();
  const list = state.showAll ? state.markets : state.markets.slice(0, 10);
  for (const c of list) {
    const tr = el(
      "tr",
      {
        tabindex: "0",
        class: c.id === state.selected ? "sel" : null,
        "aria-label": `${c.name}: ver análise`,
        onclick: () => selectCoin(c.id, true),
        onkeydown: (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            selectCoin(c.id, true);
          }
        },
      },
      el("td", { class: "muted" }, c.market_cap_rank ?? ""),
      el(
        "td",
        null,
        el("div", { class: "coin" }, el("img", { src: c.image, alt: "", loading: "lazy", width: "22", height: "22" }), el("span", null, c.name), el("span", { class: "sym" }, c.symbol))
      ),
      el("td", { class: "num" }, fmtMoney(toCur(c.current_price))),
      el("td", { class: "num" }, pctNode(c.price_change_percentage_24h_in_currency)),
      el("td", { class: "num" }, pctNode(c.price_change_percentage_7d_in_currency)),
      el("td", { class: "num" }, pctNode(c.price_change_percentage_30d_in_currency)),
      el("td", { class: "num hide-sm" }, fmtMoney(toCur(c.market_cap), state.cur, { compact: true }))
    );
    body.append(tr);
  }
  $("#more").textContent = state.showAll ? "Mostrar só top 10" : "Mostrar top 20";
}

function fillSelects() {
  for (const sel of [$("#coin-select"), $("#wallet-form [name=coin]"), $("#alert-form [name=coin]")]) {
    const keep = sel.value || (sel.id === "coin-select" ? state.selected : "");
    sel.replaceChildren(...state.markets.map((c) => el("option", { value: c.id }, `${c.name} (${c.symbol.toUpperCase()})`)));
    if (keep && coinById(keep)) sel.value = keep;
  }
}

function selectCoin(id, scroll) {
  state.selected = id;
  save("cripto.selected", id);
  $("#coin-select").value = id;
  renderMarket();
  loadAnalysis();
  if (scroll) $("#h-analysis").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------- análise ----------

async function getHistory(id, cur) {
  const key = `${id}|${cur}`;
  const hit = chartCache.get(key);
  if (hit && Date.now() - hit.t < CHART_TTL_MS) return hit.data;
  const data = await getJSON(`${API}/coins/${encodeURIComponent(id)}/market_chart?vs_currency=${cur}&days=365&interval=daily`);
  // um ponto por dia: o último dia pode vir duplicado (fecho + preço atual)
  const byDay = new Map();
  for (const [t, p] of data.prices) byDay.set(new Date(t).toISOString().slice(0, 10), [t, p]);
  const prices = [...byDay.values()].filter((p) => p[1] != null);
  chartCache.set(key, { t: Date.now(), data: prices });
  return prices;
}

function sma(values, n) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

function rsi(values, n = 14) {
  const out = new Array(values.length).fill(null);
  if (values.length <= n) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= n;
  loss /= n;
  out[n] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = n + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

function normCdf(x) {
  // Abramowitz-Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

function analyze(prices, horizon) {
  const closes = prices.map((p) => p[1]);
  const n = closes.length;
  const s7 = sma(closes, 7);
  const s30 = sma(closes, 30);
  const r = rsi(closes, 14);

  const rets = [];
  for (let i = Math.max(1, n - 90); i < n; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sigma = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rets.length - 1));

  // inclinação (por dia) do log-preço nos últimos 30 dias, reduzida a metade
  const m = Math.min(30, n);
  const ys = closes.slice(n - m).map(Math.log);
  const xm = (m - 1) / 2;
  const ym = ys.reduce((a, b) => a + b, 0) / m;
  let num = 0;
  let den = 0;
  ys.forEach((y, i) => {
    num += (i - xm) * (y - ym);
    den += (i - xm) ** 2;
  });
  const mu = den ? (0.5 * num) / den : 0;

  const p0 = closes[n - 1];
  const t0 = prices[n - 1][0];
  const forecast = [];
  for (let t = 0; t <= horizon; t++) {
    const spread = Z80 * sigma * Math.sqrt(t);
    forecast.push({
      t: t0 + t * 86400000,
      mid: p0 * Math.exp(mu * t),
      lo: p0 * Math.exp(mu * t - spread),
      hi: p0 * Math.exp(mu * t + spread),
    });
  }
  const probUp = sigma > 0 ? normCdf((mu * Math.sqrt(horizon)) / sigma) : 0.5;

  const lastRsi = r[n - 1];
  const ret30 = n > 30 ? closes[n - 1] / closes[n - 31] - 1 : null;
  let score = 0;
  const reasons = [];
  if (s30[n - 1] != null) {
    if (p0 > s30[n - 1]) { score++; reasons.push("preço acima da média de 30 dias"); }
    else { score--; reasons.push("preço abaixo da média de 30 dias"); }
  }
  if (s7[n - 1] != null && s30[n - 1] != null) {
    if (s7[n - 1] > s30[n - 1]) { score++; reasons.push("média de 7 dias acima da de 30"); }
    else { score--; reasons.push("média de 7 dias abaixo da de 30"); }
  }
  if (ret30 != null) {
    if (ret30 > 0) { score++; reasons.push("subiu nos últimos 30 dias"); }
    else { score--; reasons.push("caiu nos últimos 30 dias"); }
  }
  if (lastRsi != null && lastRsi > 70) { score--; reasons.push("RSI sobrecomprado (acima de 70)"); }
  if (lastRsi != null && lastRsi < 30) { score++; reasons.push("RSI sobrevendido (abaixo de 30)"); }
  const trend = score >= 2 ? "alta" : score <= -2 ? "baixa" : "neutra";

  return { closes, s7, s30, rsi: r, sigma, mu, p0, forecast, probUp, lastRsi, trend, reasons, stable: sigma < 0.003 };
}

async function loadAnalysis() {
  const id = state.selected;
  if (!coinById(id) && state.markets.length) {
    state.selected = state.markets[0].id;
    return loadAnalysis();
  }
  state.analysisLoaded = true;
  const token = ++state.analysisToken;
  const cur = state.cur;
  if (!chartCache.has(`${id}|${cur}`)) {
    $("#price-chart").replaceChildren(el("div", { class: "placeholder" }, "Carregando histórico…"));
    $("#rsi-chart").replaceChildren();
  }
  try {
    const prices = await getHistory(id, cur);
    if (token !== state.analysisToken) return;
    state.history = { id, cur, prices };
    renderAnalysis();
  } catch (err) {
    if (token !== state.analysisToken) return;
    state.history = null;
    const why = err.message === "limite" ? "A CoinGecko limitou os pedidos. Espere um minuto e escolha a moeda de novo." : "Não foi possível carregar o histórico.";
    $("#price-chart").replaceChildren(el("div", { class: "placeholder" }, why));
    $("#rsi-chart").replaceChildren();
    $("#tiles").replaceChildren();
    $("#signal-text").textContent = "";
    state.analysisLoaded = false;
  }
}

function tile(label, value, note) {
  return el("div", { class: "tile" }, el("div", { class: "label" }, label), el("div", { class: "value" }, value), note ? el("div", { class: "note" }, note) : null);
}

function renderAnalysis() {
  const h = state.history;
  if (!h || h.prices.length < 35) return;
  const a = analyze(h.prices, state.horizon);
  const coin = coinById(h.id);
  const name = coin ? coin.name : h.id;
  const end = a.forecast[a.forecast.length - 1];

  const trendNode = el(
    "span",
    { class: "badge " + (a.trend === "alta" ? "up" : a.trend === "baixa" ? "down" : "") },
    a.trend === "alta" ? "▲ Alta" : a.trend === "baixa" ? "▼ Baixa" : "● Neutra"
  );
  const rsiLabel = a.lastRsi == null ? "" : a.lastRsi > 70 ? "sobrecomprado" : a.lastRsi < 30 ? "sobrevendido" : "zona neutra";

  $("#tiles").replaceChildren(
    tile("Preço atual", fmtMoney(a.p0, h.cur), name),
    tile("Tendência", trendNode, "médias, RSI e 30 dias"),
    tile(`Previsão em ${state.horizon} dias`, fmtMoney(end.mid, h.cur), `faixa: ${fmtMoney(end.lo, h.cur)} – ${fmtMoney(end.hi, h.cur)}`),
    tile("Chance de estar mais alto", fmtNum(a.probUp * 100, 0) + "%", `em ${state.horizon} dias, pelo modelo`),
    tile("RSI (14)", fmtNum(a.lastRsi, 0), rsiLabel),
    tile("Volatilidade anual", fmtNum(a.sigma * Math.sqrt(365) * 100, 0) + "%", "quanto o preço costuma oscilar")
  );

  $("#signal-text").textContent = a.stable
    ? `${name} é uma moeda estável: o preço quase não varia, por isso a previsão não diz muito.`
    : `Tendência ${a.trend}: ${a.reasons.join("; ")}.`;

  drawPriceChart(h, a);
  drawRsiChart(h, a);
}

// ---------- gráficos ----------

function niceTicks(min, max, count) {
  const span = max - min || Math.abs(max) || 1;
  const raw = span / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) || raw;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(v);
  return ticks;
}

function pathFrom(points) {
  let d = "";
  let pen = false;
  for (const [x, y] of points) {
    if (y == null || !isFinite(y)) { pen = false; continue; }
    d += (pen ? "L" : "M") + x.toFixed(1) + "," + y.toFixed(1);
    pen = true;
  }
  return d;
}

function showTooltip(x, y, date, rows) {
  const tip = $("#tooltip");
  tip.replaceChildren(
    el("div", { class: "t-date" }, date),
    ...rows.map(([label, value, key]) =>
      el("div", { class: "t-row" },
        el("span", null, key ? el("i", { class: "key " + key }) : null, label),
        el("b", null, value)))
  );
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  let left = x + 14;
  if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
  let top = y - r.height - 12;
  if (top < 8) top = y + 16;
  tip.style.left = Math.max(8, left) + "px";
  tip.style.top = top + "px";
}
function hideTooltip() {
  $("#tooltip").hidden = true;
}

function attachHover(root, layer, W, M, xs, onIndex) {
  // índice mais próximo do ponteiro; também funciona com as setas do teclado
  let idx = xs.length - 1;
  const pick = (clientX) => {
    const box = root.getBoundingClientRect();
    const px = ((clientX - box.left) / box.width) * W;
    let best = 0;
    for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - px) < Math.abs(xs[best] - px)) best = i;
    return best;
  };
  layer.addEventListener("pointermove", (e) => {
    idx = pick(e.clientX);
    onIndex(idx, e.clientX, e.clientY);
  });
  layer.addEventListener("pointerleave", () => onIndex(-1));
  root.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    idx = Math.min(xs.length - 1, Math.max(0, idx + (e.key === "ArrowRight" ? 1 : -1)));
    const box = root.getBoundingClientRect();
    onIndex(idx, box.left + (xs[idx] / W) * box.width, box.top + 20);
  });
  root.addEventListener("blur", () => onIndex(-1));
}

function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function drawPriceChart(h, a) {
  const box = $("#price-chart");
  const W = Math.max(280, box.clientWidth);
  const H = box.clientHeight || 300;
  const M = { l: 8, r: 72, t: 12, b: 24 };
  const n = h.prices.length;
  const start = Math.max(0, n - state.days);
  const hist = h.prices.slice(start);
  const fc = a.forecast; // fc[0] coincide com o último ponto
  const total = hist.length - 1 + state.horizon;
  const x = (i) => M.l + (i / total) * (W - M.l - M.r);

  const vals = [];
  for (let i = start; i < n; i++) vals.push(a.closes[i], a.s7[i], a.s30[i]);
  for (const f of fc) vals.push(f.lo, f.hi);
  const clean = vals.filter((v) => v != null && isFinite(v));
  let lo = Math.min(...clean);
  let hi = Math.max(...clean);
  const pad = (hi - lo) * 0.06 || hi * 0.01;
  lo -= pad;
  hi += pad;
  const y = (v) => M.t + (1 - (v - lo) / (hi - lo)) * (H - M.t - M.b);

  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Gráfico de preço com previsão de ${state.horizon} dias` });
  for (const t of niceTicks(lo, hi, 4)) {
    if (t < lo || t > hi) continue;
    root.append(svg("line", { class: "gridline", x1: M.l, x2: W - M.r, y1: y(t), y2: y(t) }));
    const lab = svg("text", { class: "axis", x: W - M.r + 6, y: y(t) + 4 });
    lab.textContent = fmtMoney(t, h.cur, { compact: t >= 10000 });
    root.append(lab);
  }
  const labelEvery = Math.max(1, Math.round(total / (W < 500 ? 3 : 5)));
  for (let i = 0; i <= total; i += labelEvery) {
    const t = i < hist.length ? hist[i][0] : fc[i - hist.length + 1].t;
    const lab = svg("text", { class: "axis", x: x(i), y: H - 6, "text-anchor": i === 0 ? "start" : "middle" });
    lab.textContent = fmtDate(t);
    root.append(lab);
  }

  const today = hist.length - 1;
  root.append(svg("line", { x1: x(today), x2: x(today), y1: M.t, y2: H - M.b, stroke: css("--muted"), "stroke-width": 1, "stroke-dasharray": "2 3" }));
  const hoje = svg("text", { class: "axis", x: x(today) + 4, y: M.t + 10 });
  hoje.textContent = "hoje";
  root.append(hoje);

  const upper = fc.map((f, k) => `${x(today + k).toFixed(1)},${y(f.hi).toFixed(1)}`);
  const lower = fc.map((f, k) => `${x(today + k).toFixed(1)},${y(f.lo).toFixed(1)}`).reverse();
  root.append(svg("polygon", { points: upper.concat(lower).join(" "), fill: css("--band") }));

  const line = (arr, color, width, extra) =>
    svg("path", Object.assign({ d: pathFrom(arr), fill: "none", stroke: color, "stroke-width": width, "stroke-linejoin": "round", "stroke-linecap": "round" }, extra || {}));
  root.append(line(hist.map((_, i) => [x(i), a.s30[start + i] == null ? null : y(a.s30[start + i])]), css("--s3"), 1.5));
  root.append(line(hist.map((_, i) => [x(i), a.s7[start + i] == null ? null : y(a.s7[start + i])]), css("--s2"), 1.5));
  root.append(line(hist.map((p, i) => [x(i), y(p[1])]), css("--s1"), 2));
  root.append(line(fc.map((f, k) => [x(today + k), y(f.mid)]), css("--s1"), 2, { "stroke-dasharray": "5 4" }));

  // rótulo direto no fim da previsão
  const endLab = svg("text", { class: "axis", x: x(total) - 4, y: y(fc[fc.length - 1].hi) - 6, "text-anchor": "end" });
  endLab.textContent = "previsão";
  root.append(endLab);

  const cross = svg("line", { y1: M.t, y2: H - M.b, stroke: css("--text-2"), "stroke-width": 1, visibility: "hidden" });
  const dot = svg("circle", { r: 4.5, fill: css("--s1"), stroke: css("--surface"), "stroke-width": 2, visibility: "hidden" });
  root.append(cross, dot);
  const layer = svg("rect", { x: 0, y: 0, width: W, height: H, fill: "transparent" });
  root.append(layer);

  const xs = [];
  for (let i = 0; i <= total; i++) xs.push(x(i));
  box.replaceChildren(root);
  box.tabIndex = 0;
  box.setAttribute("aria-label", "Gráfico de preço. Use as setas para percorrer os dias.");
  attachHover(box, layer, W, M, xs, (i, cx, cy) => {
    if (i < 0) {
      cross.setAttribute("visibility", "hidden");
      dot.setAttribute("visibility", "hidden");
      hideTooltip();
      return;
    }
    cross.setAttribute("x1", xs[i]);
    cross.setAttribute("x2", xs[i]);
    cross.setAttribute("visibility", "visible");
    let rows;
    let t;
    let py;
    if (i <= today) {
      const g = start + i;
      t = hist[i][0];
      py = hist[i][1];
      rows = [["Preço", fmtMoney(py, h.cur), "line s1"], ["Média 7d", fmtMoney(a.s7[g], h.cur), "line s2"], ["Média 30d", fmtMoney(a.s30[g], h.cur), "line s3"]];
    } else {
      const f = fc[i - today];
      t = f.t;
      py = f.mid;
      rows = [["Projeção", fmtMoney(f.mid, h.cur), "dash"], ["Faixa 80%", `${fmtMoney(f.lo, h.cur)} – ${fmtMoney(f.hi, h.cur)}`, "band"]];
    }
    dot.setAttribute("cx", xs[i]);
    dot.setAttribute("cy", y(py));
    dot.setAttribute("visibility", "visible");
    showTooltip(cx, cy, fmtDate(t, true) + (i > today ? " (previsão)" : ""), rows);
  });
}

function drawRsiChart(h, a) {
  const box = $("#rsi-chart");
  const W = Math.max(280, box.clientWidth);
  const H = box.clientHeight || 110;
  const M = { l: 8, r: 72, t: 6, b: 8 };
  const n = h.prices.length;
  const start = Math.max(0, n - state.days);
  const hist = h.prices.slice(start);
  const total = hist.length - 1 + state.horizon;
  const x = (i) => M.l + (i / total) * (W - M.l - M.r);
  const y = (v) => M.t + (1 - v / 100) * (H - M.t - M.b);

  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Gráfico do RSI de 14 dias" });
  for (const t of [30, 50, 70]) {
    root.append(svg("line", { class: "gridline", x1: M.l, x2: x(hist.length - 1), y1: y(t), y2: y(t), "stroke-dasharray": t === 50 ? "" : "3 3" }));
    const lab = svg("text", { class: "axis", x: W - M.r + 6, y: y(t) + 4 });
    lab.textContent = t;
    root.append(lab);
  }
  root.append(svg("path", { d: pathFrom(hist.map((_, i) => [x(i), a.rsi[start + i] == null ? null : y(a.rsi[start + i])])), fill: "none", stroke: css("--s1"), "stroke-width": 1.5 }));
  const cross = svg("line", { y1: M.t, y2: H - M.b, stroke: css("--text-2"), "stroke-width": 1, visibility: "hidden" });
  root.append(cross);
  const layer = svg("rect", { x: 0, y: 0, width: W, height: H, fill: "transparent" });
  root.append(layer);
  const xs = hist.map((_, i) => x(i));
  box.replaceChildren(root);
  attachHover(box, layer, W, M, xs, (i, cx, cy) => {
    if (i < 0) {
      cross.setAttribute("visibility", "hidden");
      hideTooltip();
      return;
    }
    cross.setAttribute("x1", xs[i]);
    cross.setAttribute("x2", xs[i]);
    cross.setAttribute("visibility", "visible");
    const v = a.rsi[start + i];
    showTooltip(cx, cy, fmtDate(hist[i][0], true), [["RSI", fmtNum(v, 0), "line s1"]]);
  });
}

// ---------- carteira ----------

function renderWallet() {
  const body = $("#wallet-body");
  body.replaceChildren();
  $("#wallet-empty").hidden = state.wallet.length > 0;
  let total = 0;
  let invested = 0;
  let investedValue = 0;
  let change24 = 0;
  state.wallet.forEach((w, idx) => {
    const c = coinById(w.id);
    const price = c ? toCur(c.current_price) : null;
    const value = price != null ? price * w.qty : null;
    const costNow = w.cost != null ? convert(w.cost, w.cur, state.cur) : null;
    const paid = costNow != null ? costNow * w.qty : null;
    if (value != null) {
      total += value;
      const p = c.price_change_percentage_24h_in_currency;
      if (p != null) change24 += value - value / (1 + p / 100);
      if (paid != null) {
        invested += paid;
        investedValue += value;
      }
    }
    const result = value != null && paid != null ? value - paid : null;
    body.append(
      el("tr", null,
        el("td", null, el("div", { class: "coin" }, c ? el("img", { src: c.image, alt: "", width: "22", height: "22" }) : null, el("span", null, c ? c.name : w.id))),
        el("td", { class: "num" }, fmtNum(w.qty, 8)),
        el("td", { class: "num" }, value != null ? fmtMoney(value) : el("span", { class: "muted" }, "fora do top 20")),
        el("td", { class: "num" }, result == null ? el("span", { class: "muted" }, "—") :
          el("span", null, el("span", { class: result >= 0 ? "up" : "down" }, (result >= 0 ? "+" : "") + fmtMoney(result)), " ", pctNode((result / paid) * 100))),
        el("td", { class: "num" }, el("button", { type: "button", class: "remove", "aria-label": `Remover ${c ? c.name : w.id}`, onclick: () => removeWallet(idx) }, "✕"))
      )
    );
  });
  const tiles = $("#wallet-tiles");
  if (!state.wallet.length) {
    tiles.replaceChildren();
    return;
  }
  const res = investedValue - invested;
  tiles.replaceChildren(
    tile("Valor total", fmtMoney(total)),
    tile("Variação em 24h", el("span", { class: change24 >= 0 ? "up" : "down" }, (change24 >= 0 ? "▲ " : "▼ ") + fmtMoney(Math.abs(change24)))),
    invested > 0 ? tile("Investido", fmtMoney(invested), "nas moedas com preço pago") : null,
    invested > 0 ? tile("Resultado", el("span", { class: res >= 0 ? "up" : "down" }, (res >= 0 ? "+" : "") + fmtMoney(res)), fmtNum((res / invested) * 100, 1) + "%") : null
  );
}

function removeWallet(idx) {
  state.wallet.splice(idx, 1);
  save("cripto.wallet", state.wallet);
  renderWallet();
}

$("#wallet-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target;
  const id = f.coin.value;
  const qty = parseFloat(f.qty.value);
  const cost = f.cost.value === "" ? null : parseFloat(f.cost.value);
  if (!id || !(qty > 0)) return;
  const existing = state.wallet.find((w) => w.id === id && w.cur === state.cur);
  if (existing) {
    const both = existing.cost != null && cost != null;
    existing.cost = both ? (existing.cost * existing.qty + cost * qty) / (existing.qty + qty) : existing.cost ?? cost;
    existing.qty += qty;
  } else {
    state.wallet.push({ id, qty, cost, cur: state.cur });
  }
  save("cripto.wallet", state.wallet);
  f.qty.value = "";
  f.cost.value = "";
  renderWallet();
});

// ---------- alertas ----------

function renderAlerts() {
  const list = $("#alert-list");
  list.replaceChildren();
  $("#alert-empty").hidden = state.alerts.length > 0;
  for (const al of state.alerts) {
    const c = coinById(al.id);
    const name = c ? c.name : al.id;
    const now = c ? convert(c.current_price, "usd", al.cur) : null;
    list.append(
      el("li", { class: al.firedAt ? "done" : null },
        el("div", null,
          el("div", null, `${name} ${al.dir === "above" ? "acima de" : "abaixo de"} ${fmtMoney(al.price, al.cur)}`),
          el("div", { class: "state" }, al.firedAt
            ? `Disparou em ${new Date(al.firedAt).toLocaleString("pt-BR")}`
            : now != null ? `Ativo · agora ${fmtMoney(now, al.cur)}` : "Ativo")),
        el("button", { type: "button", class: "remove", "aria-label": `Remover alerta de ${name}`, onclick: () => removeAlert(al.key) }, "✕"))
    );
  }
}

function removeAlert(key) {
  state.alerts = state.alerts.filter((a) => a.key !== key);
  save("cripto.alerts", state.alerts);
  renderAlerts();
}

function checkAlerts() {
  let changed = false;
  for (const al of state.alerts) {
    if (al.firedAt) continue;
    const c = coinById(al.id);
    if (!c) continue;
    const now = convert(c.current_price, "usd", al.cur);
    if (now == null) continue;
    const hit = al.dir === "above" ? now >= al.price : now <= al.price;
    if (!hit) continue;
    al.firedAt = Date.now();
    changed = true;
    const msg = `${c.name} ${al.dir === "above" ? "subiu acima de" : "caiu abaixo de"} ${fmtMoney(al.price, al.cur)} — agora ${fmtMoney(now, al.cur)}`;
    toast("🔔 " + msg);
    try {
      if ("Notification" in window && Notification.permission === "granted") new Notification("Alerta de preço", { body: msg, icon: "icons/icon-180.png" });
    } catch {
      /* alguns navegadores móveis só notificam via service worker */
    }
  }
  if (changed) save("cripto.alerts", state.alerts);
}

$("#alert-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target;
  const price = parseFloat(f.price.value);
  if (!f.coin.value || !(price > 0)) return;
  state.alerts.push({ key: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), id: f.coin.value, dir: f.dir.value, price, cur: state.cur, firedAt: null });
  save("cripto.alerts", state.alerts);
  f.price.value = "";
  try {
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
  } catch {
    /* sem notificações: fica só o aviso na página */
  }
  checkAlerts();
  renderAlerts();
});

// ---------- controles ----------

function pressSeg(group, btn) {
  for (const b of group.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b === btn));
}

for (const b of document.querySelectorAll("[data-cur]")) {
  b.setAttribute("aria-pressed", String(b.dataset.cur === state.cur));
  b.addEventListener("click", () => {
    if (state.cur === b.dataset.cur) return;
    state.cur = b.dataset.cur;
    save("cripto.cur", state.cur);
    pressSeg(b.parentElement, b);
    renderMarket();
    renderWallet();
    loadAnalysis();
  });
}
$("#range").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  state.days = Number(b.dataset.days);
  pressSeg($("#range"), b);
  renderAnalysis();
});
$("#horizon").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  state.horizon = Number(b.dataset.h);
  pressSeg($("#horizon"), b);
  renderAnalysis();
});
$("#coin-select").addEventListener("change", (e) => selectCoin(e.target.value, false));
$("#more").addEventListener("click", () => {
  state.showAll = !state.showAll;
  renderMarket();
});
$("#refresh").addEventListener("click", () => {
  setStatus("Atualizando…");
  chartCache.clear();
  state.analysisLoaded = false;
  loadMarkets();
});

let resizeTimer;
new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderAnalysis, 120);
}).observe($("#price-chart"));

renderWallet();
renderAlerts();
loadMarkets();
setInterval(loadMarkets, REFRESH_MS);
