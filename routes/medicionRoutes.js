const express = require("express");
const router = express.Router();
const medicionController = require("../controllers/operaciones/medicionController");
const { autenticarUsuario } = require("../middlewares/authMiddleware");

// Todas las rutas requieren autenticación
router.use(autenticarUsuario);

// Listar Mediciones
router.get("/", medicionController.listarMediciones);

// Crear Medición
router.post("/", medicionController.crearMedicion);

// Actualizar Medición
router.put("/:id", medicionController.actualizarMedicion);

// Anular Medición
router.put("/:id/anular", medicionController.anularMedicion);

module.exports = router;
