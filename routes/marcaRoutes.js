const express = require("express");
const router = express.Router();
const { check } = require("express-validator");
const marcaController = require("../controllers/marcaController");
const { autenticarUsuario, authorizeRole } = require("../middlewares/authMiddleware");
const validarCampos = require("../middlewares/validationMiddleware");

// Todas las rutas de marcas requieren estar logueado
router.use(autenticarUsuario);

// GET /api/marcas - Listar y Buscar
router.get("/", marcaController.obtenerMarcas);

// GET /api/marcas/lista - Para selectores
router.get("/lista", marcaController.obtenerListaMarcas);

// POST /api/marcas - Crear (Solo ADMIN)
router.post(
  "/",
  [
    authorizeRole(["ADMIN"]),
    check("nombre", "El nombre de la marca es obligatorio").not().isEmpty(),
    validarCampos,
  ],
  marcaController.crearMarca
);

// PUT /api/marcas/:id - Modificar (Solo ADMIN)
router.put(
  "/:id",
  [
    authorizeRole(["ADMIN"]),
    check("nombre", "El nombre no puede estar vacío").optional().not().isEmpty(),
    validarCampos,
  ],
  marcaController.actualizarMarca
);

// DELETE /api/marcas/:id - Desactivar (Solo ADMIN)
router.delete(
  "/:id",
  [
    authorizeRole(["ADMIN"]),
    validarCampos
  ],
  marcaController.desactivarMarca
);

module.exports = router;
