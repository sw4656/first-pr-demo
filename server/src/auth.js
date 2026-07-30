const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('./db');

const router = express.Router();

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    const user = rows[0];
    const valid = user && await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = user.id;
      req.session.email = user.email;
      req.session.name = user.name;
      res.json({ email: user.email, name: user.name });
    });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res, next) => {
  if (!req.session) return res.status(204).end();
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('loan_servicing_sid');
    res.status(204).end();
  });
});

router.get('/me', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.json({ email: req.session.email, name: req.session.name });
});

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const next_ = encodeURIComponent(req.originalUrl);
  res.redirect('/login.html?next=' + next_);
}

module.exports = { router, requireAuth };
