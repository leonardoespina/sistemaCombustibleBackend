const { Solicitud, CupoActual, Subdependencia, Llenadero, TipoCombustible, Vehiculo, Usuario, Biometria, PrecioCombustible, Dependencia, Categoria } = require("../models");
const { sequelize } = require("../config/database");
const { paginate } = require("../helpers/paginationHelper");
const { Op } = require("sequelize");
const axios = require("axios");

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
  const t = await sequelize.transaction();
  try {
    // 1. Datos del Usuario (detectados del token)
    const { id_usuario, id_dependencia, id_subdependencia, id_categoria } = req.user; // Asumimos middleware de auth
    
    // 2. Datos del Body
    const { 
      id_vehiculo, placa, marca, modelo, flota,
      id_llenadero, id_tipo_combustible,
      cantidad_litros, tipo_suministro, tipo_solicitud,
      forma_pago, id_precio 
    } = req.body;

    // 3. Validar Bloqueo de Placa (RF-05)
    // No puede tener solicitud activa (PENDIENTE, APROBADA, IMPRESA)
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
    // Buscamos CupoActual de la Subdependencia
    const cupoActual = await CupoActual.findOne({
      where: { 
        id_subdependencia,
        id_tipo_combustible 
      },
      transaction: t,
      lock: true // Bloqueo para evitar condiciones de carrera
    });

    if (!cupoActual) {
      await t.rollback();
      return res.status(400).json({ msg: "No se encontró cupo asignado para esta subdependencia y combustible." });
    }

    if (parseFloat(cupoActual.cantidad_actual) < parseFloat(cantidad_litros)) {
      await t.rollback();
      return res.status(400).json({ 
        msg: `Cupo insuficiente. Disponible: ${cupoActual.cantidad_actual} Lts. Solicitado: ${cantidad_litros} Lts.` 
      });
    }

    // Descontar del Cupo (Reserva)
    await cupoActual.decrement('cantidad_actual', { by: cantidad_litros, transaction: t });
    await cupoActual.increment('cantidad_consumida', { by: cantidad_litros, transaction: t });

    // 5. Cálculos de Venta (RF-03)
    let precio_unitario = 0;
    let monto_total = 0;
    
    if (tipo_solicitud === 'VENTA') {
      if (id_precio) {
        const precioObj = await PrecioCombustible.findByPk(id_precio);
        if (precioObj) {
          precio_unitario = precioObj.precio;
          monto_total = parseFloat(cantidad_litros) * parseFloat(precio_unitario);
        }
      }
    }

    // 6. Crear Solicitud
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
      cantidad_despachada: null, // Aun no despachado
      tipo_suministro,
      tipo_solicitud,
      id_precio,
      precio_unitario,
      monto_total,
      // forma_pago eliminada según feedback
      estado: 'PENDIENTE',
      fecha_solicitud: new Date()
    }, { transaction: t });

    await t.commit();
    
    // Emitir evento Socket (opcional)
    if (req.io) req.io.emit('solicitud:creada', nuevaSolicitud);

    res.status(201).json({ msg: "Solicitud creada exitosamente", data: nuevaSolicitud });

  } catch (error) {
    await t.rollback();
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

    // RF-08: Validar Rol (Asumimos middleware verifica rol, pero aquí registramos quién aprobó)
    // req.user debe ser Gerente/Jefe
    
    await solicitud.update({
      estado: 'APROBADA',
      fecha_aprobacion: new Date(),
      id_aprobador: req.user.id_usuario
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
  const { huella_almacenista, huella_receptor } = req.body; // Base64 templates

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
    // 1. Almacenista (Usuario en sesión)
    const almacenista = await Usuario.findByPk(req.user.id_usuario, { transaction: t });
    const matchAlmacenista = await verificarHuella(almacenista.cedula, huella_almacenista);
    if (!matchAlmacenista) {
      await t.rollback();
      return res.status(401).json({ msg: "Huella del Almacenista no válida." });
    }

    // 2. Receptor (Cualquier persona registrada en Biometria)
    // Pero aquí necesitamos saber QUIEN es el receptor. ¿El frontend manda la cédula del receptor?
    // Asumiremos que el frontend manda la huella y buscamos el match en TODA la base de biometría?
    // Eso sería muy lento (1:N). 
    // Lo ideal es recibir { cedula_receptor, huella_receptor }.
    // Si el req.body no tiene cedula_receptor, esto es un problema.
    // Asumiremos que req.body trae `cedula_receptor` o que la validación 1:N es aceptable si la BD es pequeña.
    // O mejor, exigimos `cedula_receptor` en el body.
    
    // CORRECCIÓN: Usaremos req.body.cedula_receptor si viene, sino error.
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

    // Actualizar Solicitud
    await solicitud.update({
      estado: 'IMPRESA',
      codigo_ticket,
      fecha_impresion: new Date(),
      numero_impresiones: 1,
      id_almacenista: req.user.id_usuario,
      id_receptor: matchReceptor.id_biometria // ID de la tabla biometria
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

    // Validar fecha (RF-07 / RF-14 implícito: solo tickets del día? o tickets válidos?)
    // El requerimiento dice: "Si a las 11:59 PM... se anula". 
    // Por tanto, si el ticket existe y está IMPRESA, es que no ha corrido el cron job aun, asi que es válido.

    // RF-13: Descuento de Inventario Físico (Llenadero)
    // El modelo Llenadero tiene 'disponibilidadActual'.
    const llenadero = await Llenadero.findByPk(solicitud.id_llenadero, { transaction: t, lock: true });
    
    // Determinar cantidad a despachar
    const cantidadFinal = cantidad_despachada_real ? parseFloat(cantidad_despachada_real) : parseFloat(solicitud.cantidad_litros);

    // Validar que no despache más de lo aprobado (opcional, pero recomendada)
    if (cantidadFinal > parseFloat(solicitud.cantidad_litros)) {
       await t.rollback();
       return res.status(400).json({ msg: "No se puede despachar más de lo aprobado." });
    }

    // Validar stock llenadero
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

exports.listarSolicitudes = async (req, res) => {
  try {
    const { tipo_usuario, id_usuario, id_dependencia } = req.user; 
    const where = {};

    // Filtros por Rol
    // Ajustar según los roles reales del sistema (ADMIN, GERENTE, JEFE DIVISION, etc.)
    if (tipo_usuario === 'ALMACENISTA' || tipo_usuario === 'SOLICITANTE') {
      // Si es solicitante normal, ve solo las suyas
      // Si es almacenista, quizás necesite ver todas las aprobadas?
      // Por defecto, restringimos a usuario si no es gerencia/admin
      if (tipo_usuario !== 'ALMACENISTA') {
          where.id_usuario = id_usuario;
      }
    }
    
    if (tipo_usuario === 'GERENTE' || tipo_usuario === 'JEFE DIVISION') {
       where.id_dependencia = id_dependencia;
    }

    // Filtros adicionales desde frontend
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
        { model: TipoCombustible, attributes: ['nombre_combustible'] },
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
