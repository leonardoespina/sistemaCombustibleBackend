const express = require("express");
const router = express.Router();
const { check } = require("express-validator");
const categoriaController = require("../controllers/categoriaController");
const { autenticarUsuario, authorizeRole } = require("../middlewares/authMiddleware");
const validarCampos = require("../middlewares/validationMiddleware");

// --- RUTAS PROTEGIDAS (Requieren Token) ---

// GET /api/categorias/jerarquia (Lazy Loading para Selects)
router.get(
  "/jerarquia",
  autenticarUsuario,
  categoriaController.obtenerJerarquia
);

// GET /api/categorias (Listar) - Todos los roles autenticados o solo admin?
// Asumiremos que cualquier usuario autenticado puede verlas, o restringir a ADMIN/SUPERVISOR
router.get(
  "/", 
  autenticarUsuario, 
  categoriaController.obtenerCategorias
);

// POST /api/categorias (Crear) - Solo ADMIN
router.post(
  "/",
  [
    autenticarUsuario,
    authorizeRole(["ADMIN"]),
    check("nombre", "El nombre es obligatorio").not().isEmpty(),
    validarCampos,
  ],
  categoriaController.crearCategoria
);

// PUT /api/categorias/:id (Actualizar) - Solo ADMIN
router.put(
  "/:id",
  [
    autenticarUsuario,
    authorizeRole(["ADMIN"]),
    check("nombre", "El nombre es obligatorio").optional().not().isEmpty(),
    validarCampos,
  ],
  categoriaController.actualizarCategoria
);

// DELETE /api/categorias/:id (Desactivar) - Solo ADMIN
router.delete(
  "/:id", 
  autenticarUsuario, 
  authorizeRole(["ADMIN"]), 
  categoriaController.desactivarCategoria
);

module.exports = router;
