/**
 * db.js  —  PostgreSQL connection via Knex
 *
 * Drop-in replacement for the SQLite better-sqlite3 db.js
 * in server/src/db.js.
 *
 * Requires:  npm install knex pg
 *            npm uninstall better-sqlite3
 *
 * Set DATABASE_URL in your .env file:
 *   DATABASE_URL=postgresql://user:password@host:5432/webnote_prod
 */

'use strict';

const knex = require('knex')({
  client: 'pg',
  connection: {
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true'
      ? { rejectUnauthorized: false }
      : false,
  },
  pool: {
    min: 2,
    max: 10,
    // Destroy idle connections after 30 seconds
    idleTimeoutMillis: 30000,
    // Reject connections that take more than 5 seconds to acquire
    acquireTimeoutMillis: 5000,
  },
  // Log slow queries in development
  asyncStackTraces: process.env.NODE_ENV === 'development',
});

// Verify connection on startup
knex.raw('SELECT 1')
  .then(() => console.log('[db] PostgreSQL connected'))
  .catch(err => {
    console.error('[db] PostgreSQL connection failed:', err.message);
    process.exit(1);
  });

module.exports = knex;
