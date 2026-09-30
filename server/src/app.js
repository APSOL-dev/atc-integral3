const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const crypto = require('crypto');

const app = express();

// Trust proxy for rate limiters (Cloudflare / reverse proxies)
app.set('trust proxy', 1);

// Security HTTP Headers
app.use(helmet());
app.use(helmet.hsts({ maxAge: 31536000, includeSubDomains: true }));

// Generate a random cryptographic nonce per request
app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
});

// Configure Content Security Policy dynamically using the generated nonce
app.use((req, res, next) => {
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", `'nonce-${res.locals.cspNonce}'`, "https://static.cloudflareinsights.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https://ui-avatars.com"],
      connectSrc: ["'self'", "https://static.cloudflareinsights.com"], // Restrict connect-src and remove * wildcard
    },
  })(req, res, next);
});

app.use(cors());
app.use(express.json());

// Security: Block access to .env and other hidden files (dotfiles)
app.use((req, res, next) => {
  if (req.path.includes('/.env') || req.path.split('/').some(part => part.startsWith('.'))) {
    return res.status(403).send('Forbidden');
  }
  next();
});

const path = require('path');
const fs = require('fs');
const clientDistPath = [
  path.join(__dirname, '../client-dist'),
  path.join(__dirname, '../../client/dist'),
  path.join(__dirname, '../dist')
].find(p => fs.existsSync(p));

// Health check with live database connectivity status
app.get('/api/health', async (req, res) => {
  let mssqlStatus = false;
  let supabaseStatus = false;

  try {
    const { poolPromise } = require('./config/mssql');
    const pool = await poolPromise;
    mssqlStatus = !!(pool && pool.connected);
  } catch (e) {
    mssqlStatus = false;
  }

  try {
    const supabaseService = require('./services/supabase.service');
    const { error } = await supabaseService.supabase.from('atc_pedidos_v').select('IDPedido').limit(1);
    supabaseStatus = !error;
  } catch (e) {
    supabaseStatus = false;
  }

  const isHealthy = mssqlStatus && supabaseStatus;

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'ok' : 'degraded',
    mssql: mssqlStatus,
    supabase: supabaseStatus,
    timestamp: new Date().toISOString()
  });
});

// Routes
app.use('/api/clientes',  require('./routes/clientes.routes'));
app.use('/api/productos', require('./routes/productos.routes'));
app.use('/api/pedidos',   require('./routes/pedidos.routes'));
app.use('/api/usuarios',  require('./routes/usuarios.routes'));
app.use('/api/tablero',   require('./routes/tablero.routes'));
app.use('/api/descuentos-marca', require('./routes/descuentos.routes'));
app.use('/api/sync',      require('./routes/sync.routes'));

// Serve static frontend files in production if client build exists
if (clientDistPath) {
  // Serve static assets (CSS, JS, images) with immutable caching for 1 year
  app.use(express.static(clientDistPath, { 
    index: false,
    immutable: true,
    maxAge: '1y'
  }));
  
  // For any non-API route, dynamically serve index.html with the generated nonce injected
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) {
      return next();
    }
    const indexPath = path.join(clientDistPath, 'index.html');
    fs.readFile(indexPath, 'utf8', (err, html) => {
      if (err) {
        return next(err);
      }
      const nonce = res.locals.cspNonce;
      // Inject the dynamic nonce into all script tags
      const modifiedHtml = html.replace(/<script/g, `<script nonce="${nonce}"`);
      // Prevent browser and proxy caching of index.html so updates are immediate
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.send(modifiedHtml);
    });
  });
} else {
  // Root endpoint info (only if static frontend is not present)
  app.get('/', (req, res) => {
    res.json({
      name: 'API ATC Migración',
      status: 'ok',
      timestamp: new Date().toISOString(),
      health: '/api/health'
    });
  });
}

// 404 handler for API routes
app.use((req, res) => {
  res.status(404).json({ message: `Ruta no encontrada: ${req.method} ${req.path}` });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('❌ Server error:', err.message);
  res.status(500).json({ message: err.message || 'Error interno del servidor' });
});

module.exports = app;
