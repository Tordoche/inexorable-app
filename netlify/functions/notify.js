/**
 * Netlify Scheduled Function — se ejecuta cada minuto.
 * Lee las notificaciones programadas, envía las que toca, y marca como enviadas.
 *
 * Configuración en netlify.toml:
 *   [functions."notify"]
 *   schedule = "* * * * *"
 */
const webpush = require('web-push');
const { getStore } = require('@netlify/blobs');

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@inexorable.app';

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

exports.handler = async () => {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    console.error('VAPID keys not configured');
    return { statusCode: 500, body: 'VAPID not configured' };
  }

  const subsStore  = getStore({ name: 'push-subscriptions', consistency: 'strong' });
  const schedStore = getStore({ name: 'push-schedules',     consistency: 'strong' });

  const now   = Date.now();
  const AHEAD = 2 * 60 * 1000; // tolerancia: hasta 2 min después de sendAt

  try {
    // Listar todos los usuarios con notificaciones programadas
    const { blobs: schedBlobs } = await schedStore.list();

    for (const blob of schedBlobs) {
      const userId = blob.key;
      const data   = await schedStore.getJSON(userId);
      if (!data?.notifications?.length) continue;

      const pending = data.notifications.filter(n => !n.sent);
      if (!pending.length) continue;

      let changed = false;
      const notifications = data.notifications;

      for (const notif of notifications) {
        if (notif.sent) continue;
        const sendAt = new Date(notif.sendAt).getTime();
        if (sendAt > now + AHEAD || sendAt < now - AHEAD) continue; // no es el momento

        // Buscar la subscription de este usuario
        const subData = await subsStore.getJSON(userId).catch(() => null);
        if (!subData?.subscription) { notif.sent = true; changed = true; continue; }

        const payload = JSON.stringify({
          title: notif.title,
          body:  notif.body,
          tag:   notif.id,
          icon:  '/apple-touch-icon.png',
          badge: '/apple-touch-icon.png',
        });

        try {
          await webpush.sendNotification(subData.subscription, payload);
          console.log(`Sent notification "${notif.title}" to ${userId}`);
        } catch (err) {
          console.error(`Failed to send to ${userId}:`, err.statusCode, err.message);
          // Si la subscription expiró (410/404), borrarla
          if (err.statusCode === 410 || err.statusCode === 404) {
            await subsStore.delete(userId).catch(() => {});
          }
        }

        notif.sent = true;
        changed = true;
      }

      if (changed) {
        await schedStore.setJSON(userId, { ...data, notifications });
      }
    }

    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    console.error('notify error:', err);
    return { statusCode: 500, body: err.message };
  }
};
