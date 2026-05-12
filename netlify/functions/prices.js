/**
 * Netlify Function — Precios reales de acciones y crypto
 * Stocks : Yahoo Finance (sin API key)
 * Crypto : CoinGecko Free API (sin API key)
 */

const CG_ID_MAP = {
  btc:'bitcoin',eth:'ethereum',sol:'solana',bnb:'binancecoin',
  ada:'cardano',dot:'polkadot',xrp:'ripple',avax:'avalanche-2',
  matic:'matic-network',link:'chainlink',uni:'uniswap',ltc:'litecoin',
  doge:'dogecoin',atom:'cosmos',near:'near',op:'optimism',
  arb:'arbitrum',inj:'injective-protocol',sui:'sui',apt:'aptos',
};

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

  // ── Acciones via Yahoo Finance (v8 chart + v7 quote fallback) ─────────
  const stockList = body.stocks || [];
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  async function fetchYahooChart(ticker) {
    const urls = [
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`,
      `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`,
    ];
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Accept-Language': 'es-ES,es;q=0.9' },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) continue;
        const data = await res.json();
        const meta = data?.chart?.result?.[0]?.meta;
        if (meta) {
          const price = meta.regularMarketPrice ?? meta.chartPreviousClose ?? meta.previousClose;
          const prev  = meta.chartPreviousClose ?? meta.previousClose ?? price;
          if (price == null) continue;
          return {
            price: Math.round(price * 10000) / 10000,
            change: prev ? Math.round(((price - prev) / prev) * 10000) / 100 : 0,
            currency: meta.currency || 'USD',
          };
        }
      } catch { /* try next */ }
    }
    return null;
  }

  async function fetchYahooQuote(ticker) {
    try {
      const res = await fetch(
        `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(ticker)}&fields=regularMarketPrice,regularMarketChangePercent,currency`,
        { headers: { 'User-Agent': UA, 'Accept': 'application/json' }, signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) return null;
      const data = await res.json();
      const q = data?.quoteResponse?.result?.[0];
      if (!q) return null;
      return {
        price: Math.round((q.regularMarketPrice || 0) * 10000) / 10000,
        change: Math.round((q.regularMarketChangePercent || 0) * 100) / 100,
        currency: q.currency || 'USD',
      };
    } catch { return null; }
  }

  await Promise.allSettled(stockList.map(async ({ ticker }) => {
    if (!ticker) return;
    let result = await fetchYahooChart(ticker);
    if (!result) result = await fetchYahooQuote(ticker);
    results.stocks[ticker] = result;
  }));

  // ── Crypto via CoinGecko ──────────────────────────────────
  const cryptoSymbols = (body.crypto || []).map(s => s.toLowerCase()).filter(Boolean);
  if (cryptoSymbols.length) {
    const ids = [...new Set(cryptoSymbols.map(s => CG_ID_MAP[s] || s))].join(',');
    try {
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=eur&include_24hr_change=true`;
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      const data = await res.json();
      cryptoSymbols.forEach(sym => {
        const cgId = CG_ID_MAP[sym] || sym;
        const d = data[cgId];
        if (d) {
          results.crypto[sym] = {
            price: d.eur,
            change: Math.round((d.eur_24h_change || 0) * 100) / 100,
          };
        } else {
          results.crypto[sym] = null;
        }
      });
    } catch { /* deja crypto vacío */ }
  }

  return {
    statusCode: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify(results),
  };
};
