const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');
require('dotenv').config();

if (!globalThis.WebSocket) {
  globalThis.WebSocket = WebSocket;
}

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://cjqziapqtyjsxqxumgbx.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqcXppYXBxdHlqc3hxeHVtZ2J4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyMDE3NDIsImV4cCI6MjA2Nzc3Nzc0Mn0.EYVIWtOmrDd-_b-wA5lHMmO_CNuB22oc5I1dyl648rk';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
  realtime: {
    transport: WebSocket
  }
});

// Smart in-memory cache for fast read operations
const cache = new Map();
const CACHE_TTL = 30 * 1000; // 30 seconds

function clearCache() {
  cache.clear();
}

const ALLOWED_COLUMNS_BY_VIEW = {
  atc_usuarios_v: new Set(['id', 'Nombre de usuario', 'Email', 'Contraseña', 'Perfil', 'NRO_VENDEDOR', 'Activo', 'Intentos fallidos', 'Bloqueado hasta']),
  atc_pedidos_v: new Set([
    'IDPedido', 'Cliente', 'Cliente en BD?', 'Fecha y hora', 'Dirección cliente',
    'Nombre', 'Razón social (NO BD)', 'Celular de contacto', 'Porcentaje de descuento (%)',
    'Observaciones', 'Emitido por', 'Emitido por con fecha', 'Emitido Fecha',
    'Lugar de entrega', 'Deposito que prepara', 'Fecha de envio', 'Fecha de envío',
    'Creado por', 'Total', 'Fecha_Ultima_Modificacion', 'Fecha y Hora de Última Modificación',
    'Estado', 'Vendedor'
  ]),
  atc_detalles_pedidos_v: new Set([
    'IDDetalle', 'IDPedido', 'Codigo (más alla de si es item o nombre)',
    'Nombre (más alla de si es item o nombre)', 'Item  codigo', 'Nombre item',
    'Cantidad', 'Descuento', 'Precio', 'Subtotal (precio x cantidad)',
    'Monto del descuento', 'Total (subtotal - monto del descuento)',
    'Stock al momento de cargar', 'Proveedor'
  ]),
  atc_sql_clientes_v: new Set([
    'NRO_CLIENTE', 'NOMBRE_CLIENTE', 'CUIT', 'SALDO', 'VENDEDOR', 'NRO_VENDEDOR', 'LOCALIDAD', 'PROVINCIA', 'TELE', 'SUC', 'DIREC', 'synced_at'
  ]),
  atc_sql_productos_v: new Set([
    'CODART', 'DESCRI', 'CC_CIVA', 'stock', 'FAMILIA', 'NombreFamilia', 'RUBRO', 'NombreRubro', 'MARCA', 'NombreMarca', 'Embalaje', 'Proveedor', 'synced_at'
  ]),
  atc_sql_vendedores_v: new Set([
    'NRO_VENDEDOR', 'NOMBRE', 'ALIAS', 'VDOR', 'ACTIVO', 'synced_at'
  ]),
  atc_sql_pedidos_cabe_v: new Set([
    'IDPedido', 'Cliente', 'Fecha_Hora', 'Direccion', 'Creado_Por', 'Observaciones', 'Fecha_Ultima_Modificacion', 'Estado', 'Vendedor', 'Nro_PedidoGestion', 'Nro_PedidoReferencia', 'EstadoEnviado', 'Total', 'synced_at'
  ]),
  atc_sql_pedidos_deta_v: new Set([
    'IdDetalle', 'IdPedido', 'ItemCodigo', 'NombreItem', 'Cantidad', 'Descuento', 'PORCENT', 'Precio', 'Sub_Total', 'Total', 'CantidadPreparada', 'IdRenglonGestion', 'synced_at'
  ]),
  atc_sync_cola_pedidos_v: new Set([
    'id', 'id_pedido', 'accion', 'nuevo_estado', 'payload_pedido', 'payload_detalles', 'status', 'intentos', 'ultimo_error', 'created_at', 'updated_at', 'synced_at'
  ])
};

const INTEGER_COLUMNS = new Set([
  'Cliente', 'Vendedor', 'NRO_VENDEDOR', 'Intentos fallidos', 'NRO_CLIENTE', 'CODART', 'FAMILIA', 'RUBRO', 'MARCA', 'SUC', 'VDOR', 'ACTIVO', 'EstadoEnviado', 'id_pedido'
]);

