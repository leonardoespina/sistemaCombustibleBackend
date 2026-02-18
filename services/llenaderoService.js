const Llenadero = require("../models/Llenadero");
const TipoCombustible = require("../models/TipoCombustible");
const { paginate } = require("../helpers/paginationHelper");
const { executeTransaction } = require("../helpers/transactionHelper");
const { Op } = require("sequelize");

/**
 * Crear Llenadero
 */
exports.crearLlenadero = async (data, clientIp) => {
  const { nombre_llenadero, capacidad, id_combustible, disponibilidadActual } =
    data;

  return await executeTransaction(clientIp, async (t) => {
    // 1. Validar duplicados
    const existe = await Llenadero.findOne({
      where: { nombre_llenadero },
      transaction: t,
    });
    if (existe) {
      const error = new Error(`El llenadero '${nombre_llenadero}' ya existe.`);
      error.status = 400;
      throw error;
    }

    // 2. Crear registro
    const nuevoLlenadero = await Llenadero.create(
      {
        nombre_llenadero,
        capacidad,
        id_combustible,
        disponibilidadActual: disponibilidadActual || 0,
        estado: "ACTIVO",
      },
      { transaction: t },
    );

    return nuevoLlenadero;
  });
};

/**
 * Obtener Llenaderos (Paginado)
 */
exports.obtenerLlenaderos = async (query, user) => {
  const searchableFields = ["nombre_llenadero"];
  const where = {};

  // Si no es admin, filtramos por activos
  if (user && user.tipo_usuario !== "ADMIN") {
    where.estado = "ACTIVO";
  }

  return await paginate(Llenadero, query, {
    where,
    searchableFields,
    include: [
      { model: TipoCombustible, as: "TipoCombustible", attributes: ["nombre"] },
    ],
  });
};

/**
 * Actualizar Llenadero
 */
exports.actualizarLlenadero = async (id, data, clientIp) => {
  const {
    nombre_llenadero,
    capacidad,
    id_combustible,
    disponibilidadActual,
    estado,
  } = data;

  return await executeTransaction(clientIp, async (t) => {
    const llenadero = await Llenadero.findByPk(id, { transaction: t });

    if (!llenadero) {
      const error = new Error("Llenadero no encontrado");
      error.status = 404;
      throw error;
    }

    // 1. Validar nombre duplicado
    if (nombre_llenadero && nombre_llenadero !== llenadero.nombre_llenadero) {
      const existe = await Llenadero.findOne({
        where: {
          nombre_llenadero,
          id_llenadero: { [Op.ne]: id },
        },
        transaction: t,
      });
      if (existe) {
        const error = new Error(
          `El llenadero '${nombre_llenadero}' ya existe.`,
        );
        error.status = 400;
        throw error;
      }
      llenadero.nombre_llenadero = nombre_llenadero;
    }

    if (capacidad !== undefined) llenadero.capacidad = capacidad;
    if (id_combustible !== undefined) llenadero.id_combustible = id_combustible;
    if (disponibilidadActual !== undefined)
      llenadero.disponibilidadActual = disponibilidadActual;
    if (estado) llenadero.estado = estado;

    llenadero.fecha_modificacion = new Date();
    await llenadero.save({ transaction: t });

    return llenadero;
  });
};

/**
 * Desactivar Llenadero
 */
exports.desactivarLlenadero = async (id, clientIp) => {
  return await executeTransaction(clientIp, async (t) => {
    const llenadero = await Llenadero.findByPk(id, { transaction: t });

    if (!llenadero) {
      const error = new Error("Llenadero no encontrado");
      error.status = 404;
      throw error;
    }

    await llenadero.update(
      {
        estado: "INACTIVO",
        fecha_modificacion: new Date(),
      },
      { transaction: t },
    );

    return { id_llenadero: id, estado: "INACTIVO" };
  });
};

/**
 * Lista Simple (Para selectores)
 */
exports.obtenerListaLlenaderos = async () => {
  return await Llenadero.findAll({
    where: { estado: "ACTIVO" },
    include: [
      { model: TipoCombustible, as: "TipoCombustible", attributes: ["nombre"] },
    ],
    order: [["nombre_llenadero", "ASC"]],
  });
};
