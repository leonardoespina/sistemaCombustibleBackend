const { Solicitud, CupoActual, Subdependencia, Llenadero, TipoCombustible, Vehiculo, Usuario, Dependencia, Categoria, CupoBase, PrecioCombustible } = require("../models");
const { sequelize } = require("../config/database");
const { paginate } = require("../helpers/paginationHelper");
const { Op } = require("sequelize");
const moment = require("moment");

/**
 * crearSolicitud
 */
exports.crearSolicitud = async (req, res) => {
  console.log("BODY RECIBIDO EN crearSolicitud:", JSON.stringify(req.body, null, 2));
  const t = await sequelize.transaction();
  try {
    // 1. Datos del Usuario (detectados del token)
    const { id_usuario } = req.usuario;

    // 2. Datos del Body (todos los campos vienen del formulario)
    const {
      id_vehiculo, placa, marca, modelo, flota,
      id_llenadero, id_tipo_combustible,
      cantidad_litros, tipo_suministro, tipo_solicitud,
      id_precio, id_subdependencia, id_dependencia, id_categoria
    } = req.body;

    // 2.1 DEBUG: Verificar qué se recibió
    console.log("DEBUG - Placa recibida:", placa);
    console.log("DEBUG - Tipo de placa:", typeof placa);
    console.log("DEBUG - Placa es falsy?:", !placa);

    // 2.2 Validar que la placa existe
    if (!placa) {
      await t.rollback();
      console.error("ERROR: La placa es undefined/null/empty");
      return res.status(400).json({ msg: "La placa del vehículo es requerida" });
    }

    // 3. Validar Bloqueo de Placa (RF-05) - Excluir solicitudes VENCIDAS
    const solicitudActiva = await Solicitud.findOne({
      where: {
        placa,
        estado: { [Op.in]: ["PENDIENTE", "APROBADA", "IMPRESA"] }
      },
      transaction: t
    });

    if (solicitudActiva) {
      await t.rollback();
      return res.status(400).json({ msg: `El vehículo ${placa} ya tiene una solicitud activa (Ticket: ${solicitudActiva.codigo_ticket || 'Pendiente'}).` });
    }

    // 4. Validar Cupo y Reservar (RF-04, RF-06)
    const periodoActual = moment().format("YYYY-MM");

    console.log("Buscando cupo_base con:", {
      id_subdependencia: id_subdependencia,
      id_tipo_combustible: id_tipo_combustible
    });

    // Primero buscar el cupo base
    const cupoBase = await CupoBase.findOne({
      where: {
        id_subdependencia: id_subdependencia || null,
        id_tipo_combustible: id_tipo_combustible || null
      },
      transaction: t
    });

    console.log("Cupo base encontrado:", cupoBase ? cupoBase.id_cupo_base : "NO ENCONTRADO");

    if (!cupoBase) {
      await t.rollback();
      return res.status(400).json({ msg: "No existe cupo base configurado para esta subdependencia y tipo de combustible." });
    }

    // Buscar o crear el cupo actual para el periodo
    let cupoActual = await CupoActual.findOne({
      where: {
        periodo: periodoActual,
        id_cupo_base: cupoBase.id_cupo_base
      },
      transaction: t,
      lock: true
    });

    // Si no existe el cupo actual para este mes, crearlo automáticamente
    if (!cupoActual) {
      const inicioMes = moment(periodoActual, 'YYYY-MM').startOf('month').toDate();
      const finMes = moment(periodoActual, 'YYYY-MM').endOf('month').toDate();

      cupoActual = await CupoActual.create({
        id_cupo_base: cupoBase.id_cupo_base,
        periodo: periodoActual,
        cantidad_asignada: cupoBase.cantidad_mensual,
        cantidad_disponible: cupoBase.cantidad_mensual,
        cantidad_consumida: 0,
        cantidad_recargada: 0,
        fecha_inicio: inicioMes,
        fecha_fin: finMes,
        estado: 'ACTIVO'
      }, { transaction: t });

      console.log(`Cupo actual creado automáticamente para periodo ${periodoActual}, cupo_base ${cupoBase.id_cupo_base}`);
    }

    if (parseFloat(cupoActual.cantidad_disponible) < parseFloat(cantidad_litros)) {
      await t.rollback();
      return res.status(400).json({
        msg: `Cupo insuficiente. Disponible: ${cupoActual.cantidad_disponible} Lts. Solicitado: ${cantidad_litros} Lts.`
      });
    }

    // Descontar del Cupo (Reserva administrativa RF-06)
    await cupoActual.decrement('cantidad_disponible', { by: cantidad_litros, transaction: t });
    await cupoActual.increment('cantidad_consumida', { by: cantidad_litros, transaction: t });

    // 5. Cálculos de Venta (RF-03)
    let precio_unitario = 0;
    let monto_total = 0;

    if (tipo_solicitud === 'VENTA') {
      const sub = await Subdependencia.findByPk(id_subdependencia);
      if (!sub || !sub.cobra_venta) {
        await t.rollback();
        return res.status(400).json({ msg: "Esta subdependencia no tiene habilitada la modalidad de venta." });
      }

      if (id_precio) {
        const precioObj = await PrecioCombustible.findByPk(id_precio);
        if (precioObj) {
          precio_unitario = precioObj.precio;
          monto_total = parseFloat(cantidad_litros) * parseFloat(precio_unitario);
        }
      } else {
        await t.rollback();
        return res.status(400).json({ msg: "El ID de precio es obligatorio para solicitudes de tipo VENTA." });
      }
    }

    // 6. Obtener Código de Dependencia para Ticket
    const depObj = await Dependencia.findByPk(id_dependencia, { transaction: t });
    if (!depObj) {
      await t.rollback();
      return res.status(404).json({ msg: "Dependencia no encontrada para generar ticket." });
    }

    // 7. Crear Solicitud REAL (Almacenamiento en Base de Datos)
    const nuevaSolicitud = await Solicitud.create({
      id_usuario,
      id_dependencia,
      id_subdependencia,
      id_categoria,
      id_vehiculo,
      placa, marca, modelo, flota,
      id_llenadero,
      id_tipo_combustible,
      cantidad_litros,
      cantidad_despachada: null,
      tipo_suministro,
      tipo_solicitud,
      id_precio,
      precio_unitario,
      monto_total,
      estado: 'PENDIENTE',
      fecha_solicitud: new Date()
    }, { transaction: t });

    // 8. Generar y Guardar Número de Ticket INMEDIATAMENTE
    const prefijo = tipo_suministro === 'BIDON' ? 'B' : 'R';
    const codDep = (depObj.codigo || '000').padStart(3, '0');
    const correlativo = nuevaSolicitud.id_solicitud.toString().padStart(6, '0');
    const codigo_ticket = `${prefijo}${codDep}${correlativo}`;

    await nuevaSolicitud.update({ codigo_ticket }, { transaction: t });

    // Asignar el código generado al objeto de respuesta
    nuevaSolicitud.codigo_ticket = codigo_ticket;

    await t.commit();

    if (req.io) req.io.emit('solicitud:creada', nuevaSolicitud);

    res.status(201).json({
      msg: "Solicitud enviada exitosamente. Ticket generado.",
      data: nuevaSolicitud,
      ticket: codigo_ticket
    });

  } catch (error) {
    if (!t.finished) await t.rollback();
    console.error(error);
    res.status(500).json({ msg: "Error al crear solicitud" });
  }
};

