process.env.NODE_ENV = 'test';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = require('../src/app');
const { poolPromise } = require('../src/config/mssql');
const mssqlService = require('../src/services/mssql.service');
const supabaseService = require('../src/services/supabase.service');

let server;
let baseUrl;

before(async () => {
  // Iniciar servidor Express en un puerto aleatorio libre
  server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });
});

after(async () => {
  // Cerrar el servidor HTTP
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  // Cerrar la conexión pool de base de datos para finalizar limpio
  const pool = await poolPromise;
  if (pool) {
    await pool.close();
  }
});

// Helper para generar cabeceras con JWT firmado
function getAuthHeaders() {
  const token = jwt.sign(
    { id: 'test-user-id', username: 'TestUser', rol: 'admin' },
    process.env.JWT_SECRET || 'fallback-jwt-secret',
    { expiresIn: '1h' }
  );
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

test('Suite de integración: Consolidación de Pedidos (Supabase App vs SQL vs API)', async (t) => {

  let appIds = [];
  let dbIds = [];
  let apiPedidos = [];
  let apiIds = new Set();

  await t.test('1. Obtener datos de todas las fuentes de datos (Supabase App, SQL, API)', async () => {
    // 1. Obtener pedidos de Supabase App
    const appPedidos = await supabaseService.getRows('atc_pedidos_v');
    appIds = appPedidos
      .map(p => parseInt(p.IDPedido?.toString().trim(), 10))
      .filter(id => !isNaN(id));
    
    // 2. Obtener pedidos de SQL Server
    const dbPedidos = await mssqlService.getPedidosFromDB();
    dbIds = dbPedidos
      .map(p => parseInt(p.IDPedido, 10))
      .filter(id => !isNaN(id));

    // 3. Obtener pedidos de la API (endpoint de la aplicación)
    const res = await fetch(`${baseUrl}/api/pedidos`, {
      headers: getAuthHeaders()
    });
    
    assert.strictEqual(res.status, 200, `La respuesta de la API no fue 200 OK. Código: ${res.status}`);
    apiPedidos = await res.json();
    apiIds = new Set(apiPedidos.map(p => parseInt(p.IDPedido, 10)));

    console.log(`\n[Test setup] Total en Supabase App: ${appIds.length}, Total en SQL: ${dbIds.length}, Total en API: ${apiPedidos.length}`);
  });

  await t.test('2. Validar que cada pedido de Supabase App esté presente en la API', () => {
    for (const id of appIds) {
      assert.ok(
        apiIds.has(id),
        `El pedido con ID ${id} (de Supabase App) no fue consolidado o no se encuentra en la API.`
      );
    }
  });

  await t.test('3. Validar que cada pedido de SQL Server esté presente en la API', () => {
    for (const id of dbIds) {
      assert.ok(
        apiIds.has(id),
        `El pedido con ID ${id} (de SQL Server) no fue consolidado o no se encuentra en la API.`
      );
    }
  });

  await t.test('4. Validar la consistencia numérica (Total Consolidado vs Unión de fuentes)', () => {
    const expectedUnion = new Set([...appIds, ...dbIds]);
    
    assert.strictEqual(
      apiIds.size,
      expectedUnion.size,
      `La cantidad de pedidos devueltos por la API (${apiIds.size}) difiere de la unión de conjuntos de Supabase App y SQL (${expectedUnion.size}).`
    );
  });
});
