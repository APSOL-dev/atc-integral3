const express = require('express');
const router = express.Router();
const supabaseService = require('../services/supabase.service');
const mssqlService = require('../services/mssql.service');
const syncService = require('../services/sync.service');
const auth = require('../middlewares/auth');

// Protect all routes
router.use(auth);

// Date Formatter — preserva la hora literal de SQL Server, pero para Supabase (con timezone) convierte a America/Argentina/Buenos_Aires
function formatDate(date, format = 'ISO') {
  if (!date) return '';

  let y, m, day, h, min, s;

  if (date instanceof Date) {
    // Preservar la hora literal de SQL Server (mssql devuelve datetime como UTC del valor almacenado)
    y = String(date.getUTCFullYear()).padStart(4, '0');
    m = String(date.getUTCMonth() + 1).padStart(2, '0');
    day = String(date.getUTCDate()).padStart(2, '0');
    h = String(date.getUTCHours()).padStart(2, '0');
    min = String(date.getUTCMinutes()).padStart(2, '0');
    s = String(date.getUTCSeconds()).padStart(2, '0');
  } else {
    const str = String(date).trim();
    // Si contiene timezone (ej: contiene +00, Z o +00:00) o es formato ISO completo de Supabase
    if (str.includes('+00') || str.toLowerCase().includes('z') || str.includes('T')) {
      const d = new Date(str);
      if (isNaN(d.getTime())) return '';
      // Formatear en zona de Buenos Aires
      const options = {
        timeZone: 'America/Argentina/Buenos_Aires',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }
      const parts = new Intl.DateTimeFormat('en-CA', options).formatToParts(d)
      const get = (type) => parts.find(p => p.type === type)?.value || '00'

      y = get('year')
      m = get('month')
      day = get('day')
      h = get('hour')
      if (h === '24') h = '00'
      min = get('minute')
      s = get('second')
    } else {
      // Si es un string sin zona horaria (como el de SQL Server), extraer literal
      const match = str.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2}):(\d{2})/);
      if (match) {
        [, y, m, day, h, min, s] = match;
      } else {
        const d = new Date(str);
        if (isNaN(d.getTime())) return '';
        y   = String(d.getFullYear()).padStart(4, '0');
        m   = String(d.getMonth() + 1).padStart(2, '0');
        day = String(d.getDate()).padStart(2, '0');
        h   = String(d.getHours()).padStart(2, '0');
        min = String(d.getMinutes()).padStart(2, '0');
        s   = String(d.getSeconds()).padStart(2, '0');
      }
    }
  }

  if (format === 'FULL') return `${y}-${m}-${day} ${h}:${min}:${s}`;
  if (format === 'SHORT_WITH_TIME') return `${day}/${m}/${y} ${h}:${min}`;
  return `${y}-${m}-${day}T${h}:${min}:${s}`;
}

// Genera el timestamp actual formateado en hora local de Buenos Aires (para escribir, nunca para leer SQL Server)
function localNow() {
  const now = new Date();
  const options = {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  };
  const parts = new Intl.DateTimeFormat('en-CA', options).formatToParts(now);
  const get = (type) => parts.find(p => p.type === type)?.value || '00';
  let h = get('hour');
  if (h === '24') h = '00';
  return `${get('year')}-${get('month')}-${get('day')} ${h}:${get('minute')}:${get('second')}`;
}

