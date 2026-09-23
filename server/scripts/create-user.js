// Creates or updates an internal staff login. There is no self-service
// signup for this app — an admin runs this script for each of the 7-8
// internal users who need access.
//
// Usage:
//   DATABASE_URL=postgres://... node server/scripts/create-user.js <email> <name>
// Prompts for the password interactively (not read from argv/history).
require('dotenv').config();

const crypto = require('crypto');
const readline = require('readline');
const bcrypt = require('bcryptjs');
const { pool, init } = require('../src/db');

function promptPassword(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    // Best-effort masking; readline has no built-in silent mode.
    rl._writeToOutput = function (str) {
      rl.output.write(str.replace(/[^\n]/g, ''));
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main() {
  const [, , email, ...nameParts] = process.argv;
  const name = nameParts.join(' ');

  if (!email) {
    console.error('Usage: node server/scripts/create-user.js <email> <full name>');
    process.exit(1);
  }

  const password = await promptPassword(`Password for ${email}: `);
  if (!password || password.length < 12) {
    console.error('Password must be at least 12 characters.');
    process.exit(1);
  }

  await init();

  const passwordHash = await bcrypt.hash(password, 12);
  const id = crypto.randomUUID();

  await pool.query(`
    INSERT INTO users (id, email, password_hash, name)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, name = EXCLUDED.name
  `, [id, email.toLowerCase(), passwordHash, name || null]);

  console.log(`User ${email} created/updated.`);
  await pool.end();
}

main().catch((err) => {
  console.error('Failed to create user:', err);
  process.exit(1);
});
