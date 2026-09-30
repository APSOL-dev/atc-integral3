const express = require('express');
const router = express.Router();
const syncService = require('../services/sync.service');
const auth = require('../middlewares/auth');

// GET /api/sync/estado - Obtiene el estado de la última sincronización
router.get('/estado', async (req, res) => {
  try {
    const estado = syncService.getLastSyncResult();
    res.json(estado);
  } catch (err) {
    res.status(500).json({ message: 'Error al consultar estado de sincronización', error: err.message });
  }
});

// POST /api/sync/forzar - Dispara una sincronización manual inmediata
router.post('/forzar', auth, async (req, res) => {
  try {
    console.log(`⚡ Sincronización manual forzada por usuario: ${req.user?.nombre || 'desconocido'}`);
    const resultado = await syncService.syncFromSqlToSupabase(true);
    res.json({
      message: 'Sincronización ejecutada con éxito',
      resultado
    });
  } catch (err) {
    console.error('Error en POST /api/sync/forzar:', err.message);
    res.status(500).json({ message: 'Error durante la sincronización forzada', error: err.message });
  }
});

module.exports = router;