function parseCurrency(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number') return value;
  const str = String(value).trim();
  if (!str) return 0;

  if (str.includes('.') && str.includes(',')) {
    if (str.indexOf('.') < str.indexOf(',')) {
      return parseFloat(str.replace(/\./g, '').replace(',', '.')) || 0;
    } else {
      return parseFloat(str.replace(/,/g, '')) || 0;
    }
  }

  if (str.includes(',')) {
    return parseFloat(str.replace(',', '.')) || 0;
  }

  if ((str.match(/\./g) || []).length > 1) {
    return parseFloat(str.replace(/\./g, '')) || 0;
  }

  if (/^\d{1,3}\.\d{3}$/.test(str)) {
    return parseFloat(str.replace(/\./g, '')) || 0;
  }

  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

// Shared queue to serialize order creations and avoid ID collision under concurrent requests
let creationQueue = Promise.resolve();

// Helper to map vendedor names
async function mapVendedorNames(pedidos) {
  try {
    let vendedores = [];
    try {
      const mirrorVendedores = await supabaseService.getRows('atc_sql_vendedores_v');
      if (Array.isArray(mirrorVendedores) && mirrorVendedores.length > 0) {
        vendedores = mirrorVendedores;
      }
    } catch (e) {}

    if (!vendedores || vendedores.length === 0) {
      const withTimeout = (promise, ms, fallback = []) =>
        Promise.race([
          promise,
          new Promise(resolve => setTimeout(() => resolve(fallback), ms))
        ]);
      vendedores = await withTimeout(mssqlService.getVendedores(), 3000, []);
    }

    pedidos.forEach(pedido => {
      const rawId = pedido.Vendedor || pedido['Emitido por'];
      const vdorId = String(rawId || '').trim();
      
      const vdorObj = vendedores.find(v => {
        const sqlVdor = String(v.VDOR || '');
        const sqlAlias = String(v.ALIAS || '').toLowerCase();
        const sqlNombre = String(v.NOMBRE || '').toLowerCase();
        const searchId = vdorId.toLowerCase();

        if (parseInt(sqlVdor) === parseInt(searchId) && !isNaN(parseInt(sqlVdor))) return true;
        if (sqlVdor === searchId) return true;
        if (sqlAlias === searchId) return true;
        if (sqlNombre === searchId) return true;
        return false;
      });
      
      if (vdorObj) {
        pedido.VendedorNombre = vdorObj.NOMBRE;
      } else {
        pedido.VendedorNombre = rawId;
      }
    });
  } catch (err) {
    console.error('Error mapping vendedors:', err.message);
  }
}

function mapDbPedidoToSheetFormat(dbP) {
  return {
    IDPedido: dbP.IDPedido,
    Cliente: dbP.IDCliente ? String(dbP.IDCliente) : '',
    'Cliente en BD?': dbP.Cliente_En_Base ? 'TRUE' : 'FALSE',
    'Fecha y hora': dbP.Fecha_Hora ? formatDate(dbP.Fecha_Hora, 'FULL') : '',
    'Dirección cliente': dbP.Direccion || '',
    Nombre: dbP.Nombre || '',
    'Razón social (NO BD)': '',
    'Celular de contacto': dbP.Celular_Contacto || '',
    'Porcentaje de descuento (%)': dbP.PorcentajeDescuento || 0,
    Observaciones: dbP.Observaciones || '',
    'Emitido por': dbP.Emitido_Por || '',
    'Emitido por con fecha': dbP.Emitido_Por ? `${dbP.Emitido_Por} - ${formatDate(dbP.Fecha_Hora, 'SHORT_WITH_TIME')}` : '',
    'Emitido Fecha': dbP.Fecha_Hora ? formatDate(dbP.Fecha_Hora, 'FULL') : '',
    'Lugar de entrega': dbP.Direccion || '',
    'Fecha de envio': dbP.Fecha_Envio ? formatDate(dbP.Fecha_Envio, 'FULL') : '',
    'Creado por': dbP.Creado_Por || '',
    Total: dbP.Total || 0,
    Fecha_Ultima_Modificacion: dbP.Fecha_Ultima_Modificacion ? formatDate(dbP.Fecha_Ultima_Modificacion, 'FULL') : '',
    'Fecha y Hora de Última Modificación': dbP.Fecha_Ultima_Modificacion ? formatDate(dbP.Fecha_Ultima_Modificacion, 'FULL') : '',
    Estado: dbP.Estado || '1',
    Vendedor: dbP.Vendedor ? String(dbP.Vendedor) : '',
    Nro_PedidoGestion: dbP.Nro_PedidoGestion || '',
    Nro_PedidoReferencia: dbP.Nro_PedidoReferencia || '',
    _source: 'db'
  };
}

function mapDbDetalleToSheetFormat(dbD) {
  const precio = parseCurrency(dbD.Precio);
  const cant = parseCurrency(dbD.Cantidad);
  const descPct = dbD.PORCENT !== undefined && dbD.PORCENT !== null
    ? parseCurrency(dbD.PORCENT)
    : (parseCurrency(dbD.Descuento) <= 100 ? parseCurrency(dbD.Descuento) : 0);
  const subtotal = dbD.Sub_Total ? parseCurrency(dbD.Sub_Total) : (precio * cant);
  const montoDesc = dbD.Descuento !== undefined && dbD.Descuento !== null && parseCurrency(dbD.Descuento) > 100
    ? parseCurrency(dbD.Descuento)
    : (descPct > 0 ? (subtotal * 0.81 * (descPct / 100)) : 0);
  const totalNeto = dbD.Total && dbD.Total !== subtotal ? parseCurrency(dbD.Total) : (subtotal - montoDesc);

  return {
    IDPedido: String(dbD.IDPedido || dbD.IdPedido),
    IDDetalle: String(dbD.IdDetalle || dbD.IDDetalle),
    'Item  codigo': dbD.ItemCodigo ? String(dbD.ItemCodigo) : '',
    'Nombre item': dbD.NombreItem || '',
    'Nombre (más alla de si es item o nombre)': dbD.NombreItem || '',
    'Codigo (más alla de si es item o nombre)': dbD.ItemCodigo ? String(dbD.ItemCodigo) : '',
    Cantidad: cant,
    Descuento: descPct,
    PORCENT: descPct,
    Precio: precio,
    'Cantidad preparada': dbD.CantidadPreparada || 0,
    'Subtotal (precio x cantidad)': subtotal,
    'Monto del descuento': montoDesc,
    'Total (subtotal - monto del descuento)': totalNeto,
    'Stock al momento de cargar': 0,
    Proveedor: '',
    IdRenglonGestion: dbD.IdRenglonGestion || null
  };
}

// GET all pedidos with details
// Server-Side In-Memory Cache configuration
let pedidosCache = null;
let lastCacheFetchTime = 0;
const CACHE_TTL = 30 * 1000; // 30 seconds

function invalidatePedidosCache() {
  pedidosCache = null;
  lastCacheFetchTime = 0;
  supabaseService.clearCache();
  try {
    const tableroRouter = require('./tablero.routes');
    if (tableroRouter && typeof tableroRouter.invalidateCache === 'function') {
      tableroRouter.invalidateCache();
    }
  } catch (err) {
    console.error('Error invalidating tablero cache:', err.message);
  }
}

// Function to fetch and build everything (complete orders with details)
async function getCompletePedidos() {
  const now = Date.now();
  if (pedidosCache && (now - lastCacheFetchTime < CACHE_TTL)) {
    return pedidosCache;
  }

  // Fetch all Supabase App data + Supabase Mirror data in parallel
  const [
    supabasePedidos,
    supabaseDetalles,
    mirrorDbPedidos,
    mirrorDbDetalles,
    mirrorProducts
  ] = await Promise.all([
    supabaseService.getRows('atc_pedidos_v').catch(err => {
      console.error('Error fetching Supabase pedidos:', err.message);
      return [];
    }),
    supabaseService.getRows('atc_detalles_pedidos_v').catch(err => {
      console.error('Error fetching Supabase detalles:', err.message);
      return [];
    }),
    supabaseService.getRows('atc_sql_pedidos_cabe_v').catch(() => []),
    supabaseService.getRows('atc_sql_pedidos_deta_v').catch(() => []),
    supabaseService.getRows('atc_sql_productos_v').catch(() => [])
  ]);

  let dbPedidos = mirrorDbPedidos;
  let dbDetalles = mirrorDbDetalles;
  let sqlProducts = mirrorProducts;

  // Fallback to MSSQL only if mirror views are empty
  if (!dbPedidos || dbPedidos.length === 0) {
    dbPedidos = await mssqlService.getPedidosFromDB().catch(() => []);
  }
  if (!dbDetalles || dbDetalles.length === 0) {
    dbDetalles = await mssqlService.getDetallesFromDB().catch(() => []);
  }
  if (!sqlProducts || sqlProducts.length === 0) {
    sqlProducts = await mssqlService.getProductos().catch(() => []);
  }

  const productProviderMap = new Map();
  const productStockMap = new Map();
  if (Array.isArray(sqlProducts)) {
    sqlProducts.forEach(prod => {
      const key = String(prod.CODART).trim().toLowerCase();
      if (prod.CODART && prod.Proveedor) productProviderMap.set(key, String(prod.Proveedor).trim());
      if (prod.CODART && prod.stock !== undefined) productStockMap.set(key, prod.stock);
    });
  }

  const mappedDbPedidos = Array.isArray(dbPedidos) ? dbPedidos.map(mapDbPedidoToSheetFormat) : [];
  const mappedDbDetalles = Array.isArray(dbDetalles) ? dbDetalles.map(mapDbDetalleToSheetFormat) : [];

  const supabaseDetailsByPedido = {};
  supabaseDetalles.forEach(d => {
    const id = String(d.IDPedido);
    if (!supabaseDetailsByPedido[id]) supabaseDetailsByPedido[id] = [];
    supabaseDetailsByPedido[id].push(d);
  });

  const dbDetailsByPedido = {};
  mappedDbDetalles.forEach(d => {
    const id = String(d.IDPedido);
    if (!dbDetailsByPedido[id]) dbDetailsByPedido[id] = [];
    dbDetailsByPedido[id].push(d);
  });

  const pedidosMap = new Map();

  supabasePedidos.forEach(p => {
    // Formatear fechas de Supabase a la hora local para la correcta visualización
    if (p['Fecha y hora']) p['Fecha y hora'] = formatDate(p['Fecha y hora'], 'FULL');
    if (p['Fecha_Ultima_Modificacion']) p['Fecha_Ultima_Modificacion'] = formatDate(p['Fecha_Ultima_Modificacion'], 'FULL');
    if (p['Fecha y Hora de Última Modificación']) p['Fecha y Hora de Última Modificación'] = formatDate(p['Fecha y Hora de Última Modificación'], 'FULL');
    if (p['Emitido Fecha']) p['Emitido Fecha'] = formatDate(p['Emitido Fecha'], 'FULL');
    if (p['Fecha de envio']) p['Fecha de envio'] = formatDate(p['Fecha de envio'], 'FULL');

    const id = String(p.IDPedido);
    const details = (supabaseDetailsByPedido[id] || []).slice();
    details.sort((a, b) => String(a.IDDetalle || '').localeCompare(String(b.IDDetalle || ''), undefined, { numeric: true }));
    details.forEach(d => {
      const code = String(d['Codigo (más alla de si es item o nombre)'] || d['Item  codigo'] || '').trim().toLowerCase();
      d.Proveedor = productProviderMap.get(code) || '—';
      if (productStockMap.has(code)) d.StockActual = productStockMap.get(code);
    });
    p.detalles = details;
    pedidosMap.set(id, p);
  });

  mappedDbPedidos.forEach(p => {
    const id = String(p.IDPedido);
    const existingSupabaseOrder = pedidosMap.get(id);
    let details = (dbDetailsByPedido[id] || []).slice();
    
    // Si SQL Server no tiene renglones propios pero Supabase sí tiene renglones guardados (ej. pedido editado)
    if ((!details || details.length === 0) && existingSupabaseOrder && existingSupabaseOrder.detalles && existingSupabaseOrder.detalles.length > 0) {
      details = existingSupabaseOrder.detalles;
      if (existingSupabaseOrder.Total !== undefined && existingSupabaseOrder.Total !== null) {
        p.Total = existingSupabaseOrder.Total;
      }
      if (existingSupabaseOrder.Observaciones) {
        p.Observaciones = existingSupabaseOrder.Observaciones;
      }
      if (existingSupabaseOrder['Porcentaje de descuento (%)'] !== undefined) {
        p['Porcentaje de descuento (%)'] = existingSupabaseOrder['Porcentaje de descuento (%)'];
      }
    } else if ((!details || details.length === 0) && supabaseDetailsByPedido[id] && supabaseDetailsByPedido[id].length > 0) {
      details = (supabaseDetailsByPedido[id] || []).slice();
    }

    details.sort((a, b) => String(a.IDDetalle || '').localeCompare(String(b.IDDetalle || ''), undefined, { numeric: true }));
    details.forEach(d => {
      const code = String(d['Codigo (más alla de si es item o nombre)'] || d['Item  codigo'] || '').trim().toLowerCase();
      d.Proveedor = productProviderMap.get(code) || '—';
      if (productStockMap.has(code)) d.StockActual = productStockMap.get(code);
    });
    p.detalles = details;
    pedidosMap.set(id, p);
  });

  const finalPedidos = Array.from(pedidosMap.values());
  await mapVendedorNames(finalPedidos);
  finalPedidos.sort((a, b) => (parseInt(b.IDPedido) || 0) - (parseInt(a.IDPedido) || 0));

  pedidosCache = finalPedidos;
  lastCacheFetchTime = Date.now();
  return finalPedidos;
}

// GET all pedidos (lightweight header list by default for ultra-fast boot)
router.get('/', async (req, res, next) => {
  try {
    const finalPedidos = await getCompletePedidos();
    if (req.query.includeDetails === 'true') {
      return res.json(finalPedidos);
    }
    
    // Light mapping
    const lightPedidos = finalPedidos.map(p => ({
      IDPedido: p.IDPedido,
      Cliente: p.Cliente,
      'Cliente en BD?': p['Cliente en BD?'],
      'Fecha y hora': p['Fecha y hora'],
      'Dirección cliente': p['Dirección cliente'],
      Nombre: p.Nombre,
      'Razón social (NO BD)': p['Razón social (NO BD)'],
      'Celular de contacto': p['Celular de contacto'],
      'Porcentaje de descuento (%)': p['Porcentaje de descuento (%)'],
      Observaciones: p.Observaciones,
      'Emitido por': p['Emitido por'],
      'Emitido por con fecha': p['Emitido por con fecha'],
      'Emitido Fecha': p['Emitido Fecha'],
      Fecha_Ultima_Modificacion: p.Fecha_Ultima_Modificacion,
      'Lugar de entrega': p['Lugar de entrega'],
      Total: p.Total,
      Estado: p.Estado,
      Vendedor: p.Vendedor,
      VendedorNombre: p.VendedorNombre,
      Nro_PedidoGestion: p.Nro_PedidoGestion,
      Nro_PedidoReferencia: p.Nro_PedidoReferencia,
      detalles: []
    }));

    res.json(lightPedidos);
  } catch (error) {
    next(error);
  }
});

// POST /details-batch - fetch details for specific order IDs
router.post('/details-batch', async (req, res, next) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.json({});
    }
    const finalPedidos = await getCompletePedidos();
    const result = {};
    ids.forEach(id => {
      const p = finalPedidos.find(x => String(x.IDPedido) === String(id));
      let details = p ? (p.detalles || []) : [];
      if ((!details || details.length === 0) && p && p.Nro_PedidoReferencia) {
        const baseOrder = finalPedidos.find(x => String(x.IDPedido) === String(p.Nro_PedidoReferencia));
        if (baseOrder && baseOrder.detalles && baseOrder.detalles.length > 0) {
          details = baseOrder.detalles;
        }
      }
      result[id] = details;
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// GET single pedido by ID
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const finalPedidos = await getCompletePedidos();
    const p = finalPedidos.find(x => String(x.IDPedido) === String(id));
    if (!p) {
      return res.status(404).json({ message: 'Pedido no encontrado' });
    }
    let details = p.detalles || [];
    if ((!details || details.length === 0) && p.Nro_PedidoReferencia) {
      const baseOrder = finalPedidos.find(x => String(x.IDPedido) === String(p.Nro_PedidoReferencia));
      if (baseOrder && baseOrder.detalles && baseOrder.detalles.length > 0) {
        details = baseOrder.detalles;
      }
    }
    res.json({ ...p, detalles: details });
  } catch (error) {
    next(error);
  }
});


