const express = require('express');
const router = express.Router();
const supabaseService = require('../services/supabase.service');
const mssqlService = require('../services/mssql.service');
const auth = require('../middlewares/auth');

// Protect all product routes
router.use(auth);

// Helper to get all productos from mirror view or MSSQL
async function getProductosData() {
  try {
    const mirrorProductos = await supabaseService.getRows('atc_sql_productos_v');
    if (Array.isArray(mirrorProductos) && mirrorProductos.length > 0) {
      return mirrorProductos;
    }
  } catch (err) {
    console.warn('⚠️ No se pudo leer atc_sql_productos_v de Supabase, recurriendo a MSSQL:', err.message);
  }
  return mssqlService.getProductos();
}

// GET all products (supports ?search=texto)
router.get('/', async (req, res, next) => {
  try {
    const { search } = req.query;
    const all = await getProductosData();
    if (!search) {
      return res.json(all);
    }
    const term = String(search).toLowerCase().trim();
    const filtered = all.filter(p =>
      (p.DESCRI && String(p.DESCRI).toLowerCase().includes(term)) ||
      (p.CODART != null && String(p.CODART).includes(term)) ||
      (p.NombreMarca && String(p.NombreMarca).toLowerCase().includes(term)) ||
      (p.NombreRubro && String(p.NombreRubro).toLowerCase().includes(term))
    );
    res.json(filtered);
  } catch (error) {
    console.error('Error in GET /api/productos:', error.message);
    res.status(503).json({ message: 'Error al consultar productos', error: error.message });
  }
});

module.exports = router;

