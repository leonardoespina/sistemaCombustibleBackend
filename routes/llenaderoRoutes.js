const express = require("express");
const router = express.Router();
const { check } = require("express-validator");
const llenaderoController = require("../controllers/llenaderoController");
const { autenticarUsuario, authorizeRole } = require("../middlewares/authMiddleware");
const validarCampos = require("../middlewares/validationMiddleware");

// Todas las rutas de llenaderos requieren estar logueado
router.use(autenticarUsuario);

// GET /api/llenaderos - Listar y Buscar
router.get("/", llenaderoController.obtenerLlenaderos);

// GET /api/llenaderos/lista - Para selectores
router.get("/lista", llenaderoController.obtenerListaLlenaderos);

// POST /api/llenaderos - Crear (Solo ADMIN)
router.post(
  "/",
  [
    authorizeRole(["ADMIN"]),
    check("nombre_llenadero", "El nombre del llenadero es obligatorio").not().isEmpty(),
    check("capacidad", "La capacidad debe ser un número positivo").isFloat({ min: 0 }),
    check("disponibilidadActual", "La disponibilidad debe ser un número positivo").isFloat({ min: 0 }),
    check("id_combustible", "El tipo de combustible es obligatorio").isInt(),
    validarCampos,
  ],
  llenaderoController.crearLlenadero
);

// PUT /api/llenaderos/:id - Modificar (Solo ADMIN)
router.put(
  "/:id",
  [
    authorizeRole(["ADMIN"]),
    check("nombre_llenadero", "El nombre no puede estar vacío").optional().not().isEmpty(),
    check("capacidad", "La capacidad debe ser un número positivo").optional().isFloat({ min: 0 }),
    check("disponibilidadActual", "La disponibilidad debe ser un número positivo").optional().isFloat({ min: 0 }),
    check("id_combustible", "El tipo de combustible es inválido").optional().isInt(),
    validarCampos,
  ],
  llenaderoController.actualizarLlenadero
);

// DELETE /api/llenaderos/:id - Desactivar (Solo ADMIN)
router.delete(
  "/:id",
  [
    authorizeRole(["ADMIN"]),
    validarCampos
  ],
  llenaderoController.desactivarLlenadero
);

module.exports = router;
