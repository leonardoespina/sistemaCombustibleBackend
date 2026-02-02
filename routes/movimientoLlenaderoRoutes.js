const express = require("express");
const router = express.Router();
const { check } = require("express-validator");
const movimientoController = require("../controllers/movimientoLlenaderoController");
const { autenticarUsuario, authorizeRole } = require("../middlewares/authMiddleware");
const validarCampos = require("../middlewares/validationMiddleware");

router.use(autenticarUsuario);

// Roles permitidos para registrar movimientos de inventario
const ROLES_PERMITIDOS = ["ADMIN", "JEFE DIVISION", "GERENTE", "ALMACENISTA"];

// GET /api/movimientos-llenadero
router.get(
  "/",
  authorizeRole(ROLES_PERMITIDOS),
  movimientoController.listarMovimientos
);

// POST /api/movimientos-llenadero
router.post(
  "/",
  [
    authorizeRole(ROLES_PERMITIDOS),
    check("id_llenadero", "El ID de llenadero es obligatorio").isInt(),
    check("tipo_movimiento", "El tipo de movimiento es obligatorio y debe ser CARGA o EVAPORACION")
      .isIn(["CARGA", "EVAPORACION"]),
    check("cantidad", "La cantidad es obligatoria y debe ser positiva").isFloat({ min: 0.01 }),
    check("observacion", "La observación es obligatoria").not().isEmpty(),
    validarCampos
  ],
  movimientoController.crearMovimiento
);

module.exports = router;
