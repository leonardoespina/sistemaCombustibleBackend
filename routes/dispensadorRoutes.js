const express = require("express");
const router = express.Router();
const { check } = require("express-validator");
const dispensadorController = require("../controllers/dispensadorController");
const { autenticarUsuario, authorizeRole } = require("../middlewares/authMiddleware");
const validarCampos = require("../middlewares/validationMiddleware");

// Roles permitidos para este módulo
const ROLES_PERMITIDOS = ["ADMIN", "GERENTE", "JEFE DIVISION", "SUPERVISOR", "COORDINADOR"];

// Middleware global de autenticación
router.use(autenticarUsuario);

// GET /api/dispensadores - Listar (Paginado)
router.get(
  "/",
  authorizeRole(ROLES_PERMITIDOS),
  dispensadorController.obtenerDispensadores
);

// GET /api/dispensadores/lista - Listar (Simple)
router.get(
  "/lista",
  authorizeRole(ROLES_PERMITIDOS), // O permitir a todos los autenticados si es necesario para combos
  dispensadorController.obtenerListaDispensadores
);

// POST /api/dispensadores - Crear
router.post(
  "/",
  [
    authorizeRole(ROLES_PERMITIDOS),
    check("codigo", "El código es obligatorio").not().isEmpty(),
    check("nombre", "El nombre es obligatorio").not().isEmpty(),
    check("id_tanque", "El ID del tanque es obligatorio y numérico").isNumeric(),
    validarCampos,
  ],
  dispensadorController.crearDispensador
);

// PUT /api/dispensadores/:id - Actualizar
router.put(
  "/:id",
  [
    authorizeRole(ROLES_PERMITIDOS),
    check("codigo", "El código no puede estar vacío").optional().not().isEmpty(),
    check("nombre", "El nombre no puede estar vacío").optional().not().isEmpty(),
    check("id_tanque", "El ID del tanque debe ser numérico").optional().isNumeric(),
    validarCampos,
  ],
  dispensadorController.actualizarDispensador
);

// DELETE /api/dispensadores/:id - Desactivar
router.delete(
  "/:id",
  [
    authorizeRole(ROLES_PERMITIDOS), // O restringir solo a ADMIN si se prefiere mayor seguridad
    validarCampos
  ],
  dispensadorController.desactivarDispensador
);

module.exports = router;
