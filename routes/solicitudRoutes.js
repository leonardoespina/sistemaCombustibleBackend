const express = require("express");
const router = express.Router();
const solicitudController = require("../controllers/solicitudController");
const { autenticarUsuario } = require("../middlewares/authMiddleware");

// Todas las rutas requieren autenticación
// Se asume que authMiddleware popula req.usuario y verifica el token
router.use(autenticarUsuario);

// Obtener Subdependencias Autorizadas (para filtros)
router.get("/subdependencias-autorizadas", solicitudController.obtenerSubdependenciasAutorizadas);

// Listar Llenaderos por combustible
router.get("/llenaderos-por-combustible", solicitudController.obtenerLlenaderosPorCombustible);


// Crear Solicitud
router.post("/", solicitudController.crearSolicitud);

// Listar Solicitudes (con filtros)
router.get("/", solicitudController.listarSolicitudes);

// Aprobar Solicitud (Requiere rol Gerente/Jefe, validado en controlador o aquí)
router.put("/:id/aprobar", solicitudController.aprobarSolicitud);

module.exports = router;