// POST new pedido
router.post('/', (req, res, next) => {
  creationQueue = creationQueue.then(async () => {
    try {
      const { header, detalles } = req.body;
      
      // 1. Get current IDs to generate new one
      const existingPedidos = await supabaseService.getRows('atc_pedidos_v');
      let maxId = 0;
      if (existingPedidos.length > 0) {
        const ids = existingPedidos
          .map(p => parseInt(p.IDPedido))
          .filter(id => !isNaN(id) && id < 1000000);
        maxId = Math.max(...ids, 0);
      }
      const newId = maxId < 110000 ? 110000 : maxId + 1;
      
      const now = new Date();
      const emitidoPor = header['Emitido por'] || 'Admin';

      let vdorFinal = header.Vendedor;
      if (isNaN(parseInt(vdorFinal)) && vdorFinal) {
        try {
          const vendedores = await mssqlService.getVendedores();
          const found = vendedores.find(v => v.NOMBRE && v.NOMBRE.toLowerCase().includes(String(vdorFinal).toLowerCase()));
          if (found) vdorFinal = found.VDOR || found.NRO_VENDEDOR;
        } catch (e) { console.error('Error mapping vdor name to id:', e); }
      }

      const pedidoData = {
        IDPedido: newId,
        'Cliente': header.Cliente,
        'Cliente en BD?': 'TRUE',
        'Fecha y hora': now.toISOString(),
        'Dirección cliente': header['Lugar de entrega'],
        'Nombre': header.Nombre,
        'Razón social (NO BD)': '',
        'Celular de contacto': header.Celular,
        'Porcentaje de descuento (%)': header.Descuento || 0,
        'Observaciones': header.Observaciones || '',
        'Emitido por': emitidoPor,
        'Emitido por con fecha': `${emitidoPor} - ${formatDate(now.toISOString(), 'SHORT_WITH_TIME')}`,
        'Emitido Fecha': now.toISOString(),
        'Lugar de entrega': header['Lugar de entrega'],
        'Deposito que prepara': '',
        'Creado por': emitidoPor,
        'Total': header.Total || 0,
        'Fecha_Ultima_Modificacion': now.toISOString(),
        'Fecha y Hora de Última Modificación': now.toISOString(),
        'Estado': header.Estado || '0',
        'Vendedor': vdorFinal || ''
      };
      
      await supabaseService.upsertRow('atc_pedidos_v', pedidoData);
      
      const headerDescPct = parseCurrency(header.Descuento || header['Porcentaje de descuento (%)'] || 19);
      const generalMultiplier = Math.max(0, 1 - (headerDescPct / 100));

      const detailObjects = (detalles || []).map((item, idx) => {
        const precio = parseCurrency(item.Precio);
        const cant = parseCurrency(item.Cantidad);
        const descPct = parseCurrency(item.Descuento !== undefined && item.Descuento !== null ? item.Descuento : item.PORCENT);
        const subtotal = precio * cant;
        const baseConDescGeneral = subtotal * generalMultiplier;
        const montoDesc = descPct > 0 ? (baseConDescGeneral * (descPct / 100)) : 0;
        const totalNetoItem = subtotal - montoDesc;
        const seq = String(idx + 1).padStart(3, '0');
        
        return {
          IDPedido: newId,
          IDDetalle: `${newId}${seq}`,
          'Codigo (más alla de si es item o nombre)': item['Codigo (más alla de si es item o nombre)'] || item['Item  codigo'] || '',
          'Nombre (más alla de si es item o nombre)': item['Nombre (más alla de si es item o nombre)'] || item['Nombre item'] || '',
          'Item  codigo': item['Codigo (más alla de si es item o nombre)'] || item['Item  codigo'] || '',
          'Nombre item': item['Nombre (más alla de si es item o nombre)'] || item['Nombre item'] || '',
          'Cantidad': cant,
          'Descuento': descPct,
          'Precio': precio,
          'Subtotal (precio x cantidad)': subtotal,
          'Monto del descuento': montoDesc,
          'Total (subtotal - monto del descuento)': totalNetoItem,
          'Stock al momento de cargar': parseCurrency(item.StockAvailable),
          'Proveedor': item.Proveedor || '',
          PORCENT: descPct
        };
      });

      if (detailObjects.length > 0) {
        try {
          await supabaseService.insertRows('atc_detalles_pedidos_v', detailObjects);
        } catch (detailErr) {
          console.error('Error inserting details into Supabase, rolling back order header:', detailErr);
          await supabaseService.deleteRows('atc_pedidos_v', { IDPedido: newId }).catch(() => {});
          throw detailErr;
        }
      }

      if (pedidoData.Estado === '1' || pedidoData.Estado === '1.' || pedidoData.Estado === '0.0.99') {
        await syncService.queueOutboundOrder(newId, 'INSERT_OR_UPDATE', pedidoData, detailObjects, pedidoData.Estado);
      }

      invalidatePedidosCache();
      res.status(201).json({ IDPedido: newId, message: 'Pedido creado exitosamente' });
    } catch (error) {
      console.error('Error creating pedido:', error);
      next(error);
    }
  }).catch(err => {
    console.error('Queue fatal error:', err);
  });
});

