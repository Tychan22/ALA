#!/usr/bin/env node
import crypto from 'crypto';

// Must match the constant in electron/main.js
const _S = ['ALA-TRADER', '-2026-MASTER', '-SECRET-V2'];
const SECRET = _S.join('');

function buildTag(name) {
  return name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8).padEnd(8, '0');
}

function generateKey(name) {
  const tag = buildTag(name);
  const hex = crypto.createHmac('sha256', SECRET).update(tag).digest('hex').toUpperCase();
  return `${tag}-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

const arg = process.argv[2];
if (!arg) {
  console.error('\nUsage:   node scripts/generate-key.js <username>');
  console.error('Example: node scripts/generate-key.js alice\n');
  process.exit(1);
}

const key = generateKey(arg);
console.log(`\nALA License Key for "${process.argv[2]}":\n\n  ${key}\n`);
