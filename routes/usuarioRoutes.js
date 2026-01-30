const express = require("express");
const router = express.Router();
const { check } = require("express-validator");
const usuarioController = require("../controllers/usuarioController");
const { autenticarUsuario, authorizeRole } = require("../middlewares/authMiddleware");
const validarCampos = require("../middlewares/validationMiddleware");

// --- RUTAS PÚBLICAS ---

// POST /api/usuarios/login (Login)
router.post(
  "/login",
  [
    check("cedula", "La cédula es obligatoria").not().isEmpty(),
    check("password", "El password es obligatorio").exists(),
    validarCampos,
  ],
  usuarioController.loginUsuario
);

// --- RUTAS PROTEGIDAS (Requieren Token) ---

// GET /api/usuarios (Listar) - Solo ADMIN
router.get(
  "/", 
  autenticarUsuario, 
  authorizeRole(["ADMIN"]), 
  usuarioController.obtenerUsuarios
);

// POST /api/usuarios (Crear) - Solo ADMIN
router.post(
  "/",
  [
    autenticarUsuario,
    authorizeRole(["ADMIN"]),
    check("nombre", "El nombre es obligatorio").not().isEmpty(),
    check("apellido", "El apellido es obligatorio").not().isEmpty(),
    check("cedula", "La cédula es obligatoria").not().isEmpty(),
    check("password", "Mínimo 6 caracteres").isLength({ min: 6 }),
    validarCampos,
  ],
  usuarioController.crearUsuario
);

// PUT /api/usuarios/:id (Actualizar) - Solo ADMIN
router.put(
  "/:id",
  [
    autenticarUsuario,
    authorizeRole(["ADMIN"]),
    check("nombre", "El nombre es obligatorio").optional().not().isEmpty(),
    check("apellido", "El apellido es obligatorio").optional().not().isEmpty(),
    // Si envían password, validamos longitud
    //check("password", "Mínimo 6 caracteres").optional().isLength({ min: 6 }),
  //  validarCampos,
  ],
  usuarioController.actualizarUsuario
);

// DELETE /api/usuarios/:id (Desactivar) - Solo ADMIN
router.delete(
  "/:id", 
  autenticarUsuario, 
  authorizeRole(["ADMIN"]), 
  usuarioController.desactivarUsuario
);

module.exports = router;
