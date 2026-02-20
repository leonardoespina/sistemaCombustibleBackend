const express = require("express");
const router = express.Router();
const solicitudController = require("../controllers/despachos/solicitudController");
const { autenticarUsuario } = require("../middlewares/authMiddleware");
const { criticalLimiter } = require("../middlewares/rateLimitMiddleware");

// Todas las rutas requieren autenticación
// Se asume que authMiddleware popula req.usuario y verifica el token
router.use(autenticarUsuario);

// Obtener Subdependencias Autorizadas (para filtros)
router.get(
  "/subdependencias-autorizadas",
  solicitudController.obtenerSubdependenciasAutorizadas,
);

// Listar Llenaderos por combustible
router.get(
  "/llenaderos-por-combustible",
  solicitudController.obtenerLlenaderosPorCombustible,
);

// Crear Solicitud - OPERACIÓN CRÍTICA (Afecta cupos)
router.post("/", criticalLimiter, solicitudController.crearSolicitud);

// Listar Solicitudes (con filtros)
router.get("/", solicitudController.listarSolicitudes);

// Aprobar Solicitud (Requiere rol Gerente/Jefe) - OPERACIÓN CRÍTICA
router.put(
  "/:id/aprobar",
  criticalLimiter,
  solicitudController.aprobarSolicitud,
);

// Rechazar (Anular) Solicitud - OPERACIÓN CRÍTICA
router.put(
  "/:id/rechazar",
  criticalLimiter,
  solicitudController.rechazarSolicitud,
);

module.exports = router;