exports.aprobarSolicitud = async (req, res) => {
  const { id } = req.params;

  try {
    const solicitud = await Solicitud.findByPk(id);
    if (!solicitud) return res.status(404).json({ msg: "Solicitud no encontrada" });

    if (solicitud.estado !== 'PENDIENTE') {
      return res.status(400).json({ msg: "La solicitud no está en estado Pendiente" });
    }

    // RF-08: Validar Rol
    await solicitud.update({
      estado: 'APROBADA',
      fecha_aprobacion: new Date(),
      id_aprobador: req.usuario.id_usuario
    });

    if (req.io) req.io.emit('solicitud:actualizada', solicitud);

    res.json({ msg: "Solicitud Aprobada", data: solicitud });
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: "Error al aprobar solicitud" });
  }
};


/**
 * obtenerSubdependenciasAutorizadas
 */
exports.obtenerSubdependenciasAutorizadas = async (req, res) => {
  try {
    const { id_usuario, tipo_usuario } = req.usuario;

    // Caso 1: ADMIN ve todas las subdependencias activas
    if (tipo_usuario === 'ADMIN') {
      const allSub = await Subdependencia.findAll({
        where: { estatus: 'ACTIVO' },
        attributes: ['id_subdependencia', 'nombre', ['nombre', 'nombre_subdependencia'], 'id_dependencia', 'cobra_venta'],
        order: [['nombre', 'ASC']]
      });
      return res.json(allSub);
    }

    // Caso 2: Usuarios no admin
    const usuarioConSubs = await Usuario.findByPk(id_usuario, {
      attributes: ['id_dependencia'],
      include: [{
        model: Dependencia,
        as: 'Dependencia',
        required: true,
        include: [{
          model: Subdependencia,
          as: 'Subdependencia',
          attributes: ['id_subdependencia', 'nombre', ['nombre', 'nombre_subdependencia'], 'id_dependencia', 'cobra_venta'],
          where: { estatus: 'ACTIVO' },
          required: false
        }]
      }]
    });

    let subdependencias = [];
    if (usuarioConSubs?.Dependencia?.Subdependencia) {
      subdependencias = Array.isArray(usuarioConSubs.Dependencia.Subdependencia)
        ? usuarioConSubs.Dependencia.Subdependencia
        : [usuarioConSubs.Dependencia.Subdependencia];
    }

    res.json(subdependencias);

  } catch (error) {
    console.error("Error en obtenerSubdependenciasAutorizadas:", error);
    res.status(500).json({ msg: "Error al obtener subdependencias autorizadas" });
  }
};

