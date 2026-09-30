const mssqlService = require('./mssql.service');
const supabaseService = require('./supabase.service');

const CHUNK_SIZE = 200;

// Helper to chunk arrays for batch upserts in Supabase
function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

let isSyncing = false;
let lastSyncResult = {
  success: null,
  timestamp: null,
  clientes: 0,
  productos: 0,
  vendedores: 0,
  pedidosCabe: 0,
  pedidosDeta: 0,
  error: null
};

/**
 * Sincroniza el catálogo completo y pedidos de SQL Server (San Juan) hacia las tablas espejo en Supabase
 */
async function syncFromSqlToSupabase(force = false) {
  if (isSyncing) {
    console.log('⏳ Sincronización SQL ➔ Supabase ya en curso, omitiendo ejecución redundante.');
    return { status: 'already_running', ...lastSyncResult };
  }

  isSyncing = true;
  console.log('🔄 Iniciando sincronización SQL Server ➔ Supabase (Tablas Espejo)...');
  const startTime = Date.now();

  try {
    // 1. Clientes
    let clientesCount = 0;
    try {
      const clientes = await mssqlService.getClientes();
      if (Array.isArray(clientes) && clientes.length > 0) {
        const mappedClientes = clientes.map(c => ({
          nro_cliente: c.NRO_CLIENTE,
          nombre_cliente: c.NOMBRE_CLIENTE,
          cuit: c.CUIT,
          saldo: c.SALDO !== undefined && c.SALDO !== null ? Number(c.SALDO) : 0,
          vendedor: c.VENDEDOR,
          nro_vendedor: c.NRO_VENDEDOR !== undefined && c.NRO_VENDEDOR !== null ? Number(c.NRO_VENDEDOR) : null,
          localidad: c.LOCALIDAD,
          provincia: c.PROVINCIA,
          telefono: c.TELE,
          suc: c.SUC !== undefined && c.SUC !== null ? Number(c.SUC) : null,
          direc: c.DIREC || null,
          synced_at: new Date().toISOString()
        }));

        const chunks = chunkArray(mappedClientes, CHUNK_SIZE);
        for (const chunk of chunks) {
          const { error } = await supabaseService.supabase.rpc('sync_bulk_clientes', { payload: chunk });
          if (error) throw error;
        }
        clientesCount = clientes.length;
        console.log(`✅ Sincronizados ${clientesCount} clientes en atc_migración.sql_clientes`);
      }
    } catch (err) {
      console.warn('⚠️ No se pudieron sincronizar clientes desde SQL Server:', err.message);
    }

    // 2. Productos
    let productosCount = 0;
    try {
      const productos = await mssqlService.getProductos();
      if (Array.isArray(productos) && productos.length > 0) {
        const mappedProductos = productos.map(p => ({
          codart: p.CODART,
          descri: p.DESCRI,
          cc_civa: p.CC_CIVA !== undefined && p.CC_CIVA !== null ? Number(p.CC_CIVA) : null,
          stock: p.stock !== undefined && p.stock !== null ? Number(p.stock) : 0,
          familia: p.FAMILIA !== undefined && p.FAMILIA !== null ? Number(p.FAMILIA) : null,
          nombre_familia: p.NombreFamilia || null,
          rubro: p.RUBRO !== undefined && p.RUBRO !== null ? Number(p.RUBRO) : null,
          nombre_rubro: p.NombreRubro || null,
          marca: p.MARCA !== undefined && p.MARCA !== null ? Number(p.MARCA) : null,
          nombre_marca: p.NombreMarca || null,
          embalaje: p.Embalaje != null ? String(p.Embalaje) : null,
          proveedor: p.Proveedor || null,
          synced_at: new Date().toISOString()
        }));

        const chunks = chunkArray(mappedProductos, CHUNK_SIZE);
        for (const chunk of chunks) {
          const { error } = await supabaseService.supabase.rpc('sync_bulk_productos', { payload: chunk });
          if (error) throw error;
        }
        productosCount = productos.length;
        console.log(`✅ Sincronizados ${productosCount} productos en atc_migración.sql_productos`);
      }
    } catch (err) {
      console.warn('⚠️ No se pudieron sincronizar productos desde SQL Server:', err.message);
    }

    // 3. Vendedores
    let vendedoresCount = 0;
    try {
      const vendedores = await mssqlService.getVendedores();
      if (Array.isArray(vendedores) && vendedores.length > 0) {
        const mappedVendedores = vendedores.map(v => ({
          nro_vendedor: v.NRO_VENDEDOR || v.VDOR,
          nombre: v.NOMBRE,
          alias: v.ALIAS,
          vdor: v.VDOR !== undefined && v.VDOR !== null ? Number(v.VDOR) : (v.NRO_VENDEDOR || null),
          activo: v.ACTIVO !== undefined && v.ACTIVO !== null ? Number(v.ACTIVO) : 1,
          synced_at: new Date().toISOString()
        }));

        const { error } = await supabaseService.supabase.rpc('sync_bulk_vendedores', { payload: mappedVendedores });
        if (error) throw error;
        vendedoresCount = vendedores.length;
        console.log(`✅ Sincronizados ${vendedoresCount} vendedores en atc_migración.sql_vendedores`);
      }
    } catch (err) {
      console.warn('⚠️ No se pudieron sincronizar vendedores desde SQL Server:', err.message);
    }

    // 4. Pedidos Cabecera desde SQL Server (AppTransacciones.PedidoAppCabe)
    let pedidosCabeCount = 0;
    try {
      const dbPedidos = await mssqlService.getPedidosFromDB();
      if (Array.isArray(dbPedidos) && dbPedidos.length > 0) {
        const mappedPedidos = dbPedidos.map(p => ({
          id_pedido: p.IDPedido,
          cliente: p.IDCliente != null ? String(p.IDCliente) : (p.Cliente != null ? String(p.Cliente) : null),
          fecha_hora: p.Fecha_Hora ? new Date(p.Fecha_Hora).toISOString() : null,
          direccion: p.Direccion || null,
          creado_por: p.Creado_Por || null,
          observaciones: p.Observaciones || null,
          fecha_ultima_modificacion: p.Fecha_Ultima_Modificacion ? new Date(p.Fecha_Ultima_Modificacion).toISOString() : null,
          estado: p.Estado != null ? String(p.Estado) : '1',
          vendedor: p.Vendedor != null ? String(p.Vendedor) : null,
          nro_pedidogestion: p.Nro_PedidoGestion != null ? String(p.Nro_PedidoGestion) : null,
          nro_pedidoreferencia: p.Nro_PedidoReferencia != null ? String(p.Nro_PedidoReferencia) : null,
          estado_enviado: p.EstadoEnviado ? 1 : 0,
          total: p.Total !== undefined && p.Total !== null ? Number(p.Total) : 0,
          synced_at: new Date().toISOString()
        }));

        const chunks = chunkArray(mappedPedidos, CHUNK_SIZE);
        for (const chunk of chunks) {
          const { error } = await supabaseService.supabase.rpc('sync_bulk_pedidos_cabe', { payload: chunk });
          if (error) throw error;
        }
        pedidosCabeCount = dbPedidos.length;
        console.log(`✅ Sincronizados ${pedidosCabeCount} pedidos en atc_migración.sql_pedidos_cabe`);
      }
    } catch (err) {
      console.warn('⚠️ No se pudieron sincronizar pedidos cabecera desde SQL Server:', err.message);
    }

    // 5. Pedidos Detalle desde SQL Server (AppTransacciones.PedidoAppDeta)
    let pedidosDetaCount = 0;
    try {
      const dbDetalles = await mssqlService.getDetallesFromDB();
      if (Array.isArray(dbDetalles) && dbDetalles.length > 0) {
        const mappedDetalles = dbDetalles.map(d => ({
          id_detalle: String(d.IdDetalle || `${d.IdPedido}_${d.ItemCodigo}_${Math.random()}`),
          id_pedido: Number(d.IdPedido),
          item_codigo: d.ItemCodigo != null ? String(d.ItemCodigo) : null,
          nombre_item: d.NombreItem || null,
          cantidad: d.Cantidad !== undefined && d.Cantidad !== null ? Number(d.Cantidad) : 0,
          descuento: d.Descuento !== undefined && d.Descuento !== null ? Number(d.Descuento) : 0,
          porcent: d.PORCENT !== undefined && d.PORCENT !== null ? Number(d.PORCENT) : (d.porcent !== undefined ? Number(d.porcent) : 0),
          precio: d.Precio !== undefined && d.Precio !== null ? Number(d.Precio) : 0,
          sub_total: d.Sub_Total !== undefined && d.Sub_Total !== null ? Number(d.Sub_Total) : 0,
          total: d.Total !== undefined && d.Total !== null ? Number(d.Total) : 0,
          cantidad_preparada: d.CantidadPreparada !== undefined && d.CantidadPreparada !== null ? Number(d.CantidadPreparada) : 0,
          id_renglon_gestion: d.IdRenglonGestion != null ? String(d.IdRenglonGestion) : null,
          synced_at: new Date().toISOString()
        }));

        const chunks = chunkArray(mappedDetalles, CHUNK_SIZE);
        for (const chunk of chunks) {
          const { error } = await supabaseService.supabase.rpc('sync_bulk_pedidos_deta', { payload: chunk });
          if (error) throw error;
        }
        pedidosDetaCount = dbDetalles.length;
        console.log(`✅ Sincronizados ${pedidosDetaCount} renglones de pedidos en atc_migración.sql_pedidos_deta`);
      }
    } catch (err) {
      console.warn('⚠️ No se pudieron sincronizar detalles de pedidos desde SQL Server:', err.message);
    }

    // Procesar también la cola de salida hacia SQL Server si hay pedidos pendientes
    await processOutboundQueue().catch(err => {
      console.warn('⚠️ Error procesando cola de salida:', err.message);
    });

    const elapsed = Date.now() - startTime;
    lastSyncResult = {
      success: true,
      timestamp: new Date().toISOString(),
      durationMs: elapsed,
      clientes: clientesCount,
      productos: productosCount,
      vendedores: vendedoresCount,
      pedidosCabe: pedidosCabeCount,
      pedidosDeta: pedidosDetaCount,
      error: null
    };

    console.log(`✨ Sincronización finalizada con éxito en ${elapsed}ms`);
    return lastSyncResult;
  } catch (globalErr) {
    console.error('❌ Error en sincronización SQL ➔ Supabase:', globalErr.message);
    lastSyncResult = {
      success: false,
      timestamp: new Date().toISOString(),
      error: globalErr.message
    };
    return lastSyncResult;
  } finally {
    isSyncing = false;
  }
}