const NUMERIC_COLUMNS = new Set([
  'Porcentaje de descuento (%)', 'Total', 'Cantidad', 'Descuento', 'Precio',
  'Subtotal (precio x cantidad)', 'Monto del descuento', 'Total (subtotal - monto del descuento)',
  'Stock al momento de cargar', 'SALDO', 'CC_CIVA', 'stock', 'PORCENT', 'Sub_Total', 'CantidadPreparada'
]);

const DATE_COLUMNS = new Set([
  'Fecha y hora', 'Emitido Fecha', 'Fecha de envio', 'Fecha de envío',
  'Fecha_Ultima_Modificacion', 'Fecha y Hora de Última Modificación', 'Bloqueado hasta', 'Fecha_Hora', 'synced_at', 'created_at', 'updated_at'
]);

function sanitizeRow(tableName, rowObj) {
  const allowed = ALLOWED_COLUMNS_BY_VIEW[tableName];
  if (!allowed || !rowObj || typeof rowObj !== 'object') return rowObj;
  const clean = {};
  for (const [key, value] of Object.entries(rowObj)) {
    if (allowed.has(key)) {
      if ((DATE_COLUMNS.has(key) || INTEGER_COLUMNS.has(key) || NUMERIC_COLUMNS.has(key)) && (value === '' || value === undefined)) {
        clean[key] = null;
      } else {
        clean[key] = value;
      }
    }
  }
  return clean;
}

/**
 * Normaliza las peticiones de lectura hacia las vistas públicas de Supabase
 */
async function getRows(viewName) {
  let tableName = 'atc_usuarios_v';
  const lowerViewName = String(viewName || '').toLowerCase();
  if (lowerViewName.includes('sql_clientes')) {
    tableName = 'atc_sql_clientes_v';
  } else if (lowerViewName.includes('sql_productos')) {
    tableName = 'atc_sql_productos_v';
  } else if (lowerViewName.includes('sql_vendedores')) {
    tableName = 'atc_sql_vendedores_v';
  } else if (lowerViewName.includes('sql_pedidos_cabe')) {
    tableName = 'atc_sql_pedidos_cabe_v';
  } else if (lowerViewName.includes('sql_pedidos_deta')) {
    tableName = 'atc_sql_pedidos_deta_v';
  } else if (lowerViewName.includes('sync_cola')) {
    tableName = 'atc_sync_cola_pedidos_v';
  } else if (lowerViewName.includes('usuarios')) {
    tableName = 'atc_usuarios_v';
  } else if (lowerViewName.includes('detalles')) {
    tableName = 'atc_detalles_pedidos_v';
  } else if (lowerViewName.includes('pedidos')) {
    tableName = 'atc_pedidos_v';
  } else {
    tableName = viewName;
  }

  const now = Date.now();
  const cached = cache.get(tableName);
  if (cached && (now - cached.timestamp) < CACHE_TTL) {
    return cached.data;
  }

  let allRows = [];
  let page = 0;
  const pageSize = 1000;
  const lowerTableName = tableName.toLowerCase();
  
  let orderCol = 'IDPedido';
  let isAscending = false;

  if (lowerTableName.includes('sql_clientes')) {
    orderCol = 'NOMBRE_CLIENTE';
    isAscending = true;
  } else if (lowerTableName.includes('sql_productos')) {
    orderCol = 'DESCRI';
    isAscending = true;
  } else if (lowerTableName.includes('sql_vendedores')) {
    orderCol = 'NOMBRE';
    isAscending = true;
  } else if (lowerTableName.includes('sql_pedidos_deta')) {
    orderCol = 'IdDetalle';
    isAscending = true;
  } else if (lowerTableName.includes('sql_pedidos_cabe')) {
    orderCol = 'IDPedido';
    isAscending = false;
  } else if (lowerTableName.includes('detalles')) {
    orderCol = 'IDDetalle';
    isAscending = true;
  } else if (lowerTableName.includes('usuarios')) {
    orderCol = 'Nombre de usuario';
    isAscending = true;
  } else if (lowerTableName.includes('sync_cola')) {
    orderCol = 'id';
    isAscending = true;
  }

  while (true) {
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .order(orderCol, { ascending: isAscending })
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) {
      console.error(`Error fetching from Supabase view ${tableName}:`, error.message);
      throw error;
    }

    if (!data || data.length === 0) break;
    allRows = allRows.concat(data);
    if (data.length < pageSize) break;
    page++;
  }

  cache.set(tableName, { data: allRows, timestamp: now });
  return allRows;
}

