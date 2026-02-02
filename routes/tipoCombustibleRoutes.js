const express = require("express");
const router = express.Router();
const { check } = require("express-validator");
const tipoCombustibleController = require("../controllers/tipoCombustibleController");
const { autenticarUsuario, authorizeRole } = require("../middlewares/authMiddleware");
const validarCampos = require("../middlewares/validationMiddleware");

// --- RUTAS PROTEGIDAS ---

// GET /api/tipos-combustible/lista (Para Selects - Todos los autenticados)
router.get(
    "/lista",
    autenticarUsuario,
    tipoCombustibleController.listarTodos
);

// GET /api/tipos-combustible (Listar Paginado - Solo Admin/Supervisor)
router.get(
    "/",
    [autenticarUsuario],
    tipoCombustibleController.obtenerTiposCombustible
);

// POST /api/tipos-combustible (Crear - Solo Admin)
router.post(
    "/",
    [
        autenticarUsuario, 
        authorizeRole(["ADMIN"]),
        check("nombre", "El nombre es obligatorio").not().isEmpty(),
        validarCampos
    ],
    tipoCombustibleController.crearTipoCombustible
);

// PUT /api/tipos-combustible/:id (Actualizar - Solo Admin)
router.put(
    "/:id",
    [
        autenticarUsuario, 
        authorizeRole(["ADMIN"]),
        check("nombre", "El nombre es obligatorio").optional().not().isEmpty(),
        validarCampos
    ],
    tipoCombustibleController.actualizarTipoCombustible
);

// DELETE /api/tipos-combustible/:id (Desactivar - Solo Admin)
router.delete(
    "/:id",
    [autenticarUsuario, authorizeRole(["ADMIN"])],
    tipoCombustibleController.eliminarTipoCombustible
);

module.exports = router;
