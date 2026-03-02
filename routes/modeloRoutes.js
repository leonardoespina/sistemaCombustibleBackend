const express = require("express");
const router = express.Router();
const { check } = require("express-validator");
const modeloController = require("../controllers/vehiculos/modeloController");
const {
  autenticarUsuario,
  authorizeRole,
} = require("../middlewares/authMiddleware");
const validarCampos = require("../middlewares/validationMiddleware");

// Todas las rutas de modelos requieren estar autenticado
router.use(autenticarUsuario);

// GET /api/modelos (Listar) - Accesible para todos los usuarios autenticados
// El controlador se encarga de filtrar por activos si no es Admin
router.get("/", modeloController.obtenerModelos);

// POST /api/modelos (Crear) - Solo ADMIN
router.post(
  "/",
  [
    authorizeRole(["ADMIN"]),
    check("nombre", "El nombre es obligatorio").not().isEmpty(),
    check(
      "id_marca",
      "El ID de la marca es obligatorio y numérico",
    ).isNumeric(),
    validarCampos,
  ],
  modeloController.crearModelo,
);

// PUT /api/modelos/:id (Actualizar) - Solo ADMIN
router.put(
  "/:id",
  [
    authorizeRole(["ADMIN"]),
    check("nombre", "El nombre no puede estar vacío")
      .optional()
      .not()
      .isEmpty(),
    check("id_marca", "ID de marca inválido").optional().isNumeric(),
    validarCampos,
  ],
  modeloController.actualizarModelo,
);

// DELETE /api/modelos/:id (Desactivar) - Solo ADMIN
router.delete(
  "/:id",
  [authorizeRole(["ADMIN"]), validarCampos],
  modeloController.desactivarModelo,
);

module.exports = router;
