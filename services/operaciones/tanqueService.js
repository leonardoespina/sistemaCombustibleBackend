const { Tanque, Llenadero, TipoCombustible } = require("../../models");
const { paginate } = require("../../helpers/paginationHelper");
const { executeTransaction } = require("../../helpers/transactionHelper");
const { Op } = require("sequelize");

/**
 * Crear Tanque
 */
exports.crearTanque = async (data, clientIp) => {
  const {
    id_llenadero,
    codigo,
    nombre,
    id_tipo_combustible,
    tipo_tanque,
    capacidad_maxima,
    nivel_alarma_bajo,
    nivel_alarma_alto,
    unidad_medida,
    alto,
    radio,
    largo,
    ancho,
    con_aforo,
    aforo,
  } = data;

  return await executeTransaction(clientIp, async (t) => {
    // 1. Validaciones de Integridad
    const [llenadero, combustible] = await Promise.all([
      Llenadero.findByPk(id_llenadero, { transaction: t }),
      TipoCombustible.findByPk(id_tipo_combustible, { transaction: t }),
    ]);

    if (!llenadero) {
      const error = new Error("El llenadero especificado no existe");
      error.status = 404;
      throw error;
    }
    if (!combustible) {
      const error = new Error("El tipo de combustible no es válido");
      error.status = 404;
      throw error;
    }

    // 2. Validar duplicado de código
    const tanqueExistente = await Tanque.findOne({
      where: { codigo },
      transaction: t,
    });
    if (tanqueExistente) {
      const error = new Error(`El código ${codigo} ya está registrado.`);
      error.status = 400;
      throw error;
    }

    // 3. Crear registro
    const tanque = await Tanque.create(
      {
        id_llenadero,
        codigo,
        nombre,
        id_tipo_combustible,
        tipo_tanque,
        capacidad_maxima: capacidad_maxima || 0,
        nivel_actual: 0,
        nivel_alarma_bajo,
        nivel_alarma_alto,
        unidad_medida: unidad_medida || "CM",
        alto,
        radio,
        largo,
        ancho,
        estado: "ACTIVO",
        con_aforo: !!con_aforo,
        aforo: aforo || [],
      },
      { transaction: t },
    );

    return tanque;
  });
};

/**
 * Obtener Tanques (Paginado)
 */
exports.obtenerTanques = async (query) => {
  const { id_llenadero, id_tipo_combustible, estado, tipo_tanque, con_aforo } =
    query;

  const searchableFields = ["codigo", "nombre"];
  const where = {};

  if (id_llenadero) where.id_llenadero = id_llenadero;
  if (id_tipo_combustible) where.id_tipo_combustible = id_tipo_combustible;
  if (estado) where.estado = estado;
  if (tipo_tanque) where.tipo_tanque = tipo_tanque;
  if (con_aforo !== undefined) where.con_aforo = con_aforo === "true";

  return await paginate(Tanque, query, {
    where,
    searchableFields,
    include: [
      { model: Llenadero, as: "Llenadero", attributes: ["nombre_llenadero"] },
      { model: TipoCombustible, as: "TipoCombustible", attributes: ["nombre"] },
    ],
    order: [["id_tanque", "DESC"]],
  });
};

/**
 * Actualizar Tanque
 */
exports.actualizarTanque = async (id, data, clientIp) => {
  return await executeTransaction(clientIp, async (t) => {
    const tanque = await Tanque.findByPk(id, { transaction: t });
    if (!tanque) {
      const error = new Error("Tanque no encontrado");
      error.status = 404;
      throw error;
    }

    // 1. Validar código duplicado
    if (data.codigo && data.codigo !== tanque.codigo) {
      const existe = await Tanque.findOne({
        where: { codigo: data.codigo, id_tanque: { [Op.ne]: id } },
        transaction: t,
      });
      if (existe) {
        const error = new Error("El nuevo código ya está en uso");
        error.status = 400;
        throw error;
      }
    }

    // 2. Validar Relaciones si cambian
    if (data.id_llenadero) {
      const existeLlenadero = await Llenadero.findByPk(data.id_llenadero, {
        transaction: t,
      });
      if (!existeLlenadero) {
        const error = new Error("Llenadero no válido");
        error.status = 404;
        throw error;
      }
    }
    if (data.id_tipo_combustible) {
      const existeCombustible = await TipoCombustible.findByPk(
        data.id_tipo_combustible,
        { transaction: t },
      );
      if (!existeCombustible) {
        const error = new Error("Tipo de combustible no válido");
        error.status = 404;
        throw error;
      }
    }

    // 3. Actualizar registro
    await tanque.update(data, { transaction: t });

    return tanque;
  });
};

/**
 * Obtener Tanque por ID
 */
exports.obtenerTanquePorId = async (id) => {
  const tanque = await Tanque.findByPk(id, {
    include: [
      { model: Llenadero, as: "Llenadero", attributes: ["nombre_llenadero"] },
      { model: TipoCombustible, as: "TipoCombustible", attributes: ["nombre"] },
    ],
  });

  if (!tanque) {
    const error = new Error("Tanque no encontrado");
    error.status = 404;
    throw error;
  }

  return tanque;
};

/**
 * Desactivar Tanque
 */
exports.eliminarTanque = async (id, clientIp) => {
  return await executeTransaction(clientIp, async (t) => {
    const tanque = await Tanque.findByPk(id, { transaction: t });
    if (!tanque) {
      const error = new Error("Tanque no encontrado");
      error.status = 404;
      throw error;
    }

    await tanque.update({ estado: "INACTIVO" }, { transaction: t });

    return { id_tanque: id, estado: "INACTIVO" };
  });
};

/**
 * Lista Simple (Para selectores)
 */
exports.obtenerListaTanques = async (query) => {
  const { id_llenadero, id_tipo_combustible } = query;
  const where = { estado: "ACTIVO" };

  if (id_llenadero) where.id_llenadero = id_llenadero;
  if (id_tipo_combustible) where.id_tipo_combustible = id_tipo_combustible;

  return await Tanque.findAll({
    where,
    attributes: [
      "id_tanque",
      "codigo",
      "nombre",
      "capacidad_maxima",
      "nivel_actual",
      "tipo_tanque",
      "con_aforo",
      "id_tipo_combustible",
    ],
    include: [
      { model: TipoCombustible, as: "TipoCombustible", attributes: ["nombre"] },
    ],
    order: [["nombre", "ASC"]],
  });
};