exports.listarSolicitudes = async (req, res) => {
  try {
    let { tipo_usuario, id_usuario, id_dependencia, id_categoria, id_subdependencia } = req.usuario;

    if ((!id_categoria && !id_dependencia && !id_subdependencia) && tipo_usuario !== 'ADMIN') {
      const usuarioFull = await Usuario.findByPk(id_usuario);
      if (usuarioFull) {
        id_categoria = usuarioFull.id_categoria;
        id_dependencia = usuarioFull.id_dependencia;
        id_subdependencia = usuarioFull.id_subdependencia;
      }
    }

    const where = {};

    if (tipo_usuario === 'ALMACENISTA' || tipo_usuario === 'SOLICITANTE') {
      if (tipo_usuario !== 'ALMACENISTA') {
        where.id_usuario = id_usuario;
      }
    }

    if (tipo_usuario === 'GERENTE' || tipo_usuario === 'JEFE DIVISION') {
      if (id_dependencia) {
        where.id_dependencia = id_dependencia;
      }
    }

    if (req.query.estado) where.estado = req.query.estado;
    if (req.query.fecha_inicio && req.query.fecha_fin) {
      where.fecha_solicitud = { [Op.between]: [req.query.fecha_inicio, req.query.fecha_fin] };
    }

    const searchableFields = ["codigo_ticket", "placa", "flota"];

    const result = await paginate(Solicitud, req.query, {
      where,
      searchableFields,
      include: [
        { model: Usuario, as: 'Solicitante', attributes: ['nombre', 'apellido', 'cedula'] },
        { model: Dependencia, as: 'Dependencia', attributes: ['nombre_dependencia', 'codigo'] },
        { model: Subdependencia, as: 'Subdependencia', attributes: ['nombre'] },
        { model: TipoCombustible, attributes: ['nombre'] },
        { model: Llenadero, attributes: ['nombre_llenadero'] }
      ],
      order: [['fecha_solicitud', 'DESC']]
    });

    res.json(result);
  } catch (error) {
    console.error("Error en listarSolicitudes:", error);
    res.status(500).json({ msg: "Error listando solicitudes" });
  }
};

/**
 * Rechazar (Anular) Solicitud
 * Libera el cupo reintegrándolo al periodo original de la solicitud
 */
exports.rechazarSolicitud = async (req, res) => {
  const { id } = req.params;
  const { motivo } = req.body;

  const t = await sequelize.transaction();
  try {
    const solicitud = await Solicitud.findByPk(id, { transaction: t });

    if (!solicitud) {
      if (t) await t.rollback();
      return res.status(404).json({ msg: "Solicitud no encontrada" });
    }

    if (['DESPACHADA', 'VENCIDA', 'ANULADA'].includes(solicitud.estado)) {
      if (t) await t.rollback();
      return res.status(400).json({ msg: `No se puede rechazar una solicitud en estado ${solicitud.estado}` });
    }

    // 1. Reintegrar Cupo al periodo original
    const periodoOriginal = moment(solicitud.fecha_solicitud).format("YYYY-MM");
    const cupo = await CupoActual.findOne({
      where: {
        periodo: periodoOriginal,
        estado: { [Op.ne]: "CERRADO" }
      },
      include: [{
        model: CupoBase,
        as: "CupoBase",
        where: {
          id_subdependencia: solicitud.id_subdependencia,
          id_tipo_combustible: solicitud.id_tipo_combustible
        }
      }],
      transaction: t
    });

    if (cupo) {
      console.log(`Reintegrando ${solicitud.cantidad_litros} litros al cupo ID: ${cupo.id_cupo_actual} (${periodoOriginal}) por rechazo.`);
      await cupo.increment("cantidad_disponible", { by: solicitud.cantidad_litros, transaction: t });
      await cupo.decrement("cantidad_consumida", { by: solicitud.cantidad_litros, transaction: t });
    }

    // 2. Actualizar estado y motivo
    await solicitud.update({
      estado: 'ANULADA',
      observaciones: motivo ? `RECHAZO: ${motivo}` : 'RECHAZO SIN MOTIVO'
    }, { transaction: t });

    await t.commit();
    res.json({ msg: "Solicitud rechazada y cupo reintegrado exitosamente" });

  } catch (error) {
    if (t) await t.rollback();
    console.error("Error en rechazarSolicitud:", error);
    res.status(500).json({ msg: "Error al procesar el rechazo" });
  }
};


exports.obtenerLlenaderosPorCombustible = async (req, res) => {
  try {
    const { id_tipo_combustible } = req.query;

    if (!id_tipo_combustible) {
      return res.status(400).json({ msg: "ID de tipo de combustible requerido" });
    }

    const llenaderos = await Llenadero.findAll({
      where: {
        id_combustible: id_tipo_combustible,
        estado: "ACTIVO"
      },
      include: [{
        model: TipoCombustible,
        attributes: ["nombre"]
      }],
      order: [["nombre_llenadero", "ASC"]]
    });

    res.json(llenaderos);
  } catch (error) {
    console.error("Error en obtenerLlenaderosPorCombustible:", error);
    res.status(500).json({ msg: "Error al obtener llenaderos" });
  }
};
