const express = require('express');
const router = express.Router();
const supabaseService = require('../services/supabase.service');
const mssqlService = require('../services/mssql.service');
const auth = require('../middlewares/auth');

// Protect all client routes
router.use(auth);

// Helper to get all clientes from mirror view or MSSQL
async function getClientesData() {
  try {
    const mirrorClientes = await supabaseService.getRows('atc_sql_clientes_v');
    if (Array.isArray(mirrorClientes) && mirrorClientes.length > 0) {
      return mirrorClientes;
    }
  } catch (err) {
    console.warn('⚠️ No se pudo leer atc_sql_clientes_v de Supabase, recurriendo a MSSQL:', err.message);
  }
  return mssqlService.getClientes();
}

// GET all clients (supports ?search=texto)
router.get('/', async (req, res, next) => {
  try {
    const { search } = req.query;
    const all = await getClientesData();
    if (!search) {
      return res.json(all);
    }
    const term = String(search).toLowerCase().trim();
    const filtered = all.filter(c =>
      (c.NOMBRE_CLIENTE && String(c.NOMBRE_CLIENTE).toLowerCase().includes(term)) ||
      (c.NRO_CLIENTE != null && String(c.NRO_CLIENTE).includes(term)) ||
      (c.CUIT && String(c.CUIT).includes(term))
    );
    res.json(filtered);
  } catch (error) {
    console.error('Error in GET /api/clientes:', error.message);
    res.status(503).json({ message: 'Error al consultar clientes', error: error.message });
  }
});

// GET clients by multiple IDs (comma-separated query param ?ids=1,2,3)
router.get('/batch', async (req, res, next) => {
  try {
    const { ids } = req.query;
    if (!ids) return res.json([]);
    const idArray = ids.split(',').map(x => x.trim()).filter(Boolean);
    if (idArray.length === 0) return res.json([]);

    const idSet = new Set(idArray.map(String));
    const all = await getClientesData();
    const matched = all.filter(c => idSet.has(String(c.NRO_CLIENTE)));
    if (matched.length > 0) {
      return res.json(matched);
    }

    const fallbackClients = await mssqlService.getClientesByMultipleIds(idArray);
    res.json(fallbackClients);
  } catch (error) {
    console.error('Error in GET /api/clientes/batch:', error.message);
    res.status(503).json({ message: 'Error fetching batch clients', error: error.message });
  }
});

// GET client by ID
router.get('/:id', async (req, res, next) => {
  try {
    const all = await getClientesData();
    const client = all.find(c => String(c.NRO_CLIENTE) === String(req.params.id));
    if (client) {
      return res.json(client);
    }
    const fallbackClient = await mssqlService.getClienteById(req.params.id);
    if (!fallbackClient) return res.status(404).json({ message: 'Cliente no encontrado' });
    res.json(fallbackClient);
  } catch (error) {
    console.error('Error in GET /api/clientes/:id:', error.message);
    next(error);
  }
});

module.exports = router;

