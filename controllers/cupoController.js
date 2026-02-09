const CupoBase = require("../models/CupoBase");
const CupoActual = require("../models/CupoActual");
const RecargaCupo = require("../models/RecargaCupo");
const ConsumoCupo = require("../models/ConsumoCupo");
const HistorialCupoMensual = require("../models/HistorialCupoMensual");
const Categoria = require("../models/Categoria");
const Dependencia = require("../models/Dependencia");
const Subdependencia = require("../models/Subdependencia");
const TipoCombustible = require("../models/TipoCombustible");
const { sequelize } = require("../config/database");
const { Op } = require("sequelize");
const moment = require("moment");
const { paginate } = require("../helpers/paginationHelper");
const { withTransaction } = require("../helpers/transactionHelper");

// --- CONTROLADOR DE CUPOS ---

/**
 * Obtener todos los cupos base (Paginado y Filtrado)
 */
exports.obtenerCuposBase = async (req, res) => {
  try {
    const searchableFields = ["$Categoria.nombre$", "$Dependencia.nombre_dependencia$", "$Subdependencia.nombre$"];

    const include = [
      { model: Categoria, as: "Categoria", attributes: ["nombre"] },
      { model: Dependencia, as: "Dependencia", attributes: ["nombre_dependencia"] },
      { model: Subdependencia, as: "Subdependencia", attributes: ["nombre"] },
      { model: TipoCombustible, as: "TipoCombustible", attributes: ["nombre"] },
    ];

    const paginatedResults = await paginate(CupoBase, req.query, {
      searchableFields,
      include
    });

    res.json(paginatedResults);
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: "Error al obtener cupos base" });
  }
};

/**
 * Crear un nuevo cupo base
 */
exports.crearCupoBase = async (req, res) => {
  const { id_categoria, id_dependencia, id_subdependencia, id_tipo_combustible, cantidad_mensual } = req.body;

  try {
    await withTransaction(req, async (t) => {
      // Verificar existencia previa manualmente para evitar error de constraint genérico
      const existing = await CupoBase.findOne({
        where: {
          id_categoria,
          id_dependencia,
          id_subdependencia: id_subdependencia || null,
          id_tipo_combustible
        },
        transaction: t
      });

      if (existing) {
        if (!res.headersSent) return res.status(400).json({ msg: "Ya existe un cupo para esta combinación de categoría, dependencia, subdependencia y combustible" });
        return;
      }

      const nuevoCupo = await CupoBase.create(
        {
          id_categoria,
          id_dependencia,
          id_subdependencia: id_subdependencia || null,
          id_tipo_combustible,
          cantidad_mensual,
        },
        { transaction: t }
      );

      // Opcional: Crear inmediatamente el cupo actual para el mes en curso si no existe
      const periodoActual = moment().format("YYYY-MM");
      const fechaInicio = moment().startOf("month").toDate();
      const fechaFin = moment().endOf("month").toDate();

      await CupoActual.create({
        id_cupo_base: nuevoCupo.id_cupo_base,
        periodo: periodoActual,
        cantidad_asignada: cantidad_mensual,
        cantidad_disponible: cantidad_mensual,
        fecha_inicio: fechaInicio,
        fecha_fin: fechaFin,
        estado: "ACTIVO"
      }, { transaction: t });

      // Notificar via socket
      req.io.emit("cupo:creado", nuevoCupo);

      res.status(201).json({ msg: "Cupo base creado exitosamente", data: nuevoCupo });
    });
  } catch (error) {
    console.error(error);
    if (error.name === 'SequelizeUniqueConstraintError') {
      if (!res.headersSent) return res.status(400).json({ msg: "Ya existe un cupo para esta combinación de categoría, dependencia, subdependencia y combustible" });
    }
    if (!res.headersSent) res.status(500).json({ msg: "Error al crear cupo base" });
  }
};

/**
 * Actualizar cupo base (cambia la asignación mensual para futuros meses)
 */
