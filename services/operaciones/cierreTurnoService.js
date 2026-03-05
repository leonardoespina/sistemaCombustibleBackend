const {
    CierreTurno,
    CierreTurnoMedicion,
    MovimientoInventario,
    MedicionTanque,
    Solicitud,
    Tanque,
    TipoCombustible,
    Llenadero,
    Usuario,
    Dependencia,
    Subdependencia,
} = require("../../models");
const { executeTransaction } = require("../../helpers/transactionHelper");
const { paginate } = require("../../helpers/paginationHelper");
const { Op } = require("sequelize");

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Devuelve el último nivel registrado en un cierre para un tanque.
 * Si no existe cierre previo, devuelve el nivel_actual del tanque.
 */
exports.obtenerUltimoNivel = async (id_tanque) => {
    const tanque = await Tanque.findByPk(id_tanque, {
        include: [{ model: TipoCombustible, as: "TipoCombustible" }],
    });
    if (!tanque) throw new Error("Tanque no encontrado.");

    const ultimaMedicion = await MedicionTanque.findOne({
        where: { id_tanque, tipo_medicion: "CIERRE" },
        order: [
            ["fecha_medicion", "DESC"],
            ["hora_medicion", "DESC"],
        ],
    });

    return {
        id_tanque: tanque.id_tanque,
        codigo: tanque.codigo,
        nombre: tanque.nombre,
        tipo_tanque: tanque.tipo_tanque,
        unidad_medida: tanque.unidad_medida,
        largo: tanque.largo,
        ancho: tanque.ancho,
        alto: tanque.alto,
        radio: tanque.radio,
        con_aforo: tanque.con_aforo,
        aforo: tanque.aforo ?? null,
        tabla_aforo: tanque.aforo ?? null,  // alias para compatibilidad
        nivel_actual: parseFloat(tanque.nivel_actual),
        combustible: tanque.TipoCombustible?.nombre,
        id_tipo_combustible: tanque.id_tipo_combustible,
        ultimo_cierre: ultimaMedicion
            ? {
                volumen_real: parseFloat(ultimaMedicion.volumen_real),
                fecha: ultimaMedicion.fecha_medicion,
                hora: ultimaMedicion.hora_medicion,
            }
            : null,
    };
};


/**
 * Devuelve los tanques activos para despacho de un llenadero
 * con su último nivel de cierre incluido.
 */
