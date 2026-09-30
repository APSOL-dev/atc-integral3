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
        const chunks = chunkArray(clientes, CHUNK_SIZE);
        for (const chunk of chunks) {
          const { error } = await supabaseService.supabase
            .from('atc_sql_clientes_v')
            .upsert(chunk);
          if (error) throw error;
        }
        clientesCount = clientes.length;
        console.log(`✅ Sincronizados ${clientesCount} clientes en atc_sql_clientes_v`);
      }
    } catch (err) {
      console.warn('⚠️ No se pudieron sincronizar clientes desde SQL Server:', err.message);
    }

    // 2. Productos
    let productosCount = 0;
    try {
      const productos = await mssqlService.getProductos();
      if (Array.isArray(productos) && productos.length > 0) {
        const chunks = chunkArray(productos, CHUNK_SIZE);
        for (const chunk of chunks) {
          const { error } = await supabaseService.supabase
            .from('atc_sql_productos_v')
            .upsert(chunk);
          if (error) throw error;
        }
        productosCount = productos.length;
        console.log(`✅ Sincronizados ${productosCount} productos en atc_sql_productos_v`);
      }
    } catch (err) {
      console.warn('⚠️ No se pudieron sincronizar productos desde SQL Server:', err.message);
    }

    // 3. Vendedores
    let vendedoresCount = 0;
    try {
      const vendedores = await mssqlService.getVendedores();
      if (Array.isArray(vendedores) && vendedores.length > 0) {
        const { error } = await supabaseService.supabase
          .from('atc_sql_vendedores_v')
          .upsert(vendedores);
        if (error) throw error;
        vendedoresCount = vendedores.length;
        console.log(`✅ Sincronizados ${vendedoresCount} vendedores en atc_sql_vendedores_v`);
      }
    } catch (err) {
      console.warn('⚠️ No se pudieron sincronizar vendedores desde SQL Server:', err.message);
    }

    // 4. Pedidos Cabecera desde SQL Server (AppTransacciones.PedidoAppCabe)
    let pedidosCabeCount = 0;
    try {
      const dbPedidos = await mssqlService.getPedidosFromDB();
      if (Array.isArray(dbPedidos) && dbPedidos.length > 0) {
        const chunks = chunkArray(dbPedidos, CHUNK_SIZE);
        for (const chunk of chunks) {
          const { error } = await supabaseService.supabase
            .from('atc_sql_pedidos_cabe_v')
            .upsert(chunk);
          if (error) throw error;
        }
        pedidosCabeCount = dbPedidos.length;
        console.log(`✅ Sincronizados ${pedidosCabeCount} pedidos en atc_sql_pedidos_cabe_v`);
      }
    } catch (err) {
      console.warn('⚠️ No se pudieron sincronizar pedidos cabecera desde SQL Server:', err.message);
    }

    // 5. Pedidos Detalle desde SQL Server (AppTransacciones.PedidoAppDeta)
    let pedidosDetaCount = 0;
    try {
      const dbDetalles = await mssqlService.getDetallesFromDB();
      if (Array.isArray(dbDetalles) && dbDetalles.length > 0) {
        const chunks = chunkArray(dbDetalles, CHUNK_SIZE);
        for (const chunk of chunks) {
          const { error } = await supabaseService.supabase
            .from('atc_sql_pedidos_deta_v')
            .upsert(chunk);
          if (error) throw error;
        }
        pedidosDetaCount = dbDetalles.length;
        console.log(`✅ Sincronizados ${pedidosDetaCount} renglones de pedidos en atc_sql_pedidos_deta_v`);
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
