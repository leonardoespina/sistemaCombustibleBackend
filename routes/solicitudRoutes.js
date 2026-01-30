const express = require("express");
const router = express.Router();
const solicitudController = require("../controllers/solicitudController");
const authMiddleware = require("../middlewares/authMiddleware");

// Todas las rutas requieren autenticación
// Se asume que authMiddleware popula req.user y verifica el token
router.use(authMiddleware);

// Crear Solicitud
router.post("/", solicitudController.crearSolicitud);

// Listar Solicitudes (con filtros)
router.get("/", solicitudController.listarSolicitudes);

// Aprobar Solicitud (Requiere rol Gerente/Jefe, validado en controlador o aquí)
router.put("/:id/aprobar", solicitudController.aprobarSolicitud);

// Imprimir Ticket (Genera Código y valida Huellas)
router.post("/:id/imprimir", solicitudController.imprimirTicket);

// Reimprimir Ticket (Genera Copia)
router.post("/:id/reimprimir", solicitudController.reimprimirTicket);

// Despachar (Escaneo QR)
// Nota: La ruta es /despachar (sin ID) porque el ID viene en el QR como codigo_ticket
router.post("/despachar", solicitudController.despacharSolicitud);

module.exports = router;
