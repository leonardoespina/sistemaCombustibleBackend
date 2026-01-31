const express = require("express");
const router = express.Router();
const cupoController = require("../controllers/cupoController");
const { autenticarUsuario, authorizeRole } = require("../middlewares/authMiddleware");

// --- RUTAS DE CONFIGURACIÓN (Cupo Base) - Solo ADMIN ---
router.get(
    "/base", 
    [autenticarUsuario, authorizeRole(["ADMIN"])], 
    cupoController.obtenerCuposBase
);

router.post(
    "/base", 
    [autenticarUsuario, authorizeRole(["ADMIN"])], 
    cupoController.crearCupoBase
);

router.put(
    "/base/:id", 
    [autenticarUsuario, authorizeRole(["ADMIN"])], 
    cupoController.actualizarCupoBase
);

// --- RUTAS DE ESTADO ACTUAL - TODOS LOS ROLES AUTENTICADOS ---
router.get(
    "/actual", 
    [autenticarUsuario], 
    cupoController.obtenerCuposActuales
);

router.get(
    "/especifico",
    [autenticarUsuario],
    cupoController.obtenerCupoEspecifico
);

// --- RUTAS DE GESTIÓN (Consumo y Recarga) - Solo ADMIN ---
router.post(
    "/consumir", 
    [autenticarUsuario, authorizeRole(["ADMIN"])], 
    cupoController.consumirCupo
);

router.post(
    "/recargar", 
    [autenticarUsuario, authorizeRole(["ADMIN"])], 
    cupoController.recargarCupo
);

// --- RUTA DE REINICIO MANUAL (Para pruebas) - Solo ADMIN ---
router.post(
    "/reiniciar-mes", 
    [autenticarUsuario, authorizeRole(["ADMIN"])], 
    async (req, res) => {
        const resultado = await cupoController.reiniciarCuposMensuales();
        if (resultado.success) {
            res.json(resultado);
        } else {
            res.status(500).json(resultado);
        }
    }
);

module.exports = router;