async function withRetry(fn, retries = 2, delayMs = 500, exponential = false) {
  let lastError;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const currentDelay = exponential ? delayMs * Math.pow(2, attempt - 1) : delayMs;
      console.warn(`[RETRY] Attempt ${attempt}/${retries + 1} failed: ${err.message}. Retrying in ${currentDelay}ms...`);
      if (attempt <= retries) {
        await new Promise(res => setTimeout(res, currentDelay));
      }
    }
  }
  throw lastError;
}

// PATCH update pedido estado
router.patch('/:id/estado', async (req, res, next) => {
  try {
    const pedidoId = req.params.id;
    const { estado } = req.body;
    const now = new Date();
    const cleanStatus = String(estado).trim();
    
    // Check if it exists in mirror or DB
    const mirrorPedidos = await supabaseService.getRows('atc_sql_pedidos_cabe_v').catch(() => []);
    const existsInMirror = mirrorPedidos.some(p => String(p.IDPedido) === String(pedidoId));
    
    if (existsInMirror) {
      // Update mirror in Supabase
      await supabaseService.updateRows('atc_sql_pedidos_cabe_v', { IDPedido: parseInt(pedidoId) }, {
        Estado: cleanStatus,
        Fecha_Ultima_Modificacion: now.toISOString()
      }).catch(() => {});
      
      // Update in App Pedidos if present
      await supabaseService.updateRows('atc_pedidos_v', { IDPedido: pedidoId }, {
        Estado: cleanStatus,
        Fecha_Ultima_Modificacion: now.toISOString()
      }).catch(() => {});

      // Enqueue outbound sync to SQL Server
      await syncService.queueOutboundOrder(pedidoId, 'UPDATE_ESTADO', null, null, cleanStatus);
      invalidatePedidosCache();
      return res.json({ message: 'Estado del pedido actualizado y sincronizado exitosamente', newStatus: cleanStatus });
    }
    
    // Draft in Supabase (atc_pedidos_v)
    const supabasePedidos = await supabaseService.getRows('atc_pedidos_v');
    const pedidoObj = supabasePedidos.find(p => String(p.IDPedido) === String(pedidoId));
    
    if (!pedidoObj) return res.status(404).json({ message: 'Pedido no encontrado en Supabase' });
    
    pedidoObj.Estado = cleanStatus;
    pedidoObj.Fecha_Ultima_Modificacion = now.toISOString();
    
    let detalles = [];
    if (cleanStatus === '1' || cleanStatus === '1.' || cleanStatus === '0.0.99') {
      let allDetalles = await supabaseService.getRows('atc_detalles_pedidos_v');
      detalles = allDetalles.filter(d => String(d.IDPedido) === String(pedidoId));
      
      // Auto-recovery: If Supabase has 0 details but client payload provided details, auto-persist to Supabase first!
      if ((!detalles || detalles.length === 0) && req.body.detalles && req.body.detalles.length > 0) {
        console.log(`[AUTO-RECOVERY] Auto-persisting ${req.body.detalles.length} details to Supabase for IDPedido ${pedidoId}`);
        const headerDescPct = parseCurrency(pedidoObj['Porcentaje de descuento (%)'] || pedidoObj.PorcentajeDescuento || 19);
        const generalMultiplier = Math.max(0, 1 - (headerDescPct / 100));

        const sanitizedDetails = req.body.detalles.map((item, idx) => {
          const precio = parseCurrency(item.Precio);
          const cant = parseCurrency(item.Cantidad);
          const descPct = parseCurrency(item.Descuento !== undefined && item.Descuento !== null ? item.Descuento : item.PORCENT);
          const subtotal = precio * cant;
          const baseConDescGeneral = subtotal * generalMultiplier;
          const montoDesc = descPct > 0 ? (baseConDescGeneral * (descPct / 100)) : 0;
          const totalNetoItem = subtotal - montoDesc;
          const seq = String(idx + 1).padStart(3, '0');
          
          return {
            IDPedido: pedidoId,
            IDDetalle: `${pedidoId}${seq}`,
            'Codigo (más alla de si es item o nombre)': item['Codigo (más alla de si es item o nombre)'] || item['Item  codigo'] || item.CODART || '',
            'Nombre (más alla de si es item o nombre)': item['Nombre (más alla de si es item o nombre)'] || item['Nombre item'] || item.DESCRI || '',
            'Item  codigo': item['Codigo (más alla de si es item o nombre)'] || item['Item  codigo'] || item.CODART || '',
            'Nombre item': item['Nombre (más alla de si es item o nombre)'] || item['Nombre item'] || item.DESCRI || '',
            'Cantidad': cant,
            'Descuento': descPct,
            'Precio': precio,
            'Subtotal (precio x cantidad)': subtotal,
            'Monto del descuento': montoDesc,
            'Total (subtotal - monto del descuento)': totalNetoItem,
            'Stock al momento de cargar': parseCurrency(item.StockAvailable || item.StockActual),
            'Proveedor': item.Proveedor || '',
            PORCENT: descPct
          };
        });
        
        await supabaseService.insertRows('atc_detalles_pedidos_v', sanitizedDetails).catch(err => {
          console.error('Error in auto-persisting details during status change:', err.message);
        });
        detalles = sanitizedDetails;
      }

      if (!detalles || detalles.length === 0) {
        return res.status(400).json({ message: 'No se puede enviar un pedido sin detalles a la base de datos' });
      }
      
      // Enqueue outbound insert/update to SQL Server
      await syncService.queueOutboundOrder(pedidoId, 'INSERT_OR_UPDATE', pedidoObj, detalles, cleanStatus);
    }
    
    await supabaseService.updateRows('atc_pedidos_v', { IDPedido: pedidoId }, {
      Estado: cleanStatus,
      Fecha_Ultima_Modificacion: now.toISOString()
    });
    
    invalidatePedidosCache();
    res.json({ message: 'Estado actualizado exitosamente en Supabase y encolado para Base de Datos', newStatus: cleanStatus });
  } catch (error) {
    next(error);
  }
});

