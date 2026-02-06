const { Solicitud, CupoActual, Subdependencia, Llenadero, TipoCombustible, Vehiculo, Usuario, Biometria, PrecioCombustible, Moneda, Dependencia, Categoria, CupoBase } = require("../models");
const { sequelize } = require("../config/database");
const { paginate } = require("../helpers/paginationHelper");
const { Op } = require("sequelize");
const axios = require("axios");
const moment = require("moment");

// URL del microservicio de verificación biométrica
// 🏠 PARA PRUEBAS LOCALES
// const BIOMETRIC_SERVICE_URL = "http://localhost:7000";

// 🌐 PARA PRODUCCIÓN/RENDER
const BIOMETRIC_SERVICE_URL = "https://captura-huellas-microservicio.onrender.com";

/**
 * Helper para validar huella contra una cédula/usuario
 * Lógica adaptada de biometriaController.js
 */
async function verificarHuella(cedula, muestra) {
    if (!cedula || !muestra) return false;

    try {
        const registro = await Biometria.findOne({ where: { cedula, estado: "ACTIVO" } });
        if (!registro) {
            console.log("❌ Cédula no encontrada en Biometria");
            return false;
        }

        const biometricData = JSON.parse(registro.template);
        
        // Ejecutar comparaciones en paralelo para mejor rendimiento
        const matchPromises = biometricData.templates.map(async (templateGuardado, index) => {
            try {
                const response = await axios.post(
                    `${BIOMETRIC_SERVICE_URL}/api/verify`,
                    {
                        probe: muestra,
                        candidate: templateGuardado
                    }, 
                    {
                        timeout: BIOMETRIC_SERVICE_URL.includes("localhost") ? 10000 : 30000,
                        headers: { 'Content-Type': 'application/json' }
                    }
                );

                const { match, score } = response.data;
                // console.log(`Template ${index + 1}: Match=${match}, Score=${score}`);
                return score;
            } catch (error) {
                console.error(`Error verificando template ${index + 1}:`, error.message);
                return 0;
            }
        });

        const scores = await Promise.all(matchPromises);
        const mejorScore = Math.max(...scores);
        const umbral = 40;

        console.log(`🔍 Verificación Cédula ${cedula}: Mejor Score: ${mejorScore}`);

        if (mejorScore >= umbral) {
            return { match: true, id_biometria: registro.id_biometria, registro, score: mejorScore };
        }

    } catch (error) {
        console.error("Error general en servicio biométrico:", error.message);
    }
    return false;
}

/**
 * Lista todas las solicitudes aprobadas listas para despacho
 */
exports.listarSolicitudesParaDespacho = async (req, res) => {
    try {
        const { page, limit, search, fecha_inicio, fecha_fin, sort, estado } = req.query;

        const where = {};

        // RF: Por defecto solo APROBADA (listas para imprimir)
        // Pero el almacenista quiere ver también las IMPRESAS (listas para despachar)
        if (estado === 'TODAS') {
            where.estado = { [Op.in]: ['APROBADA', 'IMPRESA'] };
        } else if (estado) {
            where.estado = estado;
        } else {
            where.estado = 'APROBADA';
        }

        if (fecha_inicio && fecha_fin) {
            const startOfDay = moment(fecha_inicio).startOf('day').toDate();
            const endOfDay = moment(fecha_fin).endOf('day').toDate();
            where.fecha_solicitud = { [Op.between]: [startOfDay, endOfDay] };
        } else if (fecha_inicio) {
            const startOfDay = moment(fecha_inicio).startOf('day').toDate();
            const endOfDay = moment(fecha_inicio).endOf('day').toDate();
            where.fecha_solicitud = { [Op.between]: [startOfDay, endOfDay] };
        }

        let order = [['fecha_solicitud', 'DESC']];
        if (sort) {
            const [field, direction] = sort.split(':');
            const validFields = ['fecha_solicitud', 'codigo_ticket', 'placa'];
            if (validFields.includes(field)) {
                order = [[field, direction === 'DESC' ? 'DESC' : 'ASC']];
            }
        }

        const searchableFields = ["codigo_ticket", "placa"];

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
            order
        });

        res.json(result);
    } catch (error) {
        console.error("Error en listarSolicitudesParaDespacho:", error);
        res.status(500).json({ msg: "Error listando solicitudes para despacho" });
    }
};

/**
 * Validar Firma Biométrica y Roles basados en el Modelo Biometria
 */
