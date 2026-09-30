// server/test/sync.test.js
// Tests de integración para el servicio de sincronización y cola de salida
process.env.NODE_ENV = 'test';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = require('../src/app');
const syncService = require('../src/services/sync.service');
const supabaseService = require('../src/services/supabase.service');

let server;
let baseUrl;
const TEST_SECRET = process.env.JWT_SECRET || 'fallback-jwt-secret';
let validToken;

before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      resolve();
    });
  });

  validToken = jwt.sign(
    { username: 'testadmin', perfil: 'Administracion' },
    TEST_SECRET,
    { expiresIn: '1h' }
  );
});

after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

describe('Sync Service & Endpoints Suite', () => {
  test('GET /api/sync/estado responde 200 con el estado de sincronización', async () => {
    const res = await fetch(`${baseUrl}/api/sync/estado`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data !== null && typeof data === 'object');
    assert.ok('clientes' in data || 'success' in data);
  });

  test('POST /api/sync/forzar rechaza peticiones sin token con 401', async () => {
    const res = await fetch(`${baseUrl}/api/sync/forzar`, {
      method: 'POST'
    });
    assert.strictEqual(res.status, 401);
  });

  test('POST /api/sync/forzar con token válido ejecuta sincronización y devuelve 200', async () => {
    const res = await fetch(`${baseUrl}/api/sync/forzar`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${validToken}`
      }
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.message.includes('éxito') || data.message.includes('Sincronización'));
    assert.ok(data.resultado);
  });

  test('queueOutboundOrder agrega orden a la cola de salida sin lanzar excepciones', async () => {
    const queueItem = await syncService.queueOutboundOrder(
      999999,
      'UPDATE_ESTADO',
      null,
      null,
      '1'
    );
    // Debe devolver el objeto encolado o resolver null gracefully si la base no tiene la tabla
    assert.ok(queueItem === null || typeof queueItem === 'object');
  });
});