/**
 * Agrega un pedido a la cola buffer para impactar en SQL Server
 */
async function queueOutboundOrder(idPedido, accion = 'INSERT_OR_UPDATE', payloadPedido = null, payloadDetalles = null, nuevoEstado = null) {
  try {
    const queueItem = {
      id_pedido: parseInt(idPedido, 10),
      accion,
      nuevo_estado: nuevoEstado ? String(nuevoEstado).trim() : null,
      payload_pedido: payloadPedido,
      payload_detalles: payloadDetalles,
      status: 'PENDIENTE',
      intentos: 0,
      ultimo_error: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabaseService.supabase
      .from('atc_sync_cola_pedidos_v')
      .insert([queueItem])
      .select();

    if (error) {
      console.error('❌ Error encolando pedido para SQL Server:', error.message);
      return null;
    }

    console.log(`📥 Pedido ${idPedido} encolado para sincronizar con SQL Server (Acción: ${accion})`);
    
    // Disparar procesamiento asíncrono sin bloquear
    setImmediate(() => {
      processOutboundQueue().catch(() => {});
    });

    return data ? data[0] : queueItem;
  } catch (err) {
    console.error('❌ Error en queueOutboundOrder:', err.message);
    return null;
  }
}

/**
 * Procesa la cola buffer de salida (Supabase ➔ SQL Server)
 */
async function processOutboundQueue() {
  try {
    const { data: pendingItems, error } = await supabaseService.supabase
      .from('atc_sync_cola_pedidos_v')
      .select('*')
      .eq('status', 'PENDIENTE')
      .order('id', { ascending: true })
      .limit(20);

    if (error || !Array.isArray(pendingItems) || pendingItems.length === 0) {
      return;
    }

    console.log(`📤 Procesando ${pendingItems.length} pedidos pendientes en la cola hacia SQL Server...`);

    for (const item of pendingItems) {
      try {
        let ok = false;
        if (item.accion === 'INSERT_OR_UPDATE') {
          ok = await mssqlService.createPedidoInDB(item.payload_pedido, item.payload_detalles);
        } else if (item.accion === 'UPDATE_ESTADO') {
          ok = await mssqlService.updatePedidoEstadoInDB(item.id_pedido, item.nuevo_estado);
        } else if (item.accion === 'DELETE') {
          ok = await mssqlService.deletePedidoFromDB(item.id_pedido);
        }

        if (ok) {
          await supabaseService.supabase
            .from('atc_sync_cola_pedidos_v')
            .update({
              status: 'SINCRONIZADO',
              synced_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq('id', item.id);
          console.log(`✅ Pedido ${item.id_pedido} impactado en SQL Server con éxito.`);
        } else {
          await supabaseService.supabase
            .from('atc_sync_cola_pedidos_v')
            .update({
              intentos: (item.intentos || 0) + 1,
              ultimo_error: 'SQL Server no disponible o falló la transacción',
              updated_at: new Date().toISOString()
            })
            .eq('id', item.id);
        }
      } catch (itemErr) {
        console.warn(`⚠️ Fallo al procesar pedido ${item.id_pedido} de la cola:`, itemErr.message);
        await supabaseService.supabase
          .from('atc_sync_cola_pedidos_v')
          .update({
            intentos: (item.intentos || 0) + 1,
            ultimo_error: itemErr.message,
            updated_at: new Date().toISOString()
          })
          .eq('id', item.id);
      }
    }
  } catch (err) {
    console.warn('⚠️ Error en processOutboundQueue:', err.message);
  }
}

// Iniciar sincronización periódica cada 20 minutos
let syncInterval = null;
function startPeriodicSync(intervalMinutes = 20) {
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = setInterval(() => {
    syncFromSqlToSupabase().catch(() => {});
  }, intervalMinutes * 60 * 1000);
  
  // Ejecución inicial diferida en segundo plano
  setTimeout(() => {
    syncFromSqlToSupabase().catch(() => {});
  }, 3000);
}

module.exports = {
  syncFromSqlToSupabase,
  queueOutboundOrder,
  processOutboundQueue,
  startPeriodicSync,
  getLastSyncResult: () => lastSyncResult
};
