const express = require("express");
const router = express.Router();
const transferenciaController = require("../controllers/despachos/transferenciaController");
const { autenticarUsuario } = require("../middlewares/authMiddleware");

// Todas las rutas requieren autenticación
router.use(autenticarUsuario);

// Listar Transferencias
router.get("/", transferenciaController.listarTransferencias);

// Obtener Detalle
router.get("/:id", transferenciaController.obtenerTransferenciaPorId);

// Crear Transferencia
router.post("/", transferenciaController.crearTransferencia);

// Actualizar (Solo observaciones)
router.put("/:id", transferenciaController.actualizarTransferencia);

module.exports = router;
