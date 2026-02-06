const { TransferenciaInterna, Tanque, Usuario, Llenadero } = require("../models");
const { sequelize } = require("../config/database");
const { paginate } = require("../helpers/paginationHelper");
const { Op } = require("sequelize");

/**
 * crearTransferencia
 */
exports.crearTransferencia = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id_usuario } = req.usuario;
    const {
      fecha_transferencia,
      id_tanque_origen,
      id_tanque_destino,
      cantidad_transferida,
      medida_vara_destino,
      observacion
    } = req.body;

    const [tanqueOrigen, tanqueDestino] = await Promise.all([
      Tanque.findByPk(id_tanque_origen, { transaction: t, lock: true }),
      Tanque.findByPk(id_tanque_destino, { transaction: t, lock: true })
    ]);

    if (!tanqueOrigen || !tanqueDestino) {
      await t.rollback();
      return res.status(404).json({ msg: "Uno o ambos tanques no fueron encontrados." });
    }

    const v_transferido = parseFloat(cantidad_transferida);
    const nivel_origen_antes = parseFloat(tanqueOrigen.nivel_actual);
    const nivel_destino_antes = parseFloat(tanqueDestino.nivel_actual);

    if (nivel_origen_antes < v_transferido) {
      await t.rollback();
      return res.status(400).json({ msg: "Inventario insuficiente en el tanque de origen." });
    }

    const nivel_origen_despues = nivel_origen_antes - v_transferido;
    const nivel_destino_despues = nivel_destino_antes + v_transferido;

    const nuevaTransferencia = await TransferenciaInterna.create({
      fecha_transferencia,
      id_tanque_origen,
      id_tanque_destino,
      cantidad_transferida: v_transferido,
      nivel_origen_antes,
      nivel_origen_despues,
      nivel_destino_antes,
      nivel_destino_despues,
      id_almacenista: id_usuario,
      medida_vara_destino,
      observacion,
      estado: 'PROCESADO'
    }, { transaction: t });

    await tanqueOrigen.update({ nivel_actual: nivel_origen_despues }, { transaction: t });
    await tanqueDestino.update({ nivel_actual: nivel_destino_despues }, { transaction: t });

    await t.commit();

    if (req.io) {
      req.io.emit("tanque:actualizado", { id_tanque: tanqueOrigen.id_tanque, nivel_actual: nivel_origen_despues });
      req.io.emit("tanque:actualizado", { id_tanque: tanqueDestino.id_tanque, nivel_actual: nivel_destino_despues });
      req.io.emit("transferencia:creada", nuevaTransferencia);
    }

    res.status(201).json({
      msg: "Transferencia interna registrada exitosamente.",
      data: nuevaTransferencia
    });

  } catch (error) {
    if (t) await t.rollback();
    console.error("Error en crearTransferencia:", error);
    res.status(500).json({ msg: "Error al registrar la transferencia interna." });
  }
};

/**
 * listarTransferencias
 */
exports.listarTransferencias = async (req, res) => {
  try {
    const { id_tanque, fecha_inicio, fecha_fin } = req.query;
    const where = {};

    if (id_tanque) {
      where[Op.or] = [
        { id_tanque_origen: id_tanque },
        { id_tanque_destino: id_tanque }
      ];
    }

    if (fecha_inicio && fecha_fin) {
      where.fecha_transferencia = { [Op.between]: [fecha_inicio, fecha_fin] };
    }

    const searchableFields = ["observacion"];

    const result = await paginate(TransferenciaInterna, req.query, {
      where,
      searchableFields,
      include: [
        { 
          model: Tanque, 
          as: 'TanqueOrigen', 
          attributes: ['id_tanque', 'codigo', 'nombre', 'id_llenadero'],
          include: [{ model: Llenadero, as: 'Llenadero', attributes: ['nombre_llenadero'] }]
        },
        { 
          model: Tanque, 
          as: 'TanqueDestino', 
          attributes: ['id_tanque', 'codigo', 'nombre', 'id_llenadero'],
          include: [{ model: Llenadero, as: 'Llenadero', attributes: ['nombre_llenadero'] }]
        },
        { model: Usuario, as: 'Almacenista', attributes: ['id_usuario', 'nombre', 'apellido'] }
      ],
      order: [['fecha_transferencia', 'DESC']]
    });

    res.json(result);
  } catch (error) {
    console.error("CRITICAL ERROR en listarTransferencias:", error.message);
    res.status(500).json({ 
      msg: "Error al listar transferencias.", 
      error: error.message,
      stack: error.stack 
    });
  }
};

/**
 * actualizarTransferencia
 */
exports.actualizarTransferencia = async (req, res) => {
  const { id } = req.params;
  try {
    const transferencia = await TransferenciaInterna.findByPk(id);
    if (!transferencia) return res.status(404).json({ msg: "Transferencia no encontrada." });

    const { observacion } = req.body;
    await transferencia.update({ observacion, estado: 'MODIFICADO' });

    if (req.io) req.io.emit("transferencia:actualizada", transferencia);

    res.json({ msg: "Transferencia actualizada correctamente.", data: transferencia });
  } catch (error) {
    console.error("Error en actualizarTransferencia:", error);
    res.status(500).json({ msg: "Error al actualizar la transferencia." });
  }
};

/**
 * obtenerTransferenciaPorId
 */
exports.obtenerTransferenciaPorId = async (req, res) => {
  const { id } = req.params;
  try {
    const transferencia = await TransferenciaInterna.findByPk(id, {
      include: [
        { 
          model: Tanque, 
          as: 'TanqueOrigen', 
          attributes: ['id_tanque', 'codigo', 'nombre', 'id_llenadero'],
          include: [{ model: Llenadero, as: 'Llenadero', attributes: ['nombre_llenadero'] }]
        },
        { 
          model: Tanque, 
          as: 'TanqueDestino', 
          attributes: ['id_tanque', 'codigo', 'nombre', 'id_llenadero'],
          include: [{ model: Llenadero, as: 'Llenadero', attributes: ['nombre_llenadero'] }]
        },
        { model: Usuario, as: 'Almacenista', attributes: ['id_usuario', 'nombre', 'apellido'] }
      ]
    });
    if (!transferencia) return res.status(404).json({ msg: "Transferencia no encontrada." });
    res.json(transferencia);
  } catch (error) {
    res.status(500).json({ msg: "Error al obtener detalle." });
  }
};