exports.actualizarCupoBase = async (req, res) => {
  const { id } = req.params;
  const { cantidad_mensual, activo } = req.body;

  try {
    await withTransaction(req, async (t) => {
      const cupo = await CupoBase.findByPk(id, { transaction: t });
      if (!cupo) {
        if (!res.headersSent) return res.status(404).json({ msg: "Cupo base no encontrado" });
        return;
      }

      await cupo.update({
        cantidad_mensual: cantidad_mensual !== undefined ? cantidad_mensual : cupo.cantidad_mensual,
        activo: activo !== undefined ? activo : cupo.activo,
        updated_at: new Date()
      }, { transaction: t });

      // Actualizar cupo actual si cambia la cantidad mensual
      if (cantidad_mensual !== undefined) {
        const periodoActual = moment().format("YYYY-MM");
        const cupoActual = await CupoActual.findOne({
          where: {
            id_cupo_base: id,
            periodo: periodoActual
          },
          transaction: t
        });

        if (cupoActual) {
          const nuevaCantidadAsignada = parseFloat(cantidad_mensual);
          const consumida = parseFloat(cupoActual.cantidad_consumida || 0);
          const recargada = parseFloat(cupoActual.cantidad_recargada || 0);

          // REGLA DE NEGOCIO: Recalcular Cantidad Disponible
          // Formula: Disponible = Asignada + Recargada - Consumida
          // Si el resultado es negativo, se establece en 0
          let nuevaDisponible = nuevaCantidadAsignada + recargada - consumida;
          if (nuevaDisponible < 0) {
            nuevaDisponible = 0;
          }

          await CupoActual.update({
            cantidad_asignada: nuevaCantidadAsignada,
            cantidad_disponible: nuevaDisponible,
            // Actualizar estado si quedó disponible en 0
            estado: nuevaDisponible <= 0 ? "AGOTADO" : "ACTIVO"
          }, { where: { id_cupo_base: id }, transaction: t });
        }
      }

      req.io.emit("cupo:actualizado", cupo);

      res.json({ msg: "Cupo base actualizado", data: cupo });
    });
  } catch (error) {
    console.error(error);
    if (error.statusCode === 400) {
      if (!res.headersSent) return res.status(400).json({ msg: error.message });
    }
    if (!res.headersSent) res.status(500).json({ msg: "Error al actualizar cupo base" });
  }
};

/**
 * Obtener estado de cupos actuales (Vista Principal - Paginada)
 */
exports.obtenerCupoEspecifico = async (req, res) => {
  const { id_subdependencia, id_tipo_combustible } = req.query;
  const periodoActual = moment().format("YYYY-MM");

  if (!id_subdependencia || !id_tipo_combustible) {
    return res.status(400).json({ msg: "Faltan parámetros: id_subdependencia e id_tipo_combustible son obligatorios." });
  }

  try {
    let cupo = await CupoActual.findOne({
      where: { periodo: periodoActual },
      include: [{
        model: CupoBase,
        as: "CupoBase",
        where: {
          id_subdependencia: id_subdependencia || null,
          id_tipo_combustible: id_tipo_combustible || null
        }
      }]
    });

    // --- Lazy Initialization ---
    if (!cupo) {
      // Verificar si existen cupos EN GENERAL para este mes
      const countMes = await CupoActual.count({ where: { periodo: periodoActual } });
      if (countMes === 0) {
        console.log(`[LazyInit] No hay cupos para ${periodoActual}. Inicializando...`);
        await exports.reiniciarCuposMensuales();
        // Re-intentar busqueda del específico
        cupo = await CupoActual.findOne({
          where: { periodo: periodoActual },
          include: [{
            model: CupoBase,
            as: "CupoBase",
            where: {
              id_subdependencia: id_subdependencia || null,
              id_tipo_combustible: id_tipo_combustible || null
            }
          }]
        });
      }
    }

    if (!cupo) {
      return res.status(404).json({ msg: "No se encontró cupo para los criterios especificados." });
    }

    res.json({ data: cupo });
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: "Error al obtener el cupo específico" });
  }
};

exports.obtenerCuposActuales = async (req, res) => {
  const periodoActual = moment().format("YYYY-MM");

  try {
    const searchableFields = [
      "$CupoBase.Categoria.nombre$",
      "$CupoBase.Dependencia.nombre_dependencia$",
      "$CupoBase.Subdependencia.nombre$"
    ];
    const include = [
      {
        model: CupoBase,
        as: "CupoBase",
        include: [
          { model: Categoria, as: "Categoria", attributes: ["nombre"] },
          { model: Dependencia, as: "Dependencia", attributes: ["nombre_dependencia"] },
          { model: Subdependencia, as: "Subdependencia", attributes: ["nombre"] },
          { model: TipoCombustible, as: "TipoCombustible", attributes: ["nombre"] },
        ],
      },
    ];
    const where = { periodo: periodoActual };

    let paginatedResults = await paginate(CupoActual, req.query, {
      searchableFields,
      include,
      where
    });

    // --- Lazy Initialization para la lista completa ---
    if (paginatedResults.data.length === 0 && (!req.query.search)) {
      // Si no hay nada y no es por una busqueda filtrada, puede ser que el mes no se haya iniciado
      const countTotal = await CupoActual.count({ where: { periodo: periodoActual } });
      if (countTotal === 0) {
        console.log(`[LazyInit] Lista vacía para ${periodoActual}. Inicializando mes...`);
        await exports.reiniciarCuposMensuales();
        // Re-ejecutar paginación
        paginatedResults = await paginate(CupoActual, req.query, {
          searchableFields,
          include,
          where
        });
      }
    }

    res.json(paginatedResults);
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: "Error al obtener cupos actuales" });
  }
};

