const express = require("express");
const router = express.Router();
const cargaCisternaController = require("../controllers/cargaCisternaController");
const { autenticarUsuario } = require("../middlewares/authMiddleware");

// Todas las rutas requieren autenticación
router.use(autenticarUsuario);

// Listar Cargas
router.get("/", cargaCisternaController.listarCargasCisterna);

// Crear Carga
router.post("/", cargaCisternaController.crearCargaCisterna);

// Actualizar Carga
router.put("/:id", cargaCisternaController.actualizarCarga);

module.exports = router;
