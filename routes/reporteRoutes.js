const express = require("express");
const router = express.Router();
const reporteController = require("../controllers/administracion/reporteController");
const { autenticarUsuario } = require("../middlewares/authMiddleware");

// Ruta para generar el reporte diario
// GET /api/reportes/diario?id_llenadero=1&fecha=2026-02-05
router.get(
  "/diario",
  autenticarUsuario,
  reporteController.generarReporteDiario,
);

// Ruta para generar el reporte detallado de despachos (Filtros: Dependencia, Fechas)
// GET /api/reportes/despachos?id_dependencia=X&id_subdependencia=Y&fecha_desde=...&fecha_hasta=...
router.get(
  "/despachos",
  autenticarUsuario,
  reporteController.consultarDespachos,
);

// Ruta para que el usuario vea sus propios despachos (la dependencia viene del token)
// GET /api/reportes/mis-despachos?subdependencias[]=1&subdependencias[]=2&fecha_desde=...&fecha_hasta=...
router.get(
  "/mis-despachos",
  autenticarUsuario,
  reporteController.consultarMisDespachos,
);

// Ruta para el reporte de consumo agregado por dependencia y tipo de combustible
// GET /api/reportes/consumo-dependencia?fecha_desde=...&fecha_hasta=...
router.get(
  "/consumo-dependencia",
  autenticarUsuario,
  reporteController.obtenerConsumoPorDependencia,
);

// Ruta para que CUALQUIER USUARIO vea sus cupos asignados (Dependencia/Subdependencia)
// GET /api/reportes/mis-cupos?periodo=2024-02
router.get(
  "/mis-cupos",
  autenticarUsuario,
  reporteController.obtenerReporteCuposUsuario,
);

module.exports = router;
