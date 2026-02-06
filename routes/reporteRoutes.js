const express = require("express");
const router = express.Router();
const reporteController = require("../controllers/reporteController");
const { autenticarUsuario } = require("../middlewares/authMiddleware");

// Ruta para generar el reporte diario
// GET /api/reportes/diario?id_llenadero=1&fecha=2026-02-05
router.get("/diario", autenticarUsuario, reporteController.generarReporteDiario);

module.exports = router;
