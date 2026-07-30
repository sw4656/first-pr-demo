require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);

const { pool, init } = require('./db');
const accountsRouter = require('./routes/accounts');
const { router: authRouter, requireAuth } = require('./auth');

if (!process.env.SESSION_SECRET) {
  console.error('SESSION_SECRET environment variable is required (see .env.example)');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

// Required for secure cookies to work when running behind a TLS-terminating
// load balancer/reverse proxy (e.g. an ALB) in production.
app.set('trust proxy', 1);

app.use(express.json({ limit: '5mb' }));

app.use(session({
  store: new pgSession({ pool, createTableIfMissing: true }),
  name: 'loan_servicing_sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
  },
}));

app.use('/api/auth', authRouter);
app.get('/login.html', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'login.html')));

app.use(requireAuth);

app.use('/api/accounts', accountsRouter);
app.use(express.static(PUBLIC_DIR));

init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Loan servicing server listening on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database', err);
    process.exit(1);
  });
