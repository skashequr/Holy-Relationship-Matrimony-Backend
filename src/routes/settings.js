const express = require('express');
const router = express.Router();

const Settings = require('../models/Settings');

// @route  GET /api/settings/tracking
// @desc   Public tracking config (GA4 Measurement ID + Facebook Pixel ID)
//         so the frontend can load analytics scripts without the IDs being
//         hardcoded in the codebase — admins manage them from the dashboard.
// @access Public
router.get('/tracking', async (req, res) => {
  try {
    const [enabled, gaMeasurementId, fbPixelId] = await Promise.all([
      Settings.get('trackingEnabled', false),
      Settings.get('gaMeasurementId', null),
      Settings.get('fbPixelId', null),
    ]);

    res.json({
      success: true,
      tracking: enabled
        ? { gaMeasurementId: gaMeasurementId || null, fbPixelId: fbPixelId || null }
        : { gaMeasurementId: null, fbPixelId: null },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
