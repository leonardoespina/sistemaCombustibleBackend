const { Solicitud, CupoActual, Subdependencia, Llenadero, TipoCombustible, Vehiculo, Usuario, Biometria, PrecioCombustible, Dependencia, Categoria, CupoBase } = require("../models");
const { sequelize } = require("../config/database");
const { paginate } = require("../helpers/paginationHelper");
const { Op } = require("sequelize");
const axios = require("axios");
const moment = require("moment");

// URL del microservicio de verificación biométrica (Misma que en biometriaController)
const BIOMETRIC_SERVICE_URL = "http://localhost:7000/api/verify";

/**
 * Helper para validar huella contra una cédula/usuario
 */
async function verificarHuella(cedula, muestra) {
  if (!cedula || !muestra) return false;

  try {
    const registro = await Biometria.findOne({ where: { cedula, estado: "ACTIVO" } });
    if (!registro) return false;

    const biometricData = JSON.parse(registro.template);
    
    // Comparar contra todos los templates guardados
    for (const templateGuardado of biometricData.templates) {
      try {
        const response = await axios.post(BIOMETRIC_SERVICE_URL, {
          probe: muestra,
          candidate: templateGuardado
        }, { timeout: 5000 });
        
        if (response.data.match && response.data.score >= 40) {
          return { match: true, id_biometria: registro.id_biometria, registro };
        }
      } catch (err) {
        console.error("Error comparando template:", err.message);
      }
    }
  } catch (error) {
    console.error("Error en servicio biométrico:", error.message);
  }
  return false;
}

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

    // 3. Validar Bloqueo de Placa (RF-05)
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

    // 6. Crear Solicitud REAL (Almacenamiento en Base de Datos)
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

    await t.commit();
    
    if (req.io) req.io.emit('solicitud:creada', nuevaSolicitud);

    res.status(201).json({ 
      msg: "Solicitud enviada exitosamente para aprobación", 
      data: nuevaSolicitud 
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

exports.imprimirTicket = async (req, res) => {
  const { id } = req.params;
  const { huella_almacenista, huella_receptor } = req.body; 

  if (!huella_almacenista || !huella_receptor) {
    return res.status(400).json({ msg: "Se requieren las huellas del Almacenista y del Receptor." });
  }

  const t = await sequelize.transaction();
  try {
    const solicitud = await Solicitud.findByPk(id, {
      include: [{ model: Dependencia }, { model: Usuario, as: 'Solicitante' }],
      transaction: t
    });

    if (!solicitud) {
      await t.rollback();
      return res.status(404).json({ msg: "Solicitud no encontrada" });
    }

    if (solicitud.estado !== 'APROBADA') {
      await t.rollback();
      return res.status(400).json({ msg: "La solicitud debe estar Aprobada para imprimirse." });
    }

    // RF-09: Validar Huellas
    const almacenista = await Usuario.findByPk(req.usuario.id_usuario, { transaction: t });
    const matchAlmacenista = await verificarHuella(almacenista.cedula, huella_almacenista);
    if (!matchAlmacenista) {
      await t.rollback();
      return res.status(401).json({ msg: "Huella del Almacenista no válida." });
    }

    const { cedula_receptor } = req.body;
    if (!cedula_receptor) {
      await t.rollback();
      return res.status(400).json({ msg: "Se requiere la cédula del receptor." });
    }

    const matchReceptor = await verificarHuella(cedula_receptor, huella_receptor);
    if (!matchReceptor) {
      await t.rollback();
      return res.status(401).json({ msg: "Huella del Receptor no coincide con la cédula proporcionada." });
    }

    // RF-10: Generar Nomenclatura
    const prefijo = solicitud.tipo_suministro === 'BIDON' ? 'B' : 'R';
    const codDep = (solicitud.Dependencia.codigo || '000').padStart(3, '0');
    const correlativo = id.toString().padStart(6, '0');
    const codigo_ticket = `${prefijo}${codDep}${correlativo}`;

    await solicitud.update({
      estado: 'IMPRESA',
      codigo_ticket,
      fecha_impresion: new Date(),
      numero_impresiones: 1,
      id_almacenista: req.usuario.id_usuario,
      id_receptor: matchReceptor.id_biometria 
    }, { transaction: t });

    await t.commit();
    res.json({ 
      msg: "Ticket generado correctamente", 
      ticket: {
        codigo: codigo_ticket,
        solicitud,
        receptor: matchReceptor.registro
      }
    });

  } catch (error) {
    await t.rollback();
    console.error(error);
    res.status(500).json({ msg: "Error generando ticket" });
  }
};

exports.reimprimirTicket = async (req, res) => {
  const { id } = req.params;
  try {
    const solicitud = await Solicitud.findByPk(id);
    if (!solicitud || (solicitud.estado !== 'IMPRESA' && solicitud.estado !== 'DESPACHADA')) {
      return res.status(400).json({ msg: "Solo se pueden reimprimir tickets Impresos o Despachados." });
    }

    await solicitud.increment('numero_impresiones');
    
    res.json({
      msg: "Copia generada",
      es_copia: true,
      ticket: {
        codigo: solicitud.codigo_ticket,
        solicitud
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: "Error al reimprimir" });
  }
};

exports.despacharSolicitud = async (req, res) => {
  const { codigo_ticket, cantidad_despachada_real } = req.body;
  
  if (!codigo_ticket) return res.status(400).json({ msg: "Código de ticket requerido" });

  const t = await sequelize.transaction();
  try {
    const solicitud = await Solicitud.findOne({
      where: { codigo_ticket },
      include: [{ model: Llenadero }],
      transaction: t
    });

    if (!solicitud) {
      await t.rollback();
      return res.status(404).json({ msg: "Ticket no encontrado" });
    }

    if (solicitud.estado !== 'IMPRESA') {
      await t.rollback();
      return res.status(400).json({ msg: `El ticket está en estado ${solicitud.estado} y no puede ser despachado.` });
    }

    // RF-13: Descuento de Inventario Físico (Llenadero)
    const llenadero = await Llenadero.findByPk(solicitud.id_llenadero, { transaction: t, lock: true });
    
    const cantidadFinal = cantidad_despachada_real ? parseFloat(cantidad_despachada_real) : parseFloat(solicitud.cantidad_litros);

    if (cantidadFinal > parseFloat(solicitud.cantidad_litros)) {
       await t.rollback();
       return res.status(400).json({ msg: "No se puede despachar más de lo aprobado." });
    }

    if (parseFloat(llenadero.disponibilidadActual) < cantidadFinal) {
        await t.rollback();
        return res.status(400).json({ msg: "Stock insuficiente en el Llenadero." });
    }

    await llenadero.decrement('disponibilidadActual', { by: cantidadFinal, transaction: t });

    // Actualizar Solicitud
    await solicitud.update({
      estado: 'DESPACHADA',
      fecha_despacho: new Date(),
      cantidad_despachada: cantidadFinal
    }, { transaction: t });

    await t.commit();
    
    if (req.io) req.io.emit('solicitud:despachada', solicitud);
    
    res.json({ msg: "Despacho registrado exitosamente. Inventario actualizado." });

  } catch (error) {
    await t.rollback();
    console.error(error);
    res.status(500).json({ msg: "Error al registrar despacho" });
  }
};

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
        { model: Dependencia, attributes: ['nombre_dependencia', 'codigo'] },
        { model: Subdependencia, attributes: ['nombre'] },
        { model: TipoCombustible, attributes: ['nombre'] },
        { model: Llenadero, attributes: ['nombre_llenadero'] }
      ],
      order: [['fecha_solicitud', 'DESC']]
    });

    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: "Error listando solicitudes" });
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
