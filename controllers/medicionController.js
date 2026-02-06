const { MedicionTanque, Tanque, Usuario, Llenadero, TipoCombustible } = require("../models");
const { sequelize } = require("../config/database");
const { paginate } = require("../helpers/paginationHelper");
const { Op } = require("sequelize");

/**
 * crearMedicion
 * Registra una nueva medición física de un tanque
 */
exports.crearMedicion = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id_usuario } = req.usuario;
    const {
      id_tanque,
      fecha_medicion,
      hora_medicion,
      medida_vara,
      volumen_real,
      merma_evaporacion,
      observaciones
    } = req.body;

    // 1. Buscar y Bloquear Tanque para obtener volumen teórico actual
    const tanque = await Tanque.findByPk(id_tanque, {
      transaction: t,
      lock: true
    });

    if (!tanque) {
      await t.rollback();
      return res.status(404).json({ msg: "Tanque no encontrado." });
    }

    const volumen_teorico = parseFloat(tanque.nivel_actual);
    const v_real = parseFloat(volumen_real);
    const v_merma = parseFloat(merma_evaporacion || 0);

    // 2. Calcular Diferencia Neta (Teórico - Real)
    // El teórico ya debería considerar las salidas del sistema.
    // La diferencia es cuánto falta o sobra respecto a lo que el sistema dice tener.
    const diferencia = parseFloat((volumen_teorico - v_real).toFixed(2));

    // 3. Crear Registro de Medición
    const nuevaMedicion = await MedicionTanque.create({
      id_tanque,
      id_usuario,
      fecha_medicion,
      hora_medicion,
      medida_vara,
      volumen_real: v_real,
      volumen_teorico,
      diferencia,
      merma_evaporacion: v_merma,
      observaciones,
      estado: 'PROCESADO'
    }, { transaction: t });

    // 4. Opcional: Actualizar el nivel actual del tanque con la medición real?
    // Generalmente las mediciones físicas sirven para auditoría y ajuste.
    // Si el requerimiento pide que el sistema se "ajuste" a la realidad:
    await tanque.update({ nivel_actual: v_real }, { transaction: t });

    await t.commit();

    // Notificar via Socket.io
    if (req.io) {
      req.io.emit("tanque:actualizado", { 
        id_tanque: tanque.id_tanque, 
        nivel_actual: v_real 
      });
      req.io.emit("medicion:creada", nuevaMedicion);
    }

    res.status(201).json({
      msg: "Medición física registrada exitosamente.",
      data: nuevaMedicion,
      resumen: {
        teorico: volumen_teorico,
        real: v_real,
        diferencia: diferencia
      }
    });

  } catch (error) {
    if (t) await t.rollback();
    console.error("Error en crearMedicion:", error);
    res.status(500).json({ msg: "Error al registrar la medición física." });
  }
};

/**
 * listarMediciones
 */
exports.listarMediciones = async (req, res) => {
  try {
    const where = {};
    const { id_tanque, fecha_inicio, fecha_fin } = req.query;

    if (id_tanque) where.id_tanque = id_tanque;
    
    if (fecha_inicio && fecha_fin) {
      where.fecha_medicion = { [Op.between]: [fecha_inicio, fecha_fin] };
    }

    const searchableFields = ["observaciones"];

    const result = await paginate(MedicionTanque, req.query, {
      where,
      searchableFields,
      include: [
        { 
          model: Tanque, 
          as: 'Tanque', 
          attributes: ['codigo', 'nombre'],
          include: [{ model: Llenadero, as: 'Llenadero', attributes: ['nombre_llenadero'] }]
        },
        { model: Usuario, as: 'Usuario', attributes: ['nombre', 'apellido'] }
      ],
      order: [['fecha_medicion', 'DESC'], ['hora_medicion', 'DESC']]
    });

    res.json(result);
  } catch (error) {
    console.error("Error en listarMediciones:", error);
    res.status(500).json({ msg: "Error al listar mediciones." });
  }
};

/**
 * anularMedicion
 * Cambia el estado a ANULADO. No revierte el stock automáticamente por seguridad (requiere auditoría)
 */
exports.anularMedicion = async (req, res) => {
  const { id } = req.params;
  try {
    const medicion = await MedicionTanque.findByPk(id);
    if (!medicion) return res.status(404).json({ msg: "Medición no encontrada." });

    if (medicion.estado === 'ANULADO') {
      return res.status(400).json({ msg: "La medición ya se encuentra anulada." });
    }

    await medicion.update({ estado: 'ANULADO' });

    if (req.io) req.io.emit("medicion:actualizada", medicion);

    res.json({ msg: "Medición anulada correctamente." });
  } catch (error) {
    console.error("Error en anularMedicion:", error);
    res.status(500).json({ msg: "Error al anular la medición." });
  }
};

/**
 * actualizarMedicion
 */
exports.actualizarMedicion = async (req, res) => {
  const { id } = req.params;
  const t = await sequelize.transaction();
  try {
    const medicion = await MedicionTanque.findByPk(id, { transaction: t });
    if (!medicion) {
      await t.rollback();
      return res.status(404).json({ msg: "Medición no encontrada." });
    }

    if (medicion.estado === 'ANULADO') {
      await t.rollback();
      return res.status(400).json({ msg: "No se puede modificar una medición anulada." });
    }

    const {
      fecha_medicion,
      hora_medicion,
      medida_vara,
      volumen_real,
      merma_evaporacion,
      observaciones
    } = req.body;

    const v_real = parseFloat(volumen_real);
    const v_teorico = parseFloat(medicion.volumen_teorico);
    const diferencia = parseFloat((v_teorico - v_real).toFixed(2));

    await medicion.update({
      fecha_medicion,
      hora_medicion,
      medida_vara,
      volumen_real: v_real,
      diferencia,
      merma_evaporacion,
      observaciones
    }, { transaction: t });

    // Si la medición modificada es de hoy, podríamos querer re-ajustar el tanque
    // pero por simplicidad y auditoría, solo actualizamos el registro.
    // Opcional: Ajustar tanque si es la última medición.
    const tanque = await Tanque.findByPk(medicion.id_tanque, { transaction: t, lock: true });
    if (tanque) {
      await tanque.update({ nivel_actual: v_real }, { transaction: t });
      if (req.io) req.io.emit("tanque:actualizado", { id_tanque: tanque.id_tanque, nivel_actual: v_real });
    }

    await t.commit();

    if (req.io) req.io.emit("medicion:actualizada", medicion);

    res.json({ msg: "Medición actualizada correctamente.", data: medicion });
  } catch (error) {
    if (t) await t.rollback();
    console.error("Error en actualizarMedicion:", error);
    res.status(500).json({ msg: "Error al actualizar la medición." });
  }
};
