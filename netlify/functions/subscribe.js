/**
 * POST /api/subscribe
 * Guarda la push subscription del navegador en Netlify Blobs.
 * Body: { subscription: PushSubscriptionJSON, userId: string }
 */
const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };

  try {
    const { subscription, userId } = JSON.parse(event.body || '{}');
    if (!subscription?.endpoint) throw new Error('Missing subscription');

    const store = getStore({ name: 'push-subscriptions', consistency: 'strong' });
    const key = userId || subscription.endpoint.split('/').pop().slice(-32);
    await store.setJSON(key, { subscription, savedAt: new Date().toISOString() });

    return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, key }) };
  } catch (e) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
