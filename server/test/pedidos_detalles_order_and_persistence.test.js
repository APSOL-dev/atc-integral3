// server/test/pedidos_detalles_order_and_persistence.test.js
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const jwt = require('jsonwebtoken');
require('dotenv').config();

process.env.NODE_ENV = 'test';
const TEST_SECRET = 'test-jwt-secret-details-persistence';
process.env.JWT_SECRET = TEST_SECRET;

const supabaseService = require('../src/services/supabase.service');
const mssqlService = require('../src/services/mssql.service');

const origGetRows = supabaseService.getRows;
const origGetPedidosFromDB = mssqlService.getPedidosFromDB;
const origGetDetallesFromDB = mssqlService.getDetallesFromDB;
const origGetProductos = mssqlService.getProductos;

describe('Persistencia y orden secuencial de detalles en pedidos 0.0', () => {
  let server;
  let baseUrl;
  let validToken;

  before(async () => {
    // Pedido 0.0 que en SQL Server no tiene renglones propios en PedidoAppDeta,
    // pero ya fue editado y tiene 2 renglones en Supabase
    supabaseService.getRows = async (table) => {
      const lower = String(table).toLowerCase();
      if (lower === 'atc_pedidos_v') {
        return [
          {
            IDPedido: '11047400',
            Nombre: 'RIVAS DIEGO HERNAN',
            Estado: '0.0',
            Nro_PedidoReferencia: '110474',
            Total: 70000
          },
          {
            IDPedido: '110474',
            Nombre: 'RIVAS DIEGO HERNAN (BASE)',
            Estado: '1',
            Total: 34458
          }
        ];
      }
      if (lower === 'atc_detalles_pedidos_v') {
        return [
          // Supabase devuelve los detalles (p. ej. en cualquier orden de inserción)
          {
            IDDetalle: '11047400002',
            IDPedido: '11047400',
            'Item  codigo': '99999',
            'Nombre item': 'SEGUNDO ARTICULO',
            Cantidad: 5,
            Precio: 1000
          },
          {
            IDDetalle: '11047400001',
            IDPedido: '11047400',
            'Item  codigo': '72072',
            'Nombre item': 'PRIMER ARTICULO',
            Cantidad: 2,
            Precio: 34458
          },
          {
            IDDetalle: '110474001',
            IDPedido: '110474',
            'Item  codigo': '72072',
            'Nombre item': 'PRIMER ARTICULO (CANTIDAD ORIGINAL)',
            Cantidad: 1,
            Precio: 34458
          }
        ];
      }
      return [];
    };

    // SQL Server devuelve el pedido de PedidoAppCabe pero PedidoAppDeta vacio para 11047400
    mssqlService.getPedidosFromDB = async () => [
      {
        IDPedido: 11047400,
        Nombre: 'RIVAS DIEGO HERNAN',
        Estado: '0.0',
        Nro_PedidoReferencia: '110474',
        Total: 70000
      }
    ];
    mssqlService.getDetallesFromDB = async () => [];
    mssqlService.getProductos = async () => [];

    const express = require('express');
    const app = express();
    app.use(express.json());
    const pedidosRouter = require('../src/routes/pedidos.routes');
    if (pedidosRouter.invalidatePedidosCache) pedidosRouter.invalidatePedidosCache();
    app.use('/api/pedidos', pedidosRouter);

    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;

    validToken = jwt.sign(
      { username: 'testuser', role: 'Administracion' },
      TEST_SECRET,
      { expiresIn: '1h' }
    );
  });

  after(async () => {
    supabaseService.getRows = origGetRows;
    mssqlService.getPedidosFromDB = origGetPedidosFromDB;
    mssqlService.getDetallesFromDB = origGetDetallesFromDB;
    mssqlService.getProductos = origGetProductos;

    if (server) await new Promise(resolve => server.close(resolve));
  });

  test('GET /api/pedidos/:id de un pedido 0.0 con detalles en Supabase NO debe pisarse con el pedido base original y debe ordenar detalles ascendentemente', async () => {
    const res = await fetch(`${baseUrl}/api/pedidos/11047400`, {
      headers: {
        'Authorization': `Bearer ${validToken}`
      }
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(String(data.IDPedido), '11047400');
    assert.ok(Array.isArray(data.detalles), 'detalles debe ser un array');
    assert.strictEqual(data.detalles.length, 2, 'Debe preservar los 2 renglones editados de Supabase y no los del pedido base');

    // Debe ordenar ascendentemente: 11047400001 antes que 11047400002
    assert.strictEqual(String(data.detalles[0].IDDetalle), '11047400001', 'El primer renglón debe ser el 001');
    assert.strictEqual(data.detalles[0].Cantidad, 2, 'La cantidad debe ser la editada (2) y no la del base (1)');
    assert.strictEqual(String(data.detalles[1].IDDetalle), '11047400002', 'El segundo renglón debe ser el 002');
  });
});
