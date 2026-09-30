require('dotenv').config();
const app = require('./src/app');

const PORT = process.env.PORT || 3000;

// Pre-warm MSSQL connection pool on startup
require('./src/config/mssql');

const startServer = (portToTry) => {
  const server = app.listen(portToTry, async () => {
    const addr = server.address();
    const actualPort = addr ? (typeof addr === 'string' ? addr : addr.port) : portToTry;
    console.log(`🚀 Server running on port ${actualPort}`);
    console.log(`📊 Google Sheets ID: ${process.env.SPREADSHEET_ID}`);
    console.log(`🗄️  MSSQL Host: ${process.env.MSSQL_HOST}:${process.env.MSSQL_PORT}`);

    // Start periodic background sync (SQL Server <-> Supabase Mirror)
    try {
      const syncService = require('./src/services/sync.service');
      syncService.startPeriodicSync(20);
      console.log('🔄 Periodic background sync initialized (every 20 min)');
    } catch (err) {
      console.warn('⚠️ Could not initialize sync worker:', err.message);
    }

    // Pre-warm Supabase and MSSQL cache so first user request is instant
    try {
      const supabaseService = require('./src/services/supabase.service');
      console.log('🔥 Pre-warming Supabase mirror and order caches...');
      await Promise.allSettled([
        supabaseService.getRows('atc_pedidos_v'),
        supabaseService.getRows('atc_detalles_pedidos_v'),
        supabaseService.getRows('atc_sql_clientes_v'),
        supabaseService.getRows('atc_sql_productos_v'),
        supabaseService.getRows('atc_sql_vendedores_v'),
        supabaseService.getRows('atc_sql_pedidos_cabe_v'),
        supabaseService.getRows('atc_sql_pedidos_deta_v')
      ]);
      console.log('✅ Supabase cache warm-up complete');
    } catch (err) {
      console.warn('⚠️  Cache warm-up error (will load on first request):', err.message);
    }
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && portToTry !== 0) {
      console.warn(`⚠️  Port ${portToTry} is in use, looking for an open port...`);
      startServer(0);
    } else {
      console.error('❌ Server error:', err);
    }
  });
};

startServer(PORT);