/**
 * Consumir Cupo (Función Principal 1)
 */
exports.consumirCupo = async (req, res) => {
  const { id_cupo_base, cantidad, descripcion } = req.body;
  const periodoActual = moment().format("YYYY-MM");

  try {
    await withTransaction(req, async (t) => {
      // 1. Buscar el cupo actual activo para este mes
      const cupoActual = await CupoActual.findOne({
        where: {
          id_cupo_base,
          periodo: periodoActual,
        },
        transaction: t,
        lock: true, // Bloqueo pesimista
      });

      if (!cupoActual) {
        if (!res.headersSent) return res.status(404).json({ msg: "No existe un cupo activo para este periodo" });
        return;
      }

      if (cupoActual.estado !== "ACTIVO") {
        if (!res.headersSent) return res.status(400).json({ msg: `El cupo está ${cupoActual.estado}` });
        return;
      }

      // 2. Validar saldo suficiente
      if (parseFloat(cupoActual.cantidad_disponible) < parseFloat(cantidad)) {
        if (!res.headersSent) return res.status(400).json({
          msg: "Saldo insuficiente",
          disponible: cupoActual.cantidad_disponible
        });
        return;
      }

      // 3. Registrar consumo
      await ConsumoCupo.create({
        id_cupo_actual: cupoActual.id_cupo_actual,
        cantidad,
        descripcion,
        fecha_consumo: new Date()
      }, { transaction: t });

      // 4. Actualizar saldos
      const nuevaDisponibilidad = parseFloat(cupoActual.cantidad_disponible) - parseFloat(cantidad);
      const nuevoConsumo = parseFloat(cupoActual.cantidad_consumida) + parseFloat(cantidad);

      let nuevoEstado = "ACTIVO";
      if (nuevaDisponibilidad <= 0) {
        nuevoEstado = "AGOTADO";
      }

      await cupoActual.update({
        cantidad_disponible: nuevaDisponibilidad,
        cantidad_consumida: nuevoConsumo,
        estado: nuevoEstado
      }, { transaction: t });

      // Emitir evento de actualización de saldo
      req.io.emit("cupo:consumo", { id_cupo_actual: cupoActual.id_cupo_actual, nuevo_saldo: nuevaDisponibilidad });

      res.json({
        exito: true,
        msg: "Consumo registrado correctamente",
        saldo_anterior: parseFloat(cupoActual.cantidad_disponible) + parseFloat(cantidad),
        saldo_actual: nuevaDisponibilidad,
        estado: nuevoEstado
      });
    });

  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.status(500).json({ msg: "Error al procesar el consumo" });
  }
};

/**
 * Recargar Cupo (Función Principal 2)
 */
exports.recargarCupo = async (req, res) => {
  const { id_cupo_base, cantidad, motivo } = req.body;
  const id_usuario = req.usuario.id_usuario;
  const periodoActual = moment().format("YYYY-MM");

  try {
    await withTransaction(req, async (t) => {
      const cupoActual = await CupoActual.findOne({
        where: { id_cupo_base, periodo: periodoActual },
        transaction: t,
        lock: true
      });

      if (!cupoActual) {
        if (!res.headersSent) return res.status(404).json({ msg: "No se encontró cupo activo para recargar" });
        return;
      }

      // REGLA DE NEGOCIO: La recarga no puede hacer que la disponibilidad supere la asignada
      const nuevaDisponibilidadEstimada = parseFloat(cupoActual.cantidad_disponible) + parseFloat(cantidad);
      if (nuevaDisponibilidadEstimada > parseFloat(cupoActual.cantidad_asignada)) {
        if (!res.headersSent) return res.status(400).json({
          msg: `La recarga excede el cupo mensual asignado. Máximo a recargar: ${parseFloat(cupoActual.cantidad_asignada) - parseFloat(cupoActual.cantidad_disponible)}`
        });
        return;
      }

      // 1. Registrar recarga
      await RecargaCupo.create({
        id_cupo_actual: cupoActual.id_cupo_actual,
        cantidad_recargada: cantidad,
        motivo,
        autorizado_por: id_usuario,
        fecha_recarga: new Date()
      }, { transaction: t });

      // 2. Actualizar saldos
      const nuevaDisponibilidad = parseFloat(cupoActual.cantidad_disponible) + parseFloat(cantidad);
      const nuevoTotalRecargado = parseFloat(cupoActual.cantidad_recargada) + parseFloat(cantidad);

      // Reactivar si estaba agotado
      let nuevoEstado = cupoActual.estado;
      if (cupoActual.estado === "AGOTADO" && nuevaDisponibilidad > 0) {
        nuevoEstado = "ACTIVO";
      }

      await cupoActual.update({
        cantidad_disponible: nuevaDisponibilidad,
        cantidad_recargada: nuevoTotalRecargado,
        estado: nuevoEstado
      }, { transaction: t });

      req.io.emit("cupo:recarga", { id_cupo_actual: cupoActual.id_cupo_actual, nuevo_saldo: nuevaDisponibilidad });

      res.json({
        exito: true,
        msg: "Recarga exitosa",
        saldo_anterior: parseFloat(cupoActual.cantidad_disponible),
        saldo_nuevo: nuevaDisponibilidad
      });
    });

  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.status(500).json({ msg: "Error al procesar la recarga" });
  }
};

