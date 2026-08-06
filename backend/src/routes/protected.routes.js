const express = require('express');
const { requireAuth } = require('../middleware/auth.middleware');

const router = express.Router();

// Example protected endpoint — proves the access token actually gates access.
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user, message: 'This is protected data, only visible with a valid access token' });
});

module.exports = router;