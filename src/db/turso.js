/**
 * turso.js — libsql/Turso client singleton
 * Reads TURSO_URL + TURSO_AUTH_TOKEN from environment.
 */
'use strict';

// Use /web build — pure HTTP/WS transport, no native bindings (works on Android/ARM64)
const { createClient } = require('@libsql/client/web');

const url       = process.env.TURSO_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url) throw new Error('TURSO_URL is not set in .env');

const client = createClient({ url, authToken: authToken || undefined });

module.exports = client;
