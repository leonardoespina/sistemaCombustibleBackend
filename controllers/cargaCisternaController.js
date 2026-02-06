const { CargaCisterna, Tanque, Usuario, TipoCombustible } = require("../models");
const { sequelize } = require("../config/database");
const { paginate } = require("../helpers/paginationHelper");
const { Op } = require("sequelize");

/**
 * crearCargaCisterna
 */
exports.crearCargaCisterna = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id_usuario } = req.usuario;
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
      observacion
    } = req.body;

    const tanque = await Tanque.findByPk(id_tanque, { transaction: t, lock: true });
    if (!tanque) {
      await t.rollback();
      return res.status(404).json({ msg: "Tanque receptor no encontrado." });
    }

    const nuevaCarga = await CargaCisterna.create({
      numero_guia,
      fecha_emision,
      fecha_recepcion,
      fecha_llegada: `${fecha}T${hora}`,
      placa_cisterna,
      nombre_chofer,
      id_almacenista: id_usuario, // Usuario logueado es el receptor
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
      estado: 'PROCESADO'
    }, { transaction: t });

    const nuevoNivel = parseFloat(tanque.nivel_actual) + parseFloat(litros_recibidos);
    await tanque.update({ nivel_actual: nuevoNivel }, { transaction: t });

    await t.commit();

    if (req.io) {
      req.io.emit("tanque:actualizado", { id_tanque: tanque.id_tanque, nivel_actual: nuevoNivel });
      req.io.emit("carga:creada", nuevaCarga);
    }

    res.status(201).json({
      msg: "Carga de cisterna registrada exitosamente.",
      data: nuevaCarga
    });

  } catch (error) {
    if (t) await t.rollback();
    console.error("Error en crearCargaCisterna:", error);
    res.status(500).json({ msg: "Error al registrar la carga." });
  }
};

/**
 * listarCargasCisterna
 */
exports.listarCargasCisterna = async (req, res) => {
  try {
    const { id_tanque, fecha_inicio, fecha_fin } = req.query;
    const where = {};

    if (id_tanque) where.id_tanque = id_tanque;
    if (fecha_inicio && fecha_fin) {
      where.fecha_llegada = { [Op.between]: [fecha_inicio, fecha_fin] };
    }

    const searchableFields = ["numero_guia", "placa_cisterna", "observacion"];

    const result = await paginate(CargaCisterna, req.query, {
      where,
      searchableFields,
      include: [
        { model: Tanque, as: 'Tanque', attributes: ['codigo', 'nombre'] },
        { model: Usuario, as: 'Almacenista', attributes: ['nombre', 'apellido'] }
      ],
      order: [['fecha_llegada', 'DESC']]
    });

    res.json(result);
  } catch (error) {
    console.error("Error en listarCargasCisterna:", error);
    res.status(500).json({ msg: "Error al listar cargas." });
  }
};

/**
 * actualizarCarga
 */
exports.actualizarCarga = async (req, res) => {
  const { id } = req.params;
  const t = await sequelize.transaction();
  try {
    const carga = await CargaCisterna.findByPk(id, { transaction: t, lock: true });
    if (!carga) {
      await t.rollback();
      return res.status(404).json({ msg: "Carga no encontrada." });
    }

    const {
      numero_guia,
      fecha_emision,
      fecha_recepcion,
      fecha,
      hora,
      placa_cisterna,
      nombre_chofer,
      litros_recibidos,
      observacion
    } = req.body;

    const v_recibido_nuevo = parseFloat(litros_recibidos);
    const v_recibido_anterior = parseFloat(carga.litros_recibidos);

    if (v_recibido_nuevo !== v_recibido_anterior) {
      const tanque = await Tanque.findByPk(carga.id_tanque, { transaction: t, lock: true });
      if (tanque) {
        const nuevoNivel = parseFloat(tanque.nivel_actual) - v_recibido_anterior + v_recibido_nuevo;
        await tanque.update({ nivel_actual: nuevoNivel }, { transaction: t });
        if (req.io) req.io.emit("tanque:actualizado", { id_tanque: tanque.id_tanque, nivel_actual: nuevoNivel });
      }
    }

    await carga.update({
      numero_guia,
      fecha_emision,
      fecha_recepcion,
      fecha_llegada: `${fecha}T${hora}`,
      placa_cisterna,
      nombre_chofer,
      litros_recibidos: v_recibido_nuevo,
      observacion
    }, { transaction: t });

    await t.commit();

    if (req.io) req.io.emit("carga:actualizada", carga);

    res.json({ msg: "Carga actualizada correctamente.", data: carga });
  } catch (error) {
    if (t) await t.rollback();
    console.error("Error en actualizarCarga:", error);
    res.status(500).json({ msg: "Error al actualizar la carga." });
  }
};
