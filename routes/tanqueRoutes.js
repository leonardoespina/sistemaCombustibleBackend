const express = require("express");
const router = express.Router();
const { check } = require("express-validator");
const tanqueController = require("../controllers/tanqueController");
const { autenticarUsuario, authorizeRole } = require("../middlewares/authMiddleware");
const validarCampos = require("../middlewares/validationMiddleware");

// Todas las rutas requieren estar logueado
router.use(autenticarUsuario);

// GET /api/tanques - Listar (Solo ADMIN)
router.get("/", authorizeRole(["ADMIN"]), tanqueController.obtenerTanques);

// GET /api/tanques/lista - Para selectores (Todos los autenticados)
router.get("/lista", tanqueController.obtenerListaTanques);

// POST /api/tanques - Crear (Solo ADMIN)
router.post(
  "/",
  [
    authorizeRole(["ADMIN"]),
    check("id_llenadero", "El ID de llenadero es obligatorio").isNumeric(),
    check("codigo", "El código es obligatorio").not().isEmpty(),
    check("nombre", "El nombre es obligatorio").not().isEmpty(),
    check("id_tipo_combustible", "El ID de tipo de combustible es obligatorio").isNumeric(),
    check("tipo_tanque", "El tipo de tanque es inválido").isIn(["RECTANGULAR", "CILINDRICO"]),
    check("capacidad_maxima", "La capacidad máxima debe ser un número").isDecimal(),
    validarCampos,
  ],
  tanqueController.crearTanque
);

// PUT /api/tanques/:id - Modificar (Solo ADMIN)
router.put(
  "/:id",
  [
    authorizeRole(["ADMIN"]),
    check("id_llenadero", "El ID de llenadero debe ser numérico").optional().isNumeric(),
    check("id_tipo_combustible", "El ID de tipo de combustible debe ser numérico").optional().isNumeric(),
    check("tipo_tanque", "El tipo de tanque es inválido").optional().isIn(["RECTANGULAR", "CILINDRICO"]),
    check("estado", "El estado es inválido").optional().isIn(["ACTIVO", "INACTIVO", "MANTENIMIENTO", "CONTAMINADO"]),
    validarCampos,
  ],
  tanqueController.actualizarTanque
);

// DELETE /api/tanques/:id - Desactivar (Solo ADMIN)
router.delete(
  "/:id",
  [
    authorizeRole(["ADMIN"]),
    validarCampos
  ],
  tanqueController.eliminarTanque
);

module.exports = router;
