/**
 * Netlify Serverless Function — Proxy seguro para la API de Claude (Anthropic)
 *
 * - La ANTHROPIC_API_KEY nunca sale del servidor
 * - Evita errores de CORS al llamar desde el navegador
 * - Compatible con web_search beta tool
 */

const MAX_TOKENS_LIMIT = 4096;
const ALLOWED_MODELS = [
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001',
];

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'ANTHROPIC_API_KEY no configurada en Netlify.' }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'JSON inválido en el cuerpo de la petición.' }),
    };
  }

  // Validaciones básicas
  if (!body.model || !ALLOWED_MODELS.includes(body.model)) {
    body.model = 'claude-sonnet-4-6'; // fallback seguro
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Se requiere el campo messages.' }),
    };
  }
  // Limitar max_tokens por seguridad
  if (!body.max_tokens || body.max_tokens > MAX_TOKENS_LIMIT) {
    body.max_tokens = MAX_TOKENS_LIMIT;
  }

  try {
    const usesWebSearch =
      Array.isArray(body.tools) &&
      body.tools.some((t) => t.name === 'web_search' || (t.type || '').includes('web_search'));

    const requestHeaders = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    };

    if (usesWebSearch) {
      requestHeaders['anthropic-beta'] = 'web-search-2025-03-05';
    }

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(body),
    });

    const data = await anthropicRes.json();

    return {
      statusCode: anthropicRes.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Error al contactar con Anthropic: ' + err.message }),
    };
  }
};