/**
 * Reiniciar Cupos Mensuales (Función Principal 3 - Automatizada)
 * Esta función se debe llamar desde un CRON JOB el día 1 de cada mes.
 */
exports.reiniciarCuposMensuales = async () => {
  console.log("=== INICIANDO REINICIO MENSUAL DE CUPOS ===");

  try {
    // Usamos una transacción gestionada manualmente aquí porque es un proceso de fondo
    // y no tenemos el helper req de express
    const t = await sequelize.transaction();

    try {
      const mesAnterior = moment().subtract(1, 'month').format("YYYY-MM");
      const mesNuevo = moment().format("YYYY-MM");
      const fechaInicio = moment().startOf("month").toDate();
      const fechaFin = moment().endOf("month").toDate();

      // 1. Cerrar cupos del mes anterior
      const cuposAnteriores = await CupoActual.findAll({
        where: { periodo: mesAnterior, estado: { [Op.ne]: "CERRADO" } },
        transaction: t
      });

      for (const cupo of cuposAnteriores) {
        // Guardar historial
        await HistorialCupoMensual.create({
          id_cupo_base: cupo.id_cupo_base,
          periodo: cupo.periodo,
          cantidad_asignada: cupo.cantidad_asignada,
          cantidad_consumida: cupo.cantidad_consumida,
          cantidad_recargada: cupo.cantidad_recargada,
          cantidad_no_utilizada: cupo.cantidad_disponible, // Se pierde
          fecha_cierre: new Date()
        }, { transaction: t });

        // Cerrar
        await cupo.update({ estado: "CERRADO" }, { transaction: t });
      }

      // 2. Crear nuevos cupos para el mes actual
      const cuposBaseActivos = await CupoBase.findAll({
        where: { activo: true },
        transaction: t
      });

      for (const base of cuposBaseActivos) {
        // Verificar si ya existe para evitar duplicados en re-ejecuciones
        const existe = await CupoActual.findOne({
          where: { id_cupo_base: base.id_cupo_base, periodo: mesNuevo },
          transaction: t
        });

        if (!existe) {
          await CupoActual.create({
            id_cupo_base: base.id_cupo_base,
            periodo: mesNuevo,
            cantidad_asignada: base.cantidad_mensual,
            cantidad_disponible: base.cantidad_mensual, // Fresco, no acumulativo
            cantidad_consumida: 0,
            cantidad_recargada: 0,
            fecha_inicio: fechaInicio,
            fecha_fin: fechaFin,
            estado: "ACTIVO"
          }, { transaction: t });
        }
      }

      await t.commit();
      console.log(`=== REINICIO MENSUAL COMPLETADO: ${mesAnterior} cerrado, ${mesNuevo} iniciado ===`);

      // Notificar reinicio de cupos a todos los clientes (especial)
      // Nota: Esta función puede ser llamada sin objeto 'req', por lo que si se usa req.io
      // en otros lados, aquí dependemos de que io sea global o pasado si es Cron.
      // Pero como reiniciarCuposMensuales se exporta y usa en el cron, el cron ya tiene 'io'.

      return { success: true, msg: "Reinicio mensual completado" };

    } catch (err) {
      await t.rollback();
      throw err;
    }

  } catch (error) {
    console.error("Error crítico en reinicio mensual:", error);
    return { success: false, error: error.message };
  }
};