exports.validarFirma = async (req, res) => {
    const { cedula, huella, id_solicitud } = req.body;

    if (!cedula || !huella || !id_solicitud) {
        return res.status(400).json({ msg: "Faltan datos requeridos (cédula, huella, id_solicitud)." });
    }

    try {
        // 1. Obtener la Solicitud para validar pertenencia (opcional, pero recomendado por seguridad)
        const solicitud = await Solicitud.findByPk(id_solicitud);
        if (!solicitud) {
            return res.status(404).json({ msg: "Solicitud no encontrada." });
        }

        // 2. Validar Biometría (Matching con microservicio)
        // El helper verificarHuella ya busca en el modelo Biometria
        const match = await verificarHuella(cedula, huella);

        if (!match) {
            return res.status(401).json({ msg: "La huella no coincide con la cédula proporcionada o no está registrado." });
        }

        const { registro } = match; // Este es el objeto Biometria encontrado

        // 3. Determinar Roles basados en el campo 'rol' del modelo BIOMETRIA (RETIRO, ALMACEN, AMBOS)
        const rolesDetectados = [];

        // Si el rol es RETIRO o AMBOS, puede actuar como RECEPTOR/SOLICITANTE
        if (registro.rol === 'RETIRO' || registro.rol === 'AMBOS') {
            rolesDetectados.push("SOLICITANTE");
        }

        // Si el rol es ALMACEN o AMBOS, puede actuar como ALMACENISTA
        if (registro.rol === 'ALMACEN' || registro.rol === 'AMBOS') {
            rolesDetectados.push("ALMACENISTA");
        }

        if (rolesDetectados.length === 0) {
            return res.status(403).json({ msg: "El registro biométrico no tiene roles asignados para esta operación." });
        }

        // 4. Validar Pertenencia (Opcional - Ahora solo informativo)
        if (registro.rol === 'RETIRO' && registro.id_subdependencia !== solicitud.id_subdependencia) {
            console.warn("Aviso: El receptor no pertenece a la misma subdependencia, pero tiene rol de retiro válido.");
        }

        // 5. Retornar Resultado formateado para el Frontend (SmartBiometricDialog)
        res.json({
            valid: true,
            usuario: {
                id_usuario: registro.id_biometria, // Usamos el ID de biometría como identificador en este flujo
                nombre: registro.nombre,
                cedula: registro.cedula,
                rol_biometrico: registro.rol
            },
            roles: rolesDetectados,
            id_biometria: registro.id_biometria
        });

    } catch (error) {
        console.error("Error en validarFirma:", error);
        res.status(500).json({
            msg: "Error interno al validar firma biométrica.",
            details: error.message
        });
    }
};

/**
 * Imprimir Ticket (Genera Código y marca como IMPRESA)
 */