// DELETE pedido permanently
router.delete('/:id', async (req, res, next) => {
  try {
    const pedidoId = req.params.id;
    
    const mirrorPedidos = await supabaseService.getRows('atc_sql_pedidos_cabe_v').catch(() => []);
    const mirrorPedido = mirrorPedidos.find(p => String(p.IDPedido) === String(pedidoId));
    
    if (mirrorPedido) {
      const state = String(mirrorPedido.Estado || '').trim();
      if (state === '0.0') {
        await syncService.queueOutboundOrder(pedidoId, 'UPDATE_ESTADO', null, null, '0.0.99');
        await supabaseService.updateRows('atc_sql_pedidos_cabe_v', { IDPedido: parseInt(pedidoId) }, { Estado: '0.0.99' }).catch(() => {});
        await supabaseService.updateRows('atc_pedidos_v', { IDPedido: pedidoId }, { Estado: '0.0.99' }).catch(() => {});
        invalidatePedidosCache();
        return res.json({ message: 'Pedido de sistema anulado correctamente' });
      } else {
        await syncService.queueOutboundOrder(pedidoId, 'DELETE');
        await supabaseService.deleteRows('atc_sql_pedidos_deta_v', { IdPedido: parseInt(pedidoId) }).catch(() => {});
        await supabaseService.deleteRows('atc_sql_pedidos_cabe_v', { IDPedido: parseInt(pedidoId) }).catch(() => {});
      }
    }
    
    await supabaseService.deleteRows('atc_detalles_pedidos_v', { IDPedido: pedidoId });
    await supabaseService.deleteRows('atc_pedidos_v', { IDPedido: pedidoId });
    
    invalidatePedidosCache();
    res.json({ message: 'Pedido eliminado exitosamente' });
  } catch (error) {
    console.error('Error deleting pedido:', error);
    next(error);
  }
});

