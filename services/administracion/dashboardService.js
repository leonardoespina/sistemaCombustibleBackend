const { Llenadero, TipoCombustible } = require("../../models");

/**
 * Obtener estadísticas globales para el Dashboard
 */
exports.getStats = async () => {
  const llenaderos = await Llenadero.findAll({
    attributes: [
      "id_llenadero",
      "nombre_llenadero",
      "capacidad",
      "disponibilidadActual",
      "estado",
    ],
    include: [{ model: TipoCombustible, attributes: ["nombre"] }],
  });

  // Formatear para que el componente lo reciba como 'tank' (para reusar lógica)
  const llenaderosFormatted = llenaderos.map((l) => ({
    id_llenadero: l.id_llenadero,
    nombre: l.nombre_llenadero,
    capacidad_maxima: parseFloat(l.capacidad),
    nivel_actual: parseFloat(l.disponibilidadActual),
    tipo_tanque: "CILINDRICO",
    tipo_combustible: l.TipoCombustible?.nombre,
    codigo: `LL-0${l.id_llenadero}`,
    estado: l.estado,
  }));

  return {
    llenaderos: llenaderosFormatted,
  };
};