exports.imprimirTicket = async (req, res) => {
    const { id } = req.params;
    const { huella_almacenista, huella_receptor, cedula_receptor, cedula_almacenista } = req.body;

    if (!huella_almacenista || !huella_receptor || !cedula_receptor) {
        return res.status(400).json({ msg: "Faltan datos (huellas y cédula del receptor)." });
    }

    const t = await sequelize.transaction();
    try {
        console.log("DEBUG: Iniciando proceso de impresión para ID:", id);
        const solicitud = await Solicitud.findByPk(id, {
            include: [
                { model: Dependencia, as: 'Dependencia' },
                { model: Subdependencia, as: 'Subdependencia' },
                { model: Usuario, as: 'Solicitante', attributes: ['nombre', 'apellido'] },
                { model: Usuario, as: 'Aprobador', attributes: ['nombre', 'apellido'] },
                { model: TipoCombustible, attributes: ['nombre'] },
                { model: Llenadero, attributes: ['nombre_llenadero'] },
                {
                    model: PrecioCombustible,
                    include: [{ model: Moneda, as: 'Moneda' }]
                }
            ],
            transaction: t
        });
        console.log("DEBUG: Solicitud recuperada:", solicitud ? 'SÍ' : 'NO');

        if (!solicitud) {
            await t.rollback();
            return res.status(404).json({ msg: "Solicitud no encontrada" });
        }

        if (solicitud.estado !== 'APROBADA') {
            await t.rollback();
            return res.status(400).json({ msg: "La solicitud debe estar Aprobada para imprimirse." });
        }

        // RF-13: Validar que la huella coincida con el usuario logueado (Sesión)
        const almacenistaSesion = await Usuario.findByPk(req.usuario.id_usuario, { transaction: t });

        if (!almacenistaSesion) {
            await t.rollback();
            return res.status(401).json({ msg: "Sesión de Almacenista no válida." });
        }

        // Usamos estrictamente la cédula del usuario en sesión
        const matchAlmacenista = await verificarHuella(almacenistaSesion.cedula, huella_almacenista);

        if (!matchAlmacenista) {
            await t.rollback();
            return res.status(403).json({ msg: "Almacenista No coincide con la Sesion" });
        }

        // Verificar si el registro biométrico del Almacenista tiene permiso de ALMACÉN
        if (matchAlmacenista.registro.rol !== 'ALMACEN' && matchAlmacenista.registro.rol !== 'AMBOS') {
            await t.rollback();
            return res.status(403).json({ msg: "La huella capturada no tiene rol de Almacenista autorizado." });
        }

        const matchReceptor = await verificarHuella(cedula_receptor, huella_receptor);
        if (!matchReceptor) {
            await t.rollback();
            return res.status(401).json({ msg: "Huella del Receptor no coincide con la cédula proporcionada." });
        }

        // Verificar si el registro biométrico del Receptor tiene permiso de RETIRO
        if (matchReceptor.registro.rol !== 'RETIRO' && matchReceptor.registro.rol !== 'AMBOS') {
            await t.rollback();
            return res.status(403).json({ msg: "El receptor no tiene rol de Retiro (Solicitante) autorizado." });
        }

        console.log("Generating ticket code...");
        const prefijo = solicitud.tipo_suministro === 'BIDON' ? 'B' : 'R';
        const codDep = (solicitud.Dependencia?.codigo || '000').padStart(3, '0');
        const correlativo = id.toString().padStart(6, '0');
        const codigo_ticket = `${prefijo}${codDep}${correlativo}`;
        console.log("Ticket code generated:", codigo_ticket);

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
                receptor: matchReceptor.registro,
                almacenista: {
                    nombre: `${almacenistaSesion.nombre} ${almacenistaSesion.apellido}`
                }
            }
        });

    } catch (error) {
        if (t) await t.rollback();
        console.error("CRITICAL ERROR in imprimirTicket:", error);
        res.status(500).json({
            msg: "Error generando ticket",
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
            details: error.name === 'SequelizeValidationError' ? error.errors.map(e => e.message) : error.message
        });
    }
};

/**
 * Reimprimir Ticket
 */
exports.reimprimirTicket = async (req, res) => {
    const { id } = req.params;
    try {
        const solicitudFull = await Solicitud.findByPk(id, {
            include: [
                { model: Dependencia, as: 'Dependencia' },
                { model: Subdependencia, as: 'Subdependencia' },
                { model: Usuario, as: 'Solicitante', attributes: ['nombre', 'apellido'] },
                { model: Usuario, as: 'Aprobador', attributes: ['nombre', 'apellido'] },
                { model: Usuario, as: 'Almacenista', attributes: ['nombre', 'apellido'] },
                { model: Biometria, as: 'Receptor' },
                { model: TipoCombustible, attributes: ['nombre'] },
                { model: Llenadero, attributes: ['nombre_llenadero'] },
                {
                    model: PrecioCombustible,
                    include: [{ model: Moneda, as: 'Moneda' }]
                }
            ]
        });

        if (!solicitudFull || !['IMPRESA', 'DESPACHADA', 'FINALIZADA'].includes(solicitudFull.estado)) {
            return res.status(400).json({ msg: "Solo se pueden reimprimir tickets Impresos, Despachados o Finalizados." });
        }

        await solicitudFull.increment('numero_impresiones');

        res.json({
            msg: "Copia generada",
            es_copia: true,
            ticket: {
                codigo: solicitudFull.codigo_ticket,
                solicitud: solicitudFull,
                receptor: solicitudFull.Receptor,
                almacenista: {
                    nombre: solicitudFull.Almacenista ? `${solicitudFull.Almacenista.nombre} ${solicitudFull.Almacenista.apellido}` : 'S/I'
                }
            }
        });
    } catch (error) {
        console.error("CRITICAL ERROR in reimprimirTicket:", error);
        res.status(500).json({
            msg: "Error al reimprimir",
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

/**
 * Despachar Solicitud (Escaneo QR y descuento de inventario)
 */
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
