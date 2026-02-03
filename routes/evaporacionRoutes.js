const express = require("express");
const router = express.Router();
const { check } = require("express-validator");
const evaporacionController = require("../controllers/evaporacionController");
const { autenticarUsuario, authorizeRole } = require("../middlewares/authMiddleware");
const validarCampos = require("../middlewares/validationMiddleware");

router.use(autenticarUsuario);

const ROLES_PERMITIDOS = ["ADMIN", "JEFE DIVISION", "GERENTE", "ALMACENISTA"];

// GET /api/evaporaciones
router.get(
  "/",
  authorizeRole(ROLES_PERMITIDOS),
  evaporacionController.listarEvaporaciones
);

// POST /api/evaporaciones
router.post(
  "/",
  [
    authorizeRole(ROLES_PERMITIDOS),
    check("id_llenadero", "El ID de llenadero es obligatorio").isInt(),
    check("cantidad", "La cantidad es obligatoria y debe ser positiva").isFloat({ min: 0.01 }),
    check("observacion", "La observación es obligatoria").not().isEmpty(),
    validarCampos
  ],
  evaporacionController.registrarEvaporacion
);

module.exports = router;