exports.obtenerTanquesLlenaderoConNivel = async (id_llenadero) => {
    const tanques = await Tanque.findAll({
        where: { id_llenadero, activo_para_despacho: true, estado: "ACTIVO" },
        include: [{ model: TipoCombustible, as: "TipoCombustible" }],
        order: [["codigo", "ASC"]],
    });

    return await Promise.all(
        tanques.map((t) => exports.obtenerUltimoNivel(t.id_tanque))
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// GENERAR CIERRE (operación única)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Genera el cierre de turno en un solo paso:
 *  1. Crea CierreTurno en estado CERRADO
 *  2. Por cada tanque: crea MedicionTanque tipo=CIERRE, recalibra nivel_actual,
 *     registra MovimientoInventario tipo=AJUSTE_MEDICION
 *  3. Asigna todas las Solicitudes FINALIZADA pendientes del llenadero
 *  4. Asigna todos los MovimientoInventario pendientes del llenadero
 *
 * @param {Object} data
 * @param {Object} user - req.usuario
 * @param {string} clientIp
 */
exports.generarCierre = async (data, user, clientIp) => {
    const { id_usuario } = user;
    const {
        id_llenadero,
        turno,
        fecha_lote,
        hora_inicio_lote,
        hora_cierre_lote,
        id_usuario_pcp,
        observaciones,
        mediciones, // [{ id_tanque, id_tipo_combustible, medida_vara, volumen_real }]
    } = data;

    if (!mediciones || mediciones.length === 0) {
        throw new Error("Debe incluir al menos una medición de tanque.");
    }

    return await executeTransaction(clientIp, async (t) => {
        // 1. Buscar una solicitud finalizada pendiente de cierre para obtener su PCP (id_validador)
        const solicitudConValidador = await Solicitud.findOne({
            where: {
                id_cierre_turno: null,
                id_llenadero,
                estado: "FINALIZADA",
                id_validador: { [Op.not]: null } // Que tenga un validador registrado
            },
            order: [["fecha_despacho", "DESC"]], // Tomamos el más reciente
            transaction: t,
        });

        // Este será el usuario PCP asignado automáticamente al cierre
        const pcpAutomatico = solicitudConValidador ? solicitudConValidador.id_validador : null;

        // 2. Crear CierreTurno directamente en CERRADO
        const cierre = await CierreTurno.create(
            {
                id_llenadero,
                id_usuario_almacen: id_usuario,
                id_usuario_pcp: pcpAutomatico, // <--- Automático, no viaja del frontend
                turno,
                fecha_lote,
                hora_inicio_lote,
                hora_cierre_lote,
                observaciones: observaciones || null,
                estado: "CERRADO",
            },
            { transaction: t }
        );

        // 2. Medición CIERRE por tanque + recalibrar nivel
        for (const med of mediciones) {
            const tanque = await Tanque.findByPk(med.id_tanque, {
                transaction: t,
                lock: true,
            });
            if (!tanque) continue;

            const volumen_antes = parseFloat(tanque.nivel_actual);
            const v_real = parseFloat(med.volumen_real);

            // Crear medición de cierre
            const medicionCierre = await MedicionTanque.create(
                {
                    id_tanque: med.id_tanque,
                    id_usuario,
                    fecha_medicion: fecha_lote,
                    hora_medicion: hora_cierre_lote,
                    medida_vara: med.medida_vara ?? null,
                    volumen_real: v_real,
                    volumen_teorico: volumen_antes,
                    diferencia: parseFloat((volumen_antes - v_real).toFixed(2)),
                    merma_evaporacion: 0,
                    tipo_medicion: "CIERRE",
                    id_cierre_turno: cierre.id_cierre,
                    estado: "PROCESADO",
                },
                { transaction: t }
            );

            // Recalibrar nivel_actual del tanque
            await tanque.update({ nivel_actual: v_real }, { transaction: t });

            // Movimiento de ajuste por recalibración
            await MovimientoInventario.create(
                {
                    id_tanque: med.id_tanque,
                    id_cierre_turno: cierre.id_cierre,
                    tipo_movimiento: "AJUSTE_MEDICION",
                    id_referencia: medicionCierre.id_medicion,
                    tabla_referencia: "mediciones_tanque",
                    volumen_antes,
                    volumen_despues: v_real,
                    variacion: parseFloat((v_real - volumen_antes).toFixed(2)),
                    fecha_movimiento: new Date(),
                    id_usuario,
                    observaciones: `Cierre de turno #${cierre.id_cierre}`,
                },
                { transaction: t }
            );

            // Detalle en CierreTurnoMedicion
            await CierreTurnoMedicion.create(
                {
                    id_cierre: cierre.id_cierre,
                    id_tanque: med.id_tanque,
                    id_tipo_combustible:
                        med.id_tipo_combustible || tanque.id_tipo_combustible,
                    id_medicion_inicial: null,
                    id_medicion_cierre: medicionCierre.id_medicion,
                },
                { transaction: t }
            );
        }

        // 3. Obtener IDs de todos los tanques del llenadero
        const tanquesLlenadero = await Tanque.findAll({
            where: { id_llenadero },
            attributes: ["id_tanque"],
            transaction: t,
        });
        const idsTanques = tanquesLlenadero.map((tn) => tn.id_tanque);

        // 4. Asignar MovimientoInventario pendientes del llenadero a este cierre
        await MovimientoInventario.update(
            { id_cierre_turno: cierre.id_cierre },
            {
                where: {
                    id_cierre_turno: null,
                    id_tanque: { [Op.in]: idsTanques },
                },
                transaction: t,
            }
        );

        // 5. Asignar Solicitudes FINALIZADA pendientes del llenadero a este cierre
        await Solicitud.update(
            { id_cierre_turno: cierre.id_cierre },
            {
                where: {
                    id_cierre_turno: null,
                    id_llenadero,
                    estado: "FINALIZADA",
                },
                transaction: t,
            }
        );

        return cierre;
    });
};

// ─────────────────────────────────────────────────────────────────────────────
// CONSULTAS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Obtener un cierre por ID con detalle de mediciones.
 */
exports.obtenerCierre = async (id_cierre) => {
    return await CierreTurno.findByPk(id_cierre, {
        include: [
            { model: Llenadero, as: "Llenadero", attributes: ["nombre_llenadero"] },
            { model: Usuario, as: "Almacenista", attributes: ["nombre", "apellido"] },
            { model: Usuario, as: "ValidadorPCP", attributes: ["nombre", "apellido"] },
            {
                model: CierreTurnoMedicion,
                as: "Mediciones",
                include: [
                    { model: Tanque, as: "Tanque", attributes: ["codigo", "nombre", "unidad_medida"] },
                    {
                        model: MedicionTanque,
                        as: "MedicionCierre",
                        attributes: ["volumen_real", "medida_vara", "hora_medicion"],
                    },
                ],
            },
        ],
    });
};

/**
 * Listado paginado de cierres de turno.
 */
exports.listarCierres = async (query) => {
    const { id_llenadero, estado, fecha_inicio, fecha_fin } = query;
    const where = {};

    if (id_llenadero) where.id_llenadero = id_llenadero;
    if (estado) where.estado = estado;
    if (fecha_inicio && fecha_fin) {
        where.fecha_lote = { [Op.between]: [fecha_inicio, fecha_fin] };
    }

    return await paginate(CierreTurno, query, {
        where,
        searchableFields: ["observaciones"],
        include: [
            { model: Llenadero, as: "Llenadero", attributes: ["nombre_llenadero"] },
            { model: Usuario, as: "Almacenista", attributes: ["nombre", "apellido"] },
            {
                model: Solicitud,
                as: "Solicitudes",
                attributes: ["id_solicitud", "cantidad_despachada"],
                where: { estado: "FINALIZADA" },
                required: false,
            },
        ],
        order: [
            ["fecha_lote", "DESC"],
            ["hora_inicio_lote", "DESC"],
        ],
    });
};


// ─────────────────────────────────────────────────────────────────────────────
// REPORTE FINAL POR TURNO
// ─────────────────────────────────────────────────────────────────────────────

exports.generarReporteTurno = async (id_cierre) => {
    const cierre = await CierreTurno.findByPk(id_cierre, {
        include: [
            { model: Llenadero, as: "Llenadero" },
            { model: Usuario, as: "Almacenista", attributes: ["nombre", "apellido"] },
            {
                model: CierreTurnoMedicion,
                as: "Mediciones",
                include: [
                    { model: Tanque, as: "Tanque", attributes: ["id_tanque", "codigo", "nombre"] },
                    { model: MedicionTanque, as: "MedicionCierre", attributes: ["volumen_real"] },
                ],
            },
            {
                model: Solicitud,
                as: "Solicitudes",
                where: { estado: "FINALIZADA" },
                required: false,
                include: [
                    { model: Usuario, as: "Solicitante", attributes: ["nombre", "apellido"] },
                    { model: Usuario, as: "Almacenista", attributes: ["nombre", "apellido"] },
                    { model: Usuario, as: "Validador", attributes: ["nombre", "apellido"] },
                    { model: Dependencia, as: "Dependencia", attributes: ["nombre_dependencia"] },
                    { model: Subdependencia, as: "Subdependencia", attributes: ["nombre"] },
                ],
            },
        ],
    });

    if (!cierre) throw new Error("Cierre no encontrado.");

    // ── Obtener TODOS los tanques activos del llenadero ──────────────────────
    const todosLosTanques = await Tanque.findAll({
        where: { id_llenadero: cierre.id_llenadero, estado: "ACTIVO" },
        attributes: ["id_tanque", "codigo", "nombre", "nivel_actual"],
        order: [["codigo", "ASC"]],
    });

    // Mapa de tanques medidos en el cierre (id_tanque → volumen_real)
    const medicionFinalMap = {};
    for (const med of cierre.Mediciones) {
        if (med.MedicionCierre?.volumen_real != null) {
            medicionFinalMap[med.id_tanque] = parseFloat(med.MedicionCierre.volumen_real);
        }
    }

    // Inicializar stockMap:
    //  - Tanques con medición de cierre → volumen_real (stock final real)
    //  - Tanques sin medición → nivel_actual (se usará como referencia estable)
    const stockMap = {};
    for (const t of todosLosTanques) {
        stockMap[t.id_tanque] =
            medicionFinalMap[t.id_tanque] ?? parseFloat(t.nivel_actual || 0);
    }


    const solicitudesOrdenadas = (cierre.Solicitudes || []).sort(
        (a, b) => new Date(a.fecha_despacho) - new Date(b.fecha_despacho)
    );

    const filas = [];
    let item = 1;

    // Reconstruir el stock después de cada despacho usando MovimientoInventario
    // Cargamos todos los movimientos DESPACHO del cierre de una vez (optimización)
    const movimientosDespacho = await MovimientoInventario.findAll({
        where: {
            id_cierre_turno: id_cierre,
            tipo_movimiento: "DESPACHO",
        },
    });
    const movMap = {};
    for (const m of movimientosDespacho) {
        movMap[m.id_referencia] = m;
    }

    // Reconstruir stock en orden cronológico
    // Para eso primero cargamos el stock INICIAL (antes del primer despacho):
    // stock_inicial[tanque] = stock_final[tanque] + sum(variaciones DESPACHO del tanque)
    const stockFinal = { ...stockMap };
    for (const sol of solicitudesOrdenadas) {
        const mov = movMap[sol.id_solicitud];
        if (mov) {
            stockMap[mov.id_tanque] = parseFloat(mov.volumen_antes);
        }
    }
    // stockMap ahora tiene el stock antes del primer despacho (≈ stock inicial de turno)
    const stockInicial = { ...stockMap };

    // Re-simular hacia adelante para construir las filas
    const stockProgresivo = { ...stockInicial };
    for (const sol of solicitudesOrdenadas) {
        const mov = movMap[sol.id_solicitud];
        if (mov) {
            stockProgresivo[mov.id_tanque] = parseFloat(mov.volumen_despues);
        }

        const stockPorTanque = {};
        let stockTotal = 0;
        for (const tanque of todosLosTanques) {
            const nivel = stockProgresivo[tanque.id_tanque] ?? 0;
            stockPorTanque[tanque.codigo] = nivel;
            stockTotal += nivel;
        }

        filas.push({
            item: item++,
            fecha: sol.fecha_validacion ? new Date(sol.fecha_validacion).toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' }) : '—',
            nombre_apellido: `${sol.Solicitante?.nombre || ""} ${sol.Solicitante?.apellido || ""}`.trim(),
            vehiculo: `${sol.marca || ""} ${sol.modelo || ""}`.trim(),
            placa: sol.placa,
            dependencia: sol.Dependencia?.nombre_dependencia || "",
            subdependencia: sol.Subdependencia?.nombre || "",
            cant_solicitada: sol.cantidad_litros,
            cant_despachada: sol.cantidad_despachada,
            stock_tanques: stockPorTanque,
            stock_total: parseFloat(stockTotal.toFixed(2)),
            almacen: sol.Almacenista
                ? `${sol.Almacenista.nombre} ${sol.Almacenista.apellido}`
                : "",
            pcp: sol.Validador
                ? `${sol.Validador.nombre} ${sol.Validador.apellido}`
                : "",
        });
    }

    return {
        encabezado: {
            llenadero: cierre.Llenadero?.nombre_llenadero,
            turno: cierre.turno,
            fecha_lote: cierre.fecha_lote,
            hora_inicio: cierre.hora_inicio_lote,
            hora_cierre: cierre.hora_cierre_lote,
            almacenista: cierre.Almacenista
                ? `${cierre.Almacenista.nombre} ${cierre.Almacenista.apellido}`
                : "",
            tanques: todosLosTanques.map((t) => {
                const medDet = cierre.Mediciones.find((m) => m.id_tanque === t.id_tanque);
                return {
                    id_tanque: t.id_tanque,
                    codigo: t.codigo,
                    nombre: t.nombre,
                    stock_inicial: stockInicial[t.id_tanque] ?? null,
                    // Para tanques sin medición de cierre, usar nivel_actual como stock final de referencia
                    stock_final: medDet?.MedicionCierre?.volumen_real ?? parseFloat(t.nivel_actual || 0),
                };
            }),
        },
        filas,
    };
};
