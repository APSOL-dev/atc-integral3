// server/test/descuentos.routes.test.js
// Tests de integración para rutas /api/descuentos-marca (soft delete y proyección estado/fecha_baja)

const { test, it, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const jwt = require('jsonwebtoken');
process.env.NODE_ENV = 'test';
require('dotenv').config();

const app = require('../src/app');

let server;
let baseUrl;

function apiFetch(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const reqOptions = {
      hostname: url.hostname,
      port: Number(url.port),
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };
    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, bodyRaw: data, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function getAuthToken() {
  return jwt.sign(
    { nombre: 'AdminUser', perfil: 'Administracion' },
    process.env.JWT_SECRET || 'test-secret',
    { expiresIn: '1h' }
  );
}

before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

describe('Descuentos por Marca Routes & Soft Delete Contract', () => {
  it('GET /api/descuentos-marca responde 200 y retorna array de descuentos', async () => {
    const res = await apiFetch('/api/descuentos-marca');
    assert.equal(res.status, 200);
    const body = JSON.parse(res.bodyRaw);
    assert.equal(Array.isArray(body), true);
  });

  it('POST /api/descuentos-marca requiere autenticación (401 si no hay token)', async () => {
    const res = await apiFetch('/api/descuentos-marca', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ marca: 'TestMarca', porcentaje: 15 })
    });
    assert.equal(res.status, 401);
  });

  it('DELETE /api/descuentos-marca/:marca requiere autenticación (401 si no hay token)', async () => {
    const res = await apiFetch('/api/descuentos-marca/TestMarca', {
      method: 'DELETE'
    });
    assert.equal(res.status, 401);
  });

  it('POST /api/descuentos-marca con token asigna descuento activo y DELETE realiza soft delete', async () => {
    const token = getAuthToken();
    
    // 1. Guardar descuento para marca 'PruebaSoftDelete'
    const resPost = await apiFetch('/api/descuentos-marca', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ marca: 'PruebaSoftDelete', porcentaje: 20 })
    });
    assert.equal(resPost.status, 200);

    // 2. Ejecutar DELETE para deshabilitar
    const resDel = await apiFetch('/api/descuentos-marca/PruebaSoftDelete', {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    assert.equal(resDel.status, 200);
    const delBody = JSON.parse(resDel.bodyRaw);
    assert.match(delBody.message, /deshabilitado/i);
  });
});
