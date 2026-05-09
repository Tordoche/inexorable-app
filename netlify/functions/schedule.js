/**
 * POST /api/schedule
 * Registra notificaciones programadas (comidas, entrenos) en Netlify Blobs.
 * Body: { userId, notifications: [{ id, title, body, sendAt (ISO) }] }
 * Reemplaza todas las notificaciones del día para el userId dado.
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
    const { userId, notifications } = JSON.parse(event.body || '{}');
    if (!userId || !Array.isArray(notifications)) throw new Error('Missing userId or notifications');

    const store = getStore({ name: 'push-schedules', consistency: 'strong' });
    // Guardar lista de notificaciones pendientes para este usuario
    await store.setJSON(userId, {
      notifications: notifications.map(n => ({
        id: n.id,
        title: n.title || 'Inexorable',
        body: n.body || '',
        sendAt: n.sendAt,
        sent: false,
      })),
      updatedAt: new Date().toISOString(),
    });

    return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, count: notifications.length }) };
  } catch (e) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
