/**
 * Netlify Function — Precios reales de acciones y crypto
 * Stocks : Yahoo Finance (múltiples endpoints, procesamiento secuencial)
 * Crypto : CoinGecko Free API
 */

const CG_ID_MAP = {
  btc:'bitcoin',eth:'ethereum',sol:'solana',bnb:'binancecoin',
  ada:'cardano',dot:'polkadot',xrp:'ripple',avax:'avalanche-2',
  matic:'matic-network',link:'chainlink',uni:'uniswap',ltc:'litecoin',
  doge:'dogecoin',atom:'cosmos',near:'near',op:'optimism',
  arb:'arbitrum',inj:'injective-protocol',sui:'sui',apt:'aptos',
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// fetchWithTimeout usando AbortController (compatible con Node 16+)
async function fetchWithTimeout(url, options = {}, ms = 9000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchYahooChart(ticker) {
  const hosts = ['query1', 'query2'];
  for (const host of hosts) {
    try {
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`;
      const res = await fetchWithTimeout(url, {
        headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Accept-Language': 'es-ES,es;q=0.9' }
      });
      if (!res.ok) continue;
      const data = await res.json();
      const meta = data?.chart?.result?.[0]?.meta;
      if (!meta) continue;
      const price = meta.regularMarketPrice ?? meta.chartPreviousClose ?? meta.previousClose;
      const prev  = meta.chartPreviousClose ?? meta.previousClose ?? price;
      if (price == null) continue;
      return {
        price: Math.round(price * 10000) / 10000,
        change: prev ? Math.round(((price - prev) / prev) * 10000) / 100 : 0,
        currency: meta.currency || 'USD',
      };
    } catch { /* try next */ }
  }
  return null;
}

async function fetchYahooQuote(ticker) {
  for (const host of ['query1', 'query2']) {
    try {
      const url = `https://${host}.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(ticker)}&fields=regularMarketPrice,regularMarketChangePercent,currency`;
      const res = await fetchWithTimeout(url, {
        headers: { 'User-Agent': UA, 'Accept': 'application/json' }
      });
      if (!res.ok) continue;
      const data = await res.json();
      const q = data?.quoteResponse?.result?.[0];
      if (!q) continue;
      return {
        price: Math.round((q.regularMarketPrice || 0) * 10000) / 10000,
        change: Math.round((q.regularMarketChangePercent || 0) * 100) / 100,
        currency: q.currency || 'USD',
      };
    } catch { /* try next */ }
  }
  return null;
}

async function fetchYahooSummary(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v11/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=price`;
    const res = await fetchWithTimeout(url, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const p = data?.quoteSummary?.result?.[0]?.price;
    if (!p) return null;
    const price = p.regularMarketPrice?.raw;
    const change = p.regularMarketChangePercent?.raw;
    if (price == null) return null;
    return {
      price: Math.round(price * 10000) / 10000,
      change: Math.round((change || 0) * 10000) / 100,
      currency: p.currency || 'USD',
    };
  } catch { return null; }
}

async function fetchTicker(ticker) {
  let result = await fetchYahooChart(ticker);
  if (!result) result = await fetchYahooQuote(ticker);
  if (!result) result = await fetchYahooSummary(ticker);
  return result;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'JSON inválido' }) }; }

  const results = { stocks: {}, crypto: {} };

  // ── Acciones — procesamiento SECUENCIAL para evitar rate limiting ──────
  const stockList = body.stocks || [];
  for (let i = 0; i < stockList.length; i++) {
    const { ticker } = stockList[i];
    if (!ticker) continue;
    if (i > 0) await sleep(400); // pausa entre peticiones
    let result = await fetchTicker(ticker);
    // Si falla y es europeo (.MC etc), intentar sin sufijo
    if (!result && ticker.includes('.')) {
      const base = ticker.split('.')[0];
      result = await fetchTicker(base + '.MC');
      if (!result) result = await fetchTicker(base);
    }
    results.stocks[ticker] = result;
  }

  // ── Crypto via CoinGecko ──────────────────────────────────
  const cryptoSymbols = (body.crypto || []).map(s => s.toLowerCase()).filter(Boolean);
  if (cryptoSymbols.length) {
    const ids = [...new Set(cryptoSymbols.map(s => CG_ID_MAP[s] || s))].join(',');
    try {
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=eur&include_24hr_change=true`;
      const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } });
      const data = await res.json();
      cryptoSymbols.forEach(sym => {
        const cgId = CG_ID_MAP[sym] || sym;
        const d = data[cgId];
        results.crypto[sym] = d ? {
          price: d.eur,
          change: Math.round((d.eur_24h_change || 0) * 100) / 100,
        } : null;
      });
    } catch { /* deja crypto vacío */ }
  }

  return {
    statusCode: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify(results),
  };
};