/**
 * Inserta o actualiza un registro en la vista pública
 * @param {string} viewName
 * @param {Object} rowData
 */
async function upsertRow(viewName, rowData) {
  clearCache();
  let tableName = 'atc_usuarios_v';
  const lowerViewName = String(viewName || '').toLowerCase();
  if (lowerViewName.includes('usuarios')) {
    tableName = 'atc_usuarios_v';
  } else if (lowerViewName.includes('detalles')) {
    tableName = 'atc_detalles_pedidos_v';
  } else if (lowerViewName.includes('pedidos')) {
    tableName = 'atc_pedidos_v';
  } else {
    tableName = viewName;
  }

  const cleanData = sanitizeRow(tableName, rowData);
  const { data, error } = await supabase
    .from(tableName)
    .insert([cleanData]);

  if (error) {
    console.error(`Error upserting into Supabase view ${tableName}:`, error.message);
    throw error;
  }
  return data;
}

/**
 * Inserta múltiples registros en la vista pública
 * @param {string} viewName
 * @param {Array<Object>} rowsData
 */
async function insertRows(viewName, rowsData) {
  clearCache();
  if (!Array.isArray(rowsData) || rowsData.length === 0) return [];

  let tableName = 'atc_usuarios_v';
  const lowerViewName = String(viewName || '').toLowerCase();
  if (lowerViewName.includes('usuarios')) {
    tableName = 'atc_usuarios_v';
  } else if (lowerViewName.includes('detalles')) {
    tableName = 'atc_detalles_pedidos_v';
  } else if (lowerViewName.includes('pedidos')) {
    tableName = 'atc_pedidos_v';
  } else {
    tableName = viewName;
  }

  const cleanRows = rowsData.map(row => sanitizeRow(tableName, row));
  const { data, error } = await supabase
    .from(tableName)
    .insert(cleanRows);

  if (error) {
    console.error(`Error inserting rows into Supabase view ${tableName}:`, error.message);
    throw error;
  }
  return data;
}

/**
 * Actualiza registros en la vista pública que coincidan con un filtro
 * @param {string} viewName
 * @param {Object} matchFilter e.g. { "Nombre de usuario": "Juan" } o { "IDPedido": 100001 }
 * @param {Object} updateData
 */
async function updateRows(viewName, matchFilter, updateData) {
  clearCache();
  let tableName = 'atc_usuarios_v';
  const lowerViewName = String(viewName || '').toLowerCase();
  if (lowerViewName.includes('usuarios')) {
    tableName = 'atc_usuarios_v';
  } else if (lowerViewName.includes('detalles')) {
    tableName = 'atc_detalles_pedidos_v';
  } else if (lowerViewName.includes('pedidos')) {
    tableName = 'atc_pedidos_v';
  } else {
    tableName = viewName;
  }

  const cleanData = sanitizeRow(tableName, updateData);
  let query = supabase.from(tableName).update(cleanData);
  Object.entries(matchFilter).forEach(([key, val]) => {
    query = query.eq(key, val);
  });

  const { data, error } = await query;
  if (error) {
    console.error(`Error updating rows in Supabase view ${tableName}:`, error.message);
    throw error;
  }
  return data;
}

/**
 * Elimina registros en la vista pública por filtro
 * @param {string} viewName
 * @param {Object} matchFilter
 */
async function deleteRows(viewName, matchFilter) {
  clearCache();
  let tableName = 'atc_usuarios_v';
  const lowerViewName = String(viewName || '').toLowerCase();
  if (lowerViewName.includes('usuarios')) {
    tableName = 'atc_usuarios_v';
  } else if (lowerViewName.includes('detalles')) {
    tableName = 'atc_detalles_pedidos_v';
  } else if (lowerViewName.includes('pedidos')) {
    tableName = 'atc_pedidos_v';
  } else {
    tableName = viewName;
  }

  let query = supabase.from(tableName).delete();
  Object.entries(matchFilter).forEach(([key, val]) => {
    query = query.eq(key, val);
  });

  const { data, error } = await query;
  if (error) {
    console.error(`Error deleting rows from Supabase view ${tableName}:`, error.message);
    throw error;
  }
  return data;
}

module.exports = {
  supabase,
  getRows,
  upsertRow,
  insertRows,
  updateRows,
  deleteRows,
  clearCache
};
