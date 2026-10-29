"use strict";

// Cripto — mercado ao vivo, análise com previsão estatística, carteira, alertas e conversor.
// Dados: API pública da CoinGecko (sem chave) e índice Medo & Ganância da Alternative.me.
// Carteira, alertas, favoritas e preferências ficam no localStorage.

const API = "https://api.coingecko.com/api/v3";
const FNG_API = "https://api.alternative.me/fng/?limit=2";
const REFRESH_MS = 60 * 1000;
const CHART_TTL_MS = 5 * 60 * 1000;
const FNG_TTL_MS = 15 * 60 * 1000;
const Z80 = 1.2816; // quantil para faixa de 80%
const PAGE = 15;

const CURS = {
  brl: { code: "BRL", label: "R$" },
  usd: { code: "USD", label: "US$" },
  eur: { code: "EUR", label: "€" },
};

const state = {
  cur: CURS[load("cripto.cur", "brl")] ? load("cripto.cur", "brl") : "brl",
  theme: load("cripto.theme", "auto"),
  rates: null, // unidades de cada moeda por 1 dólar
  markets: [], // preços em USD
  global: null,
  fng: null,
  fngAt: 0,
  filter: "all",
  query: "",
  limit: PAGE,
  favs: load("cripto.favs", ["bitcoin", "ethereum", "solana"]),
  selected: load("cripto.selected", "bitcoin"),
  days: 90,
  horizon: 14,
  wallet: load("cripto.wallet", []),
  alerts: load("cripto.alerts", []),
  history: null,
  analysisLoaded: false,
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

// estilos dinâmicos via CSSOM (a política de segurança bloqueia o atributo style)
function styled(node, props) {
  Object.assign(node.style, props);
  return node;
}

function toCur(usd, cur = state.cur) {
  if (usd == null || !state.rates) return null;
  return usd * state.rates[cur];
}
function convert(value, from, to) {
  if (value == null) return null;
  if (from === to) return value;
  if (!state.rates || !state.rates[from] || !state.rates[to]) return null;
  return (value / state.rates[from]) * state.rates[to];
}

function fmtMoney(v, cur = state.cur, opts = {}) {
  if (v == null || !isFinite(v)) return "—";
  const abs = Math.abs(v);
  const o = { style: "currency", currency: CURS[cur].code };
  if (opts.compact) Object.assign(o, { notation: "compact", maximumFractionDigits: 2 });
  else if (abs >= 1 || abs === 0) Object.assign(o, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  else Object.assign(o, { minimumSignificantDigits: 2, maximumSignificantDigits: 4 });
  return new Intl.NumberFormat("pt-BR", o).format(v);
}
function fmtNum(v, digits = 2) {
  if (v == null || !isFinite(v)) return "—";
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(v);
}
function pctText(p, digits = 2) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(Math.abs(p)) + "%";
}
function pctNode(p, pill) {
  if (p == null || !isFinite(p)) return el("span", { class: "muted" }, "—");
  const up = p >= 0;
  return el("span", { class: (pill ? "pill " : "") + (up ? "up" : "down") }, (up ? "▲ " : "▼ ") + pctText(p));
}
function signedMoney(v, cur) {
  if (v == null || !isFinite(v)) return el("span", { class: "muted" }, "—");
  return el("span", { class: v >= 0 ? "up" : "down" }, (v >= 0 ? "+" : "−") + fmtMoney(Math.abs(v), cur));
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

function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function coinById(id) {
  return state.markets.find((c) => c.id === id);
}
function coinImg(c, size) {
  return el("img", { src: c.image, alt: "", loading: "lazy", width: String(size), height: String(size) });
}

// ---------- carregamento ----------

async function loadMarkets() {
  const wantFng = Date.now() - state.fngAt > FNG_TTL_MS;
  try {
    const [markets, rates, global, fng] = await Promise.all([
      getJSON(`${API}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1&sparkline=true&price_change_percentage=24h,7d,30d`),
      getJSON(`${API}/exchange_rates`),
      getJSON(`${API}/global`).catch(() => null),
      wantFng ? getJSON(FNG_API).catch(() => null) : Promise.resolve(null),
    ]);
    const usd = rates.rates.usd.value;
    state.rates = { usd: 1, brl: rates.rates.brl.value / usd, eur: rates.rates.eur.value / usd };
    state.markets = markets;
    if (global && global.data) state.global = global.data;
    if (fng && fng.data && fng.data.length) {
      state.fng = fng.data;
      state.fngAt = Date.now();
    }
    setStatus(`Atualizado às ${new Date().toLocaleTimeString("pt-BR")} · atualiza sozinho a cada minuto`);
    renderAll();
    checkAlerts();
    renderAlerts();
    if (!state.analysisLoaded) loadAnalysis();
  } catch (err) {
    const why = err.message === "limite" ? "a CoinGecko limitou os pedidos" : "sem conexão com os dados";
    setStatus(`Não foi possível atualizar (${why}). Tentando de novo em 1 minuto.`, true);
    if (!state.markets.length) $("#overview").replaceChildren();
  }
}

function renderAll() {
  renderOverview();
  renderMarket();
  fillSelects();
  renderCoinHero();
  renderWallet();
  renderConverter();
  renderCurLabels();
}

function renderCurLabels() {
  for (const n of document.querySelectorAll("[data-cur-label]")) n.textContent = `(${CURS[state.cur].label})`;
}

// ---------- visão geral ----------

function stat(label, value, note, extra) {
  return el("div", { class: "stat" }, el("div", { class: "label" }, label), el("div", { class: "value" }, value), note ? el("div", { class: "note" }, note) : null, extra || null);
}

const FNG_PT = {
  "Extreme Fear": "Medo extremo",
  Fear: "Medo",
  Neutral: "Neutro",
  Greed: "Ganância",
  "Extreme Greed": "Ganância extrema",
};

function renderOverview() {
  const box = $("#overview");
  const g = state.global;
  const items = [];
  if (g) {
    const mcap = toCur(g.total_market_cap.usd);
    items.push(stat("Valor total do mercado", fmtMoney(mcap, state.cur, { compact: true }), el("span", null, pctNode(g.market_cap_change_percentage_24h_usd, true), " em 24h")));
    items.push(stat("Volume em 24h", fmtMoney(toCur(g.total_volume.usd), state.cur, { compact: true }), `${fmtNum(g.active_cryptocurrencies, 0)} moedas ativas`));
    const btc = g.market_cap_percentage.btc;
    const eth = g.market_cap_percentage.eth;
    const bar = el("div", { class: "dom-bar", "aria-hidden": "true" },
      styled(el("span"), { width: btc + "%", background: "var(--c4)" }),
      styled(el("span"), { width: eth + "%", background: "var(--c7)" }),
      styled(el("span"), { flex: "1", background: "var(--other)" }));
    items.push(stat("Dominância do Bitcoin", fmtNum(btc, 1) + "%", `Ethereum ${fmtNum(eth, 1)}% · outras ${fmtNum(100 - btc - eth, 1)}%`, bar));
  } else {
    // sem /global: soma do top 50 como aproximação
    const total = state.markets.reduce((a, c) => a + (c.market_cap || 0), 0);
    if (total) items.push(stat("Valor do top 50", fmtMoney(toCur(total), state.cur, { compact: true }), "soma das 50 maiores"));
  }
  if (state.fng) {
    const now = state.fng[0];
    const prev = state.fng[1];
    const v = Number(now.value);
    const meter = el("div", { class: "meter", "aria-hidden": "true" }, styled(el("i"), { left: v + "%" }));
    const delta = prev ? v - Number(prev.value) : null;
    items.push(stat("Medo & Ganância", `${v} · ${FNG_PT[now.value_classification] || now.value_classification}`,
      delta == null ? "0 = medo extremo, 100 = ganância extrema" : `ontem ${prev.value} (${delta >= 0 ? "+" : ""}${delta})`, meter));
  }
  if (!items.length) return;
  box.replaceChildren(...items);
}

// ---------- mercado ----------

function filteredMarkets() {
  const q = state.query.trim().toLowerCase();
  return state.markets.filter((c) => {
    if (state.filter === "fav" && !state.favs.includes(c.id)) return false;
    if (q && !c.name.toLowerCase().includes(q) && !c.symbol.toLowerCase().includes(q)) return false;
    return true;
  });
}

function sparkline(c) {
  const pts = (c.sparkline_in_7d && c.sparkline_in_7d.price) || [];
  const W = 110;
  const H = 34;
  const root = svg("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: "spark", "aria-hidden": "true" });
  if (pts.length < 2) return root;
  const step = Math.max(1, Math.floor(pts.length / 56));
  const s = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  const lo = Math.min(...s);
  const hi = Math.max(...s);
  const d = s.map((p, i) => `${i ? "L" : "M"}${((i / (s.length - 1)) * W).toFixed(1)},${(2 + (1 - (p - lo) / (hi - lo || 1)) * (H - 4)).toFixed(1)}`).join("");
  const up = s[s.length - 1] >= s[0];
  root.append(svg("path", { d, fill: "none", stroke: css(up ? "--up" : "--down"), "stroke-width": 1.5, "stroke-linejoin": "round" }));
  return root;
}

function toggleFav(id) {
  const i = state.favs.indexOf(id);
  if (i >= 0) state.favs.splice(i, 1);
  else state.favs.push(id);
  save("cripto.favs", state.favs);
  renderMarket();
}

function renderMarket() {
  const body = $("#market-body");
  const all = filteredMarkets();
  const list = all.slice(0, state.limit);
  body.replaceChildren(
    ...list.map((c) => {
      const fav = state.favs.includes(c.id);
      return el(
        "tr",
        {
          tabindex: "0",
          class: c.id === state.selected ? "sel" : null,
          "aria-label": `${c.name}: ver análise`,
          onclick: () => selectCoin(c.id, true),
          onkeydown: (e) => {
            if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              selectCoin(c.id, true);
            }
          },
        },
        el("td", null, el("button", {
          type: "button", class: "star", "aria-pressed": String(fav), "aria-label": fav ? `Tirar ${c.name} das favoritas` : `Marcar ${c.name} como favorita`,
          onclick: (e) => { e.stopPropagation(); toggleFav(c.id); },
        }, fav ? "★" : "☆")),
        el("td", { class: "muted" }, c.market_cap_rank ?? ""),
        el("td", null, el("div", { class: "coin" }, coinImg(c, 26), el("span", { class: "name" }, c.name), el("span", { class: "sym" }, c.symbol))),
        el("td", { class: "num" }, el("b", null, fmtMoney(toCur(c.current_price)))),
        el("td", { class: "num" }, pctNode(c.price_change_percentage_24h_in_currency, true)),
        el("td", { class: "num hide-sm" }, pctNode(c.price_change_percentage_7d_in_currency)),
        el("td", { class: "num hide-sm" }, pctNode(c.price_change_percentage_30d_in_currency)),
        el("td", { class: "num hide-md" }, fmtMoney(toCur(c.market_cap), state.cur, { compact: true })),
        el("td", { class: "num hide-sm" }, sparkline(c))
      );
    })
  );
  const empty = $("#market-empty");
  empty.hidden = all.length > 0;
  empty.textContent = state.filter === "fav" && !state.query ? "Nenhuma favorita ainda. Toque na estrela ☆ ao lado de uma moeda." : "Nenhuma moeda encontrada no top 50.";
  const more = $("#more");
  more.hidden = all.length <= PAGE;
  more.textContent = all.length > state.limit ? `Mostrar mais (${all.length - state.limit})` : "Mostrar menos";
}

function fillSelects() {
  const opts = () => state.markets.map((c) => el("option", { value: c.id }, `${c.name} (${c.symbol.toUpperCase()})`));
  for (const sel of [$("#coin-select"), $("#wallet-form [name=coin]"), $("#alert-form [name=coin]"), $("#conv-coin")]) {
    const keep = sel.value || (sel.id === "coin-select" ? state.selected : "");
    sel.replaceChildren(...opts());
    if (keep && coinById(keep)) sel.value = keep;
  }
}

function selectCoin(id, scroll) {
  state.selected = id;
  save("cripto.selected", id);
  $("#coin-select").value = id;
  renderMarket();
  renderCoinHero();
  loadAnalysis();
  if (scroll) $("#analise").scrollIntoView({ block: "start" });
}

// ---------- análise ----------

function renderCoinHero() {
  const c = coinById(state.selected);
  const box = $("#coin-hero");
  if (!c) return box.replaceChildren();
  const fromAth = c.ath_change_percentage;
  box.replaceChildren(
    coinImg(c, 44),
    el("div", null,
      el("div", null, el("span", { class: "ch-name" }, c.name), " ", el("span", { class: "ch-sym" }, c.symbol)),
      el("div", { class: "ch-price" }, fmtMoney(toCur(c.current_price)))),
    el("div", { class: "ch-right" },
      el("span", { class: "chip" }, "24h ", pctNode(c.price_change_percentage_24h_in_currency)),
      el("span", { class: "chip" }, "Máx. 24h ", fmtMoney(toCur(c.high_24h))),
      el("span", { class: "chip" }, "Mín. 24h ", fmtMoney(toCur(c.low_24h))),
      fromAth != null ? el("span", { class: "chip" }, "Recorde ", fmtMoney(toCur(c.ath)), " ", el("span", { class: "muted" }, fromAth < -0.5 ? `(${pctText(fromAth, 0)} abaixo)` : "(no recorde)")) : null)
  );
}

async function getHistory(id, cur) {
  const key = `${id}|${cur}`;
  const hit = chartCache.get(key);
  if (hit && Date.now() - hit.t < CHART_TTL_MS) return hit.data;
  const data = await getJSON(`${API}/coins/${encodeURIComponent(id)}/market_chart?vs_currency=${cur}&days=365&interval=daily`);
  // um ponto por dia: o último dia pode vir duplicado (fecho + preço atual)
  const byDay = new Map();
  for (const [t, p] of data.prices) byDay.set(new Date(t).toISOString().slice(0, 10), [t, p]);
  const prices = [...byDay.values()].filter((p) => p[1] != null && p[1] > 0);
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
  const t = 1 / (1 + (0.3275911 * Math.abs(x)) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

// volatilidade (90 dias) e tendência (metade da inclinação de 30 dias) usando só dados até `end`
function fitModel(closes, end) {
  let sum = 0;
  let cnt = 0;
  const from = Math.max(1, end - 89);
  for (let i = from; i <= end; i++) { sum += Math.log(closes[i] / closes[i - 1]); cnt++; }
  const mean = sum / cnt;
  let sq = 0;
  for (let i = from; i <= end; i++) sq += (Math.log(closes[i] / closes[i - 1]) - mean) ** 2;
  const sigma = Math.sqrt(sq / Math.max(1, cnt - 1));

  const m = Math.min(30, end + 1);
  const xm = (m - 1) / 2;
  let ym = 0;
  for (let i = 0; i < m; i++) ym += Math.log(closes[end - m + 1 + i]);
  ym /= m;
  let num = 0;
  let den = 0;
  for (let i = 0; i < m; i++) {
    num += (i - xm) * (Math.log(closes[end - m + 1 + i]) - ym);
    den += (i - xm) ** 2;
  }
  return { sigma, mu: den ? (0.5 * num) / den : 0 };
}

// refaz a previsão em dias passados e confere com o que aconteceu
function backtest(closes, horizon) {
  const n = closes.length;
  let count = 0;
  let inside = 0;
  let dirCount = 0;
  let dirOk = 0;
  for (let e = n - 1 - horizon; e >= 60 && count < 180; e--) {
    const { sigma, mu } = fitModel(closes, e);
    const spread = Z80 * sigma * Math.sqrt(horizon);
    const lo = closes[e] * Math.exp(mu * horizon - spread);
    const hi = closes[e] * Math.exp(mu * horizon + spread);
    const actual = closes[e + horizon];
    count++;
    if (actual >= lo && actual <= hi) inside++;
    if (mu !== 0) {
      dirCount++;
      if ((actual > closes[e]) === (mu > 0)) dirOk++;
    }
  }
  return count < 20 ? null : { inside: inside / count, dir: dirCount ? dirOk / dirCount : null, count };
}

function analyze(prices, horizon) {
  const closes = prices.map((p) => p[1]);
  const n = closes.length;
  const s7 = sma(closes, 7);
  const s30 = sma(closes, 30);
  const r = rsi(closes, 14);
  const { sigma, mu } = fitModel(closes, n - 1);

  const p0 = closes[n - 1];
  const t0 = prices[n - 1][0];
  const forecast = [];
  for (let t = 0; t <= horizon; t++) {
    const spread = Z80 * sigma * Math.sqrt(t);
    forecast.push({ t: t0 + t * 86400000, mid: p0 * Math.exp(mu * t), lo: p0 * Math.exp(mu * t - spread), hi: p0 * Math.exp(mu * t + spread) });
  }
  const probUp = sigma > 0 ? normCdf((mu * Math.sqrt(horizon)) / sigma) : 0.5;

  const last30 = closes.slice(-30);
  const support = Math.min(...last30);
  const resistance = Math.max(...last30);

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
    if (ret30 > 0) { score++; reasons.push(`subiu ${pctText(ret30 * 100, 1)} em 30 dias`); }
    else { score--; reasons.push(`caiu ${pctText(ret30 * 100, 1)} em 30 dias`); }
  }
  if (lastRsi != null && lastRsi > 70) { score--; reasons.push("RSI sobrecomprado (acima de 70), costuma haver correção"); }
  if (lastRsi != null && lastRsi < 30) { score++; reasons.push("RSI sobrevendido (abaixo de 30), costuma haver repique"); }
  const trend = score >= 2 ? "alta" : score <= -2 ? "baixa" : "neutra";

  return {
    closes, s7, s30, rsi: r, sigma, mu, p0, forecast, probUp, lastRsi, trend, reasons,
    support, resistance, bt: backtest(closes, horizon), stable: sigma < 0.003,
  };
}

async function loadAnalysis() {
  const id = state.selected;
  if (!coinById(id) && state.markets.length) {
    state.selected = state.markets[0].id;
    renderCoinHero();
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
    const why = err.message === "limite" ? "A CoinGecko limitou os pedidos. Tentando de novo na próxima atualização." : "Não foi possível carregar o histórico.";
    $("#price-chart").replaceChildren(el("div", { class: "placeholder" }, why));
    $("#rsi-chart").replaceChildren();
    $("#tiles").replaceChildren();
    $("#signal").replaceChildren();
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
  const H = state.horizon;

  const trendNode = el(
    "span",
    { class: "badge " + (a.trend === "alta" ? "up" : a.trend === "baixa" ? "down" : "") },
    a.trend === "alta" ? "▲ Alta" : a.trend === "baixa" ? "▼ Baixa" : "● Neutra"
  );
  const rsiLabel = a.lastRsi == null ? "" : a.lastRsi > 70 ? "sobrecomprado" : a.lastRsi < 30 ? "sobrevendido" : "zona neutra";
  const midChange = (end.mid / a.p0 - 1) * 100;

  $("#tiles").replaceChildren(
    tile("Tendência", trendNode, "médias, RSI e 30 dias"),
    tile(`Previsão em ${H} dias`, fmtMoney(end.mid, h.cur), el("span", null, pctNode(midChange), ` · faixa ${fmtMoney(end.lo, h.cur)} – ${fmtMoney(end.hi, h.cur)}`)),
    tile("Chance de estar mais alto", fmtNum(a.probUp * 100, 0) + "%", `daqui a ${H} dias, pelo modelo`),
    tile("Acerto histórico", a.bt ? fmtNum(a.bt.inside * 100, 0) + "%" : "—",
      a.bt ? `preço caiu na faixa em ${a.bt.count} testes${a.bt.dir != null ? ` · direção certa ${fmtNum(a.bt.dir * 100, 0)}%` : ""}` : "histórico curto demais"),
    tile("Suporte (30d)", fmtMoney(a.support, h.cur), `${pctText((a.p0 / a.support - 1) * 100, 1)} abaixo do preço`),
    tile("Resistência (30d)", fmtMoney(a.resistance, h.cur), a.resistance > a.p0 ? `${pctText((a.resistance / a.p0 - 1) * 100, 1)} acima do preço` : "preço no topo de 30 dias"),
    tile("RSI (14)", fmtNum(a.lastRsi, 0), rsiLabel),
    tile("Volatilidade anual", fmtNum(a.sigma * Math.sqrt(365) * 100, 0) + "%", "quanto o preço costuma oscilar")
  );

  $("#signal").replaceChildren(
    a.stable
      ? el("span", null, el("b", null, `${name} é uma moeda estável.`), " O preço quase não varia, por isso a previsão não diz muito.")
      : el("span", null, el("b", null, `Tendência ${a.trend}: `), a.reasons.join("; ") + ".")
  );

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
      el("div", { class: "t-row" }, el("span", null, key ? el("i", { class: "key " + key }) : null, label), el("b", null, value)))
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

function attachHover(root, layer, W, xs, onIndex) {
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
  root.onkeydown = (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    idx = Math.min(xs.length - 1, Math.max(0, idx + (e.key === "ArrowRight" ? 1 : -1)));
    const box = root.getBoundingClientRect();
    onIndex(idx, box.left + (xs[idx] / W) * box.width, box.top + 20);
  };
  root.onblur = () => onIndex(-1);
}

function drawPriceChart(h, a) {
  const box = $("#price-chart");
  const W = Math.max(280, box.clientWidth);
  const H = box.clientHeight || 320;
  const M = { l: 4, r: 74, t: 14, b: 24 };
  const n = h.prices.length;
  const start = Math.max(0, n - state.days);
  const hist = h.prices.slice(start);
  const fc = a.forecast; // fc[0] coincide com o último ponto
  const total = hist.length - 1 + state.horizon;
  const x = (i) => M.l + (i / total) * (W - M.l - M.r);

  const vals = [a.support, a.resistance];
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
  const defs = svg("defs");
  const grad = svg("linearGradient", { id: "area", x1: 0, x2: 0, y1: 0, y2: 1 });
  grad.append(svg("stop", { offset: "0%", "stop-color": css("--s1"), "stop-opacity": 0.22 }), svg("stop", { offset: "100%", "stop-color": css("--s1"), "stop-opacity": 0 }));
  defs.append(grad);
  root.append(defs);

  for (const t of niceTicks(lo, hi, 4)) {
    if (t < lo || t > hi) continue;
    root.append(svg("line", { class: "gridline", x1: M.l, x2: W - M.r, y1: y(t), y2: y(t) }));
    const lab = svg("text", { class: "axis", x: W - M.r + 8, y: y(t) + 4 });
    lab.textContent = fmtMoney(t, h.cur, { compact: t >= 10000 });
    root.append(lab);
  }
  const labelEvery = Math.max(1, Math.round(total / (W < 500 ? 3 : 5)));
  for (let i = 0; i <= total - labelEvery / 2; i += labelEvery) {
    const t = i < hist.length ? hist[i][0] : fc[i - hist.length + 1].t;
    const lab = svg("text", { class: "axis", x: x(i), y: H - 6, "text-anchor": i === 0 ? "start" : "middle" });
    lab.textContent = fmtDate(t);
    root.append(lab);
  }

  const today = hist.length - 1;

  // suporte e resistência dos últimos 30 dias
  const levelFrom = x(Math.max(0, today - 29));
  for (const [v, label, dy] of [[a.resistance, "resistência", -5], [a.support, "suporte", 13]]) {
    root.append(svg("line", { x1: levelFrom, x2: x(total), y1: y(v), y2: y(v), stroke: css("--level"), "stroke-width": 1, "stroke-dasharray": "4 4" }));
    const lab = svg("text", { class: "axis", x: levelFrom + 2, y: y(v) + dy });
    lab.textContent = label;
    root.append(lab);
  }

  const upper = fc.map((f, k) => `${x(today + k).toFixed(1)},${y(f.hi).toFixed(1)}`);
  const lower = fc.map((f, k) => `${x(today + k).toFixed(1)},${y(f.lo).toFixed(1)}`).reverse();
  root.append(svg("polygon", { points: upper.concat(lower).join(" "), fill: css("--band") }));

  // área suave sob o preço
  const pricePts = hist.map((p, i) => [x(i), y(p[1])]);
  root.append(svg("path", { d: pathFrom(pricePts) + `L${x(today).toFixed(1)},${H - M.b}L${x(0).toFixed(1)},${H - M.b}Z`, fill: "url(#area)" }));

  const line = (arr, color, width, extra) =>
    svg("path", Object.assign({ d: pathFrom(arr), fill: "none", stroke: color, "stroke-width": width, "stroke-linejoin": "round", "stroke-linecap": "round" }, extra || {}));
  root.append(line(hist.map((_, i) => [x(i), a.s30[start + i] == null ? null : y(a.s30[start + i])]), css("--s3"), 1.5));
  root.append(line(hist.map((_, i) => [x(i), a.s7[start + i] == null ? null : y(a.s7[start + i])]), css("--s2"), 1.5));
  root.append(line(pricePts, css("--s1"), 2));
  root.append(line(fc.map((f, k) => [x(today + k), y(f.mid)]), css("--s1"), 2, { "stroke-dasharray": "5 4" }));

  root.append(svg("line", { x1: x(today), x2: x(today), y1: M.t, y2: H - M.b, stroke: css("--muted"), "stroke-width": 1, "stroke-dasharray": "2 3" }));
  const hoje = svg("text", { class: "axis", x: x(today) + 4, y: M.t - 2 });
  hoje.textContent = "hoje";
  root.append(hoje);
  root.append(svg("circle", { cx: x(today), cy: y(a.p0), r: 4, fill: css("--s1"), stroke: css("--surface-2"), "stroke-width": 2 }));

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
  attachHover(box, layer, W, xs, (i, cx, cy) => {
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
  const H = box.clientHeight || 100;
  const M = { l: 4, r: 74, t: 6, b: 6 };
  const n = h.prices.length;
  const start = Math.max(0, n - state.days);
  const hist = h.prices.slice(start);
  const total = hist.length - 1 + state.horizon;
  const x = (i) => M.l + (i / total) * (W - M.l - M.r);
  const y = (v) => M.t + (1 - v / 100) * (H - M.t - M.b);

  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Gráfico do RSI de 14 dias" });
  root.append(svg("rect", { x: M.l, y: y(70), width: x(hist.length - 1) - M.l, height: y(30) - y(70), fill: css("--band"), opacity: 0.5 }));
  for (const t of [30, 50, 70]) {
    root.append(svg("line", { class: "gridline", x1: M.l, x2: x(hist.length - 1), y1: y(t), y2: y(t), "stroke-dasharray": t === 50 ? "" : "3 3" }));
    const lab = svg("text", { class: "axis", x: W - M.r + 8, y: y(t) + 4 });
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
  attachHover(box, layer, W, xs, (i, cx, cy) => {
    if (i < 0) {
      cross.setAttribute("visibility", "hidden");
      hideTooltip();
      return;
    }
    cross.setAttribute("x1", xs[i]);
    cross.setAttribute("x2", xs[i]);
    cross.setAttribute("visibility", "visible");
    showTooltip(cx, cy, fmtDate(hist[i][0], true), [["RSI", fmtNum(a.rsi[start + i], 0), "line s1"]]);
  });
}

// ---------- carteira ----------

const ALLOC_SLOTS = 7;

function renderWallet() {
  const body = $("#wallet-body");
  $("#wallet-empty").hidden = state.wallet.length > 0;
  let total = 0;
  let invested = 0;
  let investedValue = 0;
  let change24 = 0;
  const parts = [];
  const rows = state.wallet.map((w, idx) => {
    const c = coinById(w.id);
    const price = c ? toCur(c.current_price) : null;
    const value = price != null ? price * w.qty : null;
    const costNow = w.cost != null ? convert(w.cost, w.cur, state.cur) : null;
    const paid = costNow != null ? costNow * w.qty : null;
    if (value != null) {
      total += value;
      parts.push({ idx, name: c.name, value });
      const p = c.price_change_percentage_24h_in_currency;
      if (p != null) change24 += value - value / (1 + p / 100);
      if (paid != null) {
        invested += paid;
        investedValue += value;
      }
    }
    const result = value != null && paid != null ? value - paid : null;
    return el("tr", null,
      el("td", null, el("div", { class: "coin" }, c ? coinImg(c, 24) : null, el("span", { class: "name" }, c ? c.name : w.id))),
      el("td", { class: "num" }, fmtNum(w.qty, 8)),
      el("td", { class: "num" }, value != null ? fmtMoney(value) : el("span", { class: "muted" }, "fora do top 50")),
      el("td", { class: "num" }, result == null ? el("span", { class: "muted" }, "—") : el("span", null, signedMoney(result), " ", pctNode((result / paid) * 100, true))),
      el("td", { class: "num" }, el("button", { type: "button", class: "remove", "aria-label": `Remover ${c ? c.name : w.id}`, onclick: () => removeWallet(idx) }, "✕"))
    );
  });
  body.replaceChildren(...rows);

  const tiles = $("#wallet-tiles");
  if (!state.wallet.length) {
    tiles.replaceChildren();
    $("#alloc").replaceChildren();
    return;
  }
  const res = investedValue - invested;
  const before = total - change24;
  tiles.replaceChildren(
    tile("Valor total", fmtMoney(total)),
    tile("Variação em 24h", signedMoney(change24), before > 0 ? el("span", null, pctNode((change24 / before) * 100)) : null),
    invested > 0 ? tile("Investido", fmtMoney(invested), "nas moedas com preço pago") : null,
    invested > 0 ? tile("Resultado", signedMoney(res), pctNode((res / invested) * 100)) : null
  );
  renderAlloc(parts, total);
}

function renderAlloc(parts, total) {
  const box = $("#alloc");
  if (parts.length < 2 || !(total > 0)) return box.replaceChildren();
  // cor segue a moeda (ordem na carteira), não a posição no ranking
  const named = parts.filter((p) => p.idx < ALLOC_SLOTS);
  const rest = parts.filter((p) => p.idx >= ALLOC_SLOTS).reduce((a, p) => a + p.value, 0);
  const segs = named.map((p) => ({ name: p.name, value: p.value, color: `var(--c${p.idx + 1})` }));
  if (rest > 0) segs.push({ name: "Outras", value: rest, color: "var(--other)" });
  segs.sort((a, b) => b.value - a.value);
  box.replaceChildren(
    el("div", { class: "alloc-bar", role: "img", "aria-label": "Distribuição da carteira: " + segs.map((s) => `${s.name} ${fmtNum((s.value / total) * 100, 1)}%`).join(", ") },
      ...segs.map((s) => styled(el("span", { title: `${s.name}: ${fmtNum((s.value / total) * 100, 1)}%` }), { flex: String(s.value / total), background: s.color }))),
    el("div", { class: "alloc-legend" }, ...segs.map((s) => el("span", null, styled(el("i"), { background: s.color }), s.name, " ", el("b", null, fmtNum((s.value / total) * 100, 1) + "%"))))
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

$("#export").addEventListener("click", () => {
  const data = { app: "cripto", version: 1, savedAt: new Date().toISOString(), wallet: state.wallet, alerts: state.alerts, favs: state.favs };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = el("a", { href: url, download: `cripto-backup-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$("#import").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const wallet = (Array.isArray(data.wallet) ? data.wallet : [])
      .filter((w) => w && typeof w.id === "string" && Number(w.qty) > 0)
      .map((w) => ({ id: w.id, qty: Number(w.qty), cost: w.cost == null || !(Number(w.cost) >= 0) ? null : Number(w.cost), cur: CURS[w.cur] ? w.cur : "usd" }));
    const alerts = (Array.isArray(data.alerts) ? data.alerts : [])
      .filter((a) => a && typeof a.id === "string" && Number(a.price) > 0 && (a.dir === "above" || a.dir === "below"))
      .map((a) => ({ key: String(a.key || Math.random().toString(36).slice(2)), id: a.id, dir: a.dir, price: Number(a.price), cur: CURS[a.cur] ? a.cur : "usd", firedAt: Number(a.firedAt) || null }));
    const favs = (Array.isArray(data.favs) ? data.favs : []).filter((f) => typeof f === "string");
    if (!wallet.length && !alerts.length) throw new Error("vazio");
    if (!confirm(`Restaurar ${wallet.length} moeda(s) e ${alerts.length} alerta(s)? Isto substitui a carteira e os alertas atuais.`)) return;
    state.wallet = wallet;
    state.alerts = alerts;
    if (favs.length) state.favs = favs;
    save("cripto.wallet", wallet);
    save("cripto.alerts", alerts);
    save("cripto.favs", state.favs);
    renderWallet();
    renderAlerts();
    renderMarket();
    toast("Backup restaurado.");
  } catch {
    toast("Este arquivo não é um backup válido do Cripto.");
  }
});

// ---------- alertas ----------

function renderAlerts() {
  const list = $("#alert-list");
  $("#alert-empty").hidden = state.alerts.length > 0;
  list.replaceChildren(
    ...state.alerts.map((al) => {
      const c = coinById(al.id);
      const name = c ? c.name : al.id;
      const now = c ? convert(c.current_price, "usd", al.cur) : null;
      const dist = now ? (al.price / now - 1) * 100 : null;
      return el("li", { class: al.firedAt ? "done" : null },
        el("div", null,
          el("div", null, el("b", null, name), ` ${al.dir === "above" ? "acima de" : "abaixo de"} ${fmtMoney(al.price, al.cur)}`),
          el("div", { class: "state" }, al.firedAt
            ? `🔔 Disparou em ${new Date(al.firedAt).toLocaleString("pt-BR")}`
            : now != null ? `Ativo · agora ${fmtMoney(now, al.cur)} · falta ${pctText(dist, 1)}` : "Ativo")),
        el("div", { class: "actions" },
          al.firedAt ? el("button", { type: "button", class: "ghost", onclick: () => rearmAlert(al.key) }, "Reativar") : null,
          el("button", { type: "button", class: "remove", "aria-label": `Remover alerta de ${name}`, onclick: () => removeAlert(al.key) }, "✕")));
    })
  );
}

function removeAlert(key) {
  state.alerts = state.alerts.filter((a) => a.key !== key);
  save("cripto.alerts", state.alerts);
  renderAlerts();
}

function rearmAlert(key) {
  const al = state.alerts.find((a) => a.key === key);
  if (!al) return;
  al.firedAt = null;
  save("cripto.alerts", state.alerts);
  checkAlerts();
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

// sugere o valor do alerta a partir do preço atual
$("#alert-form [name=coin]").addEventListener("change", (e) => {
  const c = coinById(e.target.value);
  const inp = $("#alert-form [name=price]");
  if (c && !inp.value) inp.placeholder = "agora " + fmtMoney(toCur(c.current_price));
});

// ---------- conversor ----------

let convLast = "qty";
function renderConverter() {
  const c = coinById($("#conv-coin").value);
  const qtyIn = $("#conv-qty");
  const valIn = $("#conv-val");
  if (!c) return;
  const price = toCur(c.current_price);
  if (convLast === "qty") {
    const q = parseFloat(qtyIn.value);
    valIn.value = q >= 0 ? +(q * price).toFixed(price * q >= 1 ? 2 : 8) : "";
  } else {
    const v = parseFloat(valIn.value);
    qtyIn.value = v >= 0 ? +(v / price).toPrecision(8) : "";
  }
  $("#conv-note").textContent = `1 ${c.symbol.toUpperCase()} = ${fmtMoney(price)} · 1 ${CURS[state.cur].label} = ${fmtNum(1 / price, 8)} ${c.symbol.toUpperCase()}`;
}
$("#conv-qty").addEventListener("input", () => { convLast = "qty"; renderConverter(); });
$("#conv-val").addEventListener("input", () => { convLast = "val"; renderConverter(); });
$("#conv-coin").addEventListener("change", renderConverter);

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
    if (state.markets.length) renderAll();
    loadAnalysis();
  });
}

const THEMES = ["auto", "light", "dark"];
const THEME_PT = { auto: "automático", light: "claro", dark: "escuro" };
function applyTheme() {
  const root = document.documentElement;
  if (state.theme === "auto") delete root.dataset.theme;
  else root.dataset.theme = state.theme;
  $("#theme").setAttribute("aria-label", `Tema: ${THEME_PT[state.theme]}. Toque para mudar.`);
  $("#theme").title = `Tema: ${THEME_PT[state.theme]}`;
}
$("#theme").addEventListener("click", () => {
  state.theme = THEMES[(THEMES.indexOf(state.theme) + 1) % THEMES.length];
  save("cripto.theme", state.theme);
  applyTheme();
  renderMarket();
  renderAnalysis();
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  renderMarket();
  renderAnalysis();
});

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
$("#filter").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  state.filter = b.dataset.f;
  state.limit = PAGE;
  pressSeg($("#filter"), b);
  renderMarket();
});
$("#search").addEventListener("input", (e) => {
  state.query = e.target.value;
  state.limit = PAGE;
  renderMarket();
});
$("#coin-select").addEventListener("change", (e) => selectCoin(e.target.value, false));
$("#more").addEventListener("click", () => {
  state.limit = filteredMarkets().length > state.limit ? state.limit + PAGE : PAGE;
  renderMarket();
});
$("#refresh").addEventListener("click", () => {
  setStatus("Atualizando…");
  chartCache.clear();
  state.fngAt = 0;
  state.analysisLoaded = false;
  loadMarkets();
});

let resizeTimer;
new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderAnalysis, 120);
}).observe($("#price-chart"));

// ---------- início ----------

applyTheme();
renderCurLabels();
$("#overview").replaceChildren(...[0, 1, 2, 3].map(() => el("div", { class: "skeleton" })));
renderWallet();
renderAlerts();
loadMarkets();
setInterval(loadMarkets, REFRESH_MS);
