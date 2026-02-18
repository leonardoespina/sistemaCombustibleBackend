const {
  CargaCisterna,
  Tanque,
  Usuario,
  TipoCombustible,
} = require("../models");
const { paginate } = require("../helpers/paginationHelper");
const { executeTransaction } = require("../helpers/transactionHelper");
const { Op } = require("sequelize");

/**
 * Crear Carga de Cisterna
 */
exports.crearCargaCisterna = async (data, user, clientIp) => {
  const { id_usuario } = user;
  const {
    numero_guia,
    fecha_emision,
    fecha_recepcion,
    fecha,
    hora,
    placa_cisterna,
    nombre_chofer,
    id_tanque,
    litros_segun_guia,
    medida_inicial,
    medida_final,
    litros_iniciales,
    litros_finales,
    litros_recibidos,
    diferencia_guia,
    litros_flujometro,
    peso_entrada,
    peso_salida,
    hora_inicio_descarga,
    hora_fin_descarga,
    observacion,
  } = data;

  return await executeTransaction(clientIp, async (t) => {
    const tanque = await Tanque.findByPk(id_tanque, {
      transaction: t,
      lock: true,
    });
    if (!tanque) {
      throw new Error("Tanque receptor no encontrado.");
    }

    const nuevaCarga = await CargaCisterna.create(
      {
        numero_guia,
        fecha_emision,
        fecha_recepcion,
        fecha_llegada: `${fecha}T${hora}`,
        placa_cisterna,
        nombre_chofer,
        id_almacenista: id_usuario,
        id_tanque,
        id_tipo_combustible: tanque.id_tipo_combustible,
        litros_segun_guia,
        medida_inicial,
        medida_final,
        litros_iniciales,
        litros_finales,
        litros_recibidos,
        diferencia_guia,
        litros_flujometro,
        peso_entrada,
        peso_salida,
        hora_inicio_descarga,
        hora_fin_descarga,
        observacion,
        id_usuario_registro: id_usuario,
        estado: "PROCESADO",
      },
      { transaction: t },
    );

    const nuevoNivel =
      parseFloat(tanque.nivel_actual) + parseFloat(litros_recibidos);
    await tanque.update({ nivel_actual: nuevoNivel }, { transaction: t });

    return { nuevaCarga, nuevoNivel, id_tanque };
  });
};

/**
 * Listar Cargas de Cisterna
 */
exports.listarCargasCisterna = async (query) => {
  const { id_tanque, fecha_inicio, fecha_fin } = query;
  const where = {};

  if (id_tanque) where.id_tanque = id_tanque;
  if (fecha_inicio && fecha_fin) {
    where.fecha_llegada = { [Op.between]: [fecha_inicio, fecha_fin] };
  }

  const searchableFields = ["numero_guia", "placa_cisterna", "observacion"];

  return await paginate(CargaCisterna, query, {
    where,
    searchableFields,
    include: [
      { model: Tanque, as: "Tanque", attributes: ["codigo", "nombre"] },
      {
        model: Usuario,
        as: "Almacenista",
        attributes: ["nombre", "apellido"],
      },
    ],
    order: [["fecha_llegada", "DESC"]],
  });
};

/**
 * Actualizar Carga
 */
exports.actualizarCarga = async (id, data, clientIp) => {
  const {
    numero_guia,
    fecha_emision,
    fecha_recepcion,
    fecha,
    hora,
    placa_cisterna,
    nombre_chofer,
    litros_recibidos,
    observacion,
  } = data;

  return await executeTransaction(clientIp, async (t) => {
    const carga = await CargaCisterna.findByPk(id, {
      transaction: t,
      lock: true,
    });
    if (!carga) {
      throw new Error("Carga no encontrada.");
    }

    const v_recibido_nuevo = parseFloat(litros_recibidos);
    const v_recibido_anterior = parseFloat(carga.litros_recibidos);
    let nuevoNivel = null;
    let id_tanque = null;

    if (v_recibido_nuevo !== v_recibido_anterior) {
      const tanque = await Tanque.findByPk(carga.id_tanque, {
        transaction: t,
        lock: true,
      });
      if (tanque) {
        nuevoNivel =
          parseFloat(tanque.nivel_actual) -
          v_recibido_anterior +
          v_recibido_nuevo;
        await tanque.update({ nivel_actual: nuevoNivel }, { transaction: t });
        id_tanque = tanque.id_tanque;
      }
    }

    await carga.update(
      {
        numero_guia,
        fecha_emision,
        fecha_recepcion,
        fecha_llegada: `${fecha}T${hora}`,
        placa_cisterna,
        nombre_chofer,
        litros_recibidos: v_recibido_nuevo,
        observacion,
      },
      { transaction: t },
    );

    return { carga, nuevoNivel, id_tanque };
  });
};
