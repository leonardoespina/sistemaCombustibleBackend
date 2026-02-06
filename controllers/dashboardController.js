const { 
  Llenadero, 
  Solicitud, 
  ConsumoCupo, 
  Vehiculo, 
  TipoCombustible,
  Categoria,
  Tanque
} = require("../models");
const { Op } = require("sequelize");
const sequelize = require("sequelize");

/**
 * Obtener estadísticas globales para el Dashboard adaptadas a LiquidLlenadero.vue
 */
exports.obtenerStats = async (req, res) => {
  try {
    // 1. OBTENER LLENADEROS (Para el componente visual LiquidLlenadero)
    const llenaderos = await Llenadero.findAll({
      attributes: [
        'id_llenadero', 
        'nombre_llenadero', 
        'capacidad', 
        'disponibilidadActual',
        'estado'
      ],
      include: [{ model: TipoCombustible, attributes: ['nombre'] }]
    });

    // Formatear para que el componente lo reciba como 'tank' (para reusar lógica)
    // Pero con los datos del llenadero
    const llenaderosFormatted = llenaderos.map(l => ({
      id_llenadero: l.id_llenadero,
      nombre: l.nombre_llenadero,
      capacidad_maxima: parseFloat(l.capacidad),
      nivel_actual: parseFloat(l.disponibilidadActual),
      tipo_tanque: 'CILINDRICO', // Forzamos forma para consistencia visual
      tipo_combustible: l.TipoCombustible?.nombre,
      codigo: `LL-0${l.id_llenadero}`,
      estado: l.estado
    }));

    res.json({
      llenaderos: llenaderosFormatted
    });

  } catch (error) {
    console.error("CRITICAL Error Dashboard Stats:", error);
    res.status(500).json({ msg: "Error al generar estadísticas.", error: error.message });
  }
};
