const https = require('https');
const Settings = require('../models/Settings');

/**
 * Fire a server-side GA4 purchase event via the Measurement Protocol.
 * This tracks a "sale" (contact unlock) no matter which path completed it —
 * an instant gateway callback or a later admin approval, when the buyer's
 * own browser is no longer around to fire a client-side pixel.
 * Never throws — a tracking failure must not affect the payment flow.
 */
const trackServerPurchase = async ({ clientId, transactionId, value, currency = 'BDT' }) => {
  if (!clientId) return;

  try {
    const [enabled, measurementId, apiSecret] = await Promise.all([
      Settings.get('trackingEnabled', false),
      Settings.get('gaMeasurementId', null),
      Settings.get('gaApiSecret', null),
    ]);
    if (!enabled || !measurementId || !apiSecret) return;

    const payload = JSON.stringify({
      client_id: clientId,
      events: [
        {
          name: 'purchase',
          params: {
            transaction_id: transactionId,
            currency,
            value,
            items: [{ item_name: 'contact_unlock', price: value, quantity: 1 }],
          },
        },
      ],
    });

    await new Promise((resolve) => {
      const req = https.request(
        {
          hostname: 'www.google-analytics.com',
          path: `/mp/collect?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
          timeout: 5000,
        },
        (res) => { res.on('data', () => {}); res.on('end', resolve); }
      );
      req.on('error', (error) => { console.error('GA4 server-side purchase tracking failed:', error.message); resolve(); });
      req.on('timeout', () => { req.destroy(); resolve(); });
      req.write(payload);
      req.end();
    });
  } catch (error) {
    console.error('GA4 server-side purchase tracking failed:', error.message);
  }
};

module.exports = { trackServerPurchase };