// PUT update pedido
router.put('/:id', async (req, res, next) => {
  try {
    const pedidoId = req.params.id;
    const { header, detalles } = req.body;
    const now = new Date();
    
    const mirrorPedidos = await supabaseService.getRows('atc_sql_pedidos_cabe_v').catch(() => []);
    let mirrorPedido = mirrorPedidos.find(p => String(p.IDPedido) === String(pedidoId));
    if (!mirrorPedido) {
      const dbPedidos = await mssqlService.getPedidosFromDB().catch(() => []);
      mirrorPedido = dbPedidos.find(p => String(p.IDPedido) === String(pedidoId));
    }
    
    const headerDescPct = parseCurrency(header.Descuento || header['Porcentaje de descuento (%)'] || (mirrorPedido ? mirrorPedido.PorcentajeDescuento : 19) || 19);
    const generalMultiplier = Math.max(0, 1 - (headerDescPct / 100));

    const newDetailRows = (detalles || []).map((item, idx) => {
      const precio = parseCurrency(item.Precio);
      const cant = parseCurrency(item.Cantidad);
      const descPct = parseCurrency(item.Descuento !== undefined && item.Descuento !== null ? item.Descuento : item.PORCENT);
      const subtotal = precio * cant;
      const baseConDescGeneral = subtotal * generalMultiplier;
      const montoDesc = descPct > 0 ? (baseConDescGeneral * (descPct / 100)) : 0;
      const totalNetoItem = subtotal - montoDesc;
      const seq = String(idx + 1).padStart(3, '0');
      
      return {
        IDPedido: pedidoId,
        IDDetalle: `${pedidoId}${seq}`,
        'Codigo (más alla de si es item o nombre)': item['Codigo (más alla de si es item o nombre)'] || item['Item  codigo'] || '',
        'Nombre (más alla de si es item o nombre)': item['Nombre (más alla de si es item o nombre)'] || item['Nombre item'] || '',
        'Item  codigo': item['Codigo (más alla de si es item o nombre)'] || item['Item  codigo'] || '',
        'Nombre item': item['Nombre (más alla de si es item o nombre)'] || item['Nombre item'] || '',
        'Cantidad': cant,
        'Descuento': descPct,
        'Precio': precio,
        'Subtotal (precio x cantidad)': subtotal,
        'Monto del descuento': montoDesc,
        'Total (subtotal - monto del descuento)': totalNetoItem,
        'Stock al momento de cargar': parseCurrency(item.StockAvailable || item['Stock al momento de cargar']),
        'Proveedor': item.Proveedor || '',
        PORCENT: descPct,
        CantidadPreparada: parseCurrency(item['Cantidad preparada'] || item.CantidadPreparada),
        IdRenglonGestion: item.IdRenglonGestion || null
      };
    });
    
    const existingPedidos = await supabaseService.getRows('atc_pedidos_v').catch(() => []);
    const existingPedido = existingPedidos.find(p => String(p.IDPedido) === String(pedidoId));
    
    if (!mirrorPedido && !existingPedido) {
      return res.status(404).json({ message: 'Pedido no encontrado' });
    }
    
    const validColumns = new Set([
      'IDPedido', 'Cliente', 'Cliente en BD?', 'Fecha y hora', 'Dirección cliente',
      'Nombre', 'Razón social (NO BD)', 'Celular de contacto', 'Porcentaje de descuento (%)',
      'Observaciones', 'Emitido por', 'Emitido por con fecha', 'Emitido Fecha',
      'Lugar de entrega', 'Deposito que prepara', 'Fecha de envio', 'Fecha de envío',
      'Creado por', 'Total', 'Fecha_Ultima_Modificacion', 'Fecha y Hora de Última Modificación',
      'Estado', 'Vendedor', 'Nro_PedidoGestion', 'Nro_PedidoReferencia'
    ]);

    const baseSource = existingPedido || (mirrorPedido ? mapDbPedidoToSheetFormat(mirrorPedido) : {});
    const rawUpdated = {
      ...baseSource,
      ...header,
      IDPedido: pedidoId,
      'Fecha_Ultima_Modificacion': now.toISOString()
    };

    const updatedPedido = {};
    Object.keys(rawUpdated).forEach(k => {
      if (validColumns.has(k)) {
        updatedPedido[k] = rawUpdated[k];
      }
    });

    if (mirrorPedido) {
      await withRetry(() => mssqlService.updatePedidoInDB(pedidoId, updatedPedido, newDetailRows)).catch(() => {});
    }

    if (existingPedido) {
      await supabaseService.updateRows('atc_pedidos_v', { IDPedido: pedidoId }, updatedPedido);
    } else {
      await supabaseService.insertRows('atc_pedidos_v', [updatedPedido]);
    }

    await supabaseService.deleteRows('atc_detalles_pedidos_v', { IDPedido: pedidoId });
    if (newDetailRows.length > 0) {
      const validDetailColumns = new Set([
        'IDDetalle', 'IDPedido', 'Codigo (más alla de si es item o nombre)',
        'Nombre (más alla de si es item o nombre)', 'Item  codigo', 'Nombre item',
        'Cantidad', 'Descuento', 'Precio', 'Subtotal (precio x cantidad)',
        'Monto del descuento', 'Total (subtotal - monto del descuento)',
        'Stock al momento de cargar', 'Proveedor'
      ]);
      const sanitizedDetails = newDetailRows.map(row => {
        const clean = {};
        Object.keys(row).forEach(k => {
          if (validDetailColumns.has(k)) clean[k] = row[k];
        });
        return clean;
      });
      await supabaseService.insertRows('atc_detalles_pedidos_v', sanitizedDetails);
    }
    
    // Enqueue outbound update to SQL Server
    await syncService.queueOutboundOrder(pedidoId, 'INSERT_OR_UPDATE', updatedPedido, newDetailRows, updatedPedido.Estado);

    invalidatePedidosCache();
    res.json({ message: 'Pedido actualizado exitosamente' });
  } catch (error) {
    console.error('Error updating pedido:', error);
    next(error);
  }
});

// Automatic server background warmup on boot
setTimeout(() => {
  console.log('[WARMUP] Starting initial background cache warmup for pedidos...');
  getCompletePedidos()
    .then(data => {
      console.log(`[WARMUP] Cache warmup complete! ${data.length} pedidos ready in memory.`);
    })
    .catch(err => {
      console.error('[WARMUP] Error preloading cache on startup:', err.message);
    });
}, 1000);

module.exports = router;
module.exports.formatDate = formatDate;
module.exports.invalidatePedidosCache = invalidatePedidosCache;
