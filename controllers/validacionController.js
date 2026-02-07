const { Solicitud, CupoActual, Llenadero, Subdependencia, Usuario, CupoBase, Dependencia, TipoCombustible } = require("../models");
const { sequelize } = require("../config/database");
const moment = require("moment");
const { Op } = require("sequelize");

/**
 * Consultar datos de un Ticket para validación
 */
exports.consultarTicket = async (req, res) => {
    const { codigo } = req.params;

    try {
        const solicitud = await Solicitud.findOne({
            where: { codigo_ticket: codigo },
            include: [
                { model: Dependencia, as: 'Dependencia', attributes: ['nombre_dependencia', 'codigo'] },
                { model: Subdependencia, as: 'Subdependencia', attributes: ['nombre'] },
                { model: TipoCombustible, attributes: ['nombre'] },
                { model: Llenadero, attributes: ['nombre_llenadero'] },
                { model: Usuario, as: 'Solicitante', attributes: ['nombre', 'apellido', 'cedula'] },
                { model: Usuario, as: 'Validador', attributes: ['nombre', 'apellido'] }
            ]
        });

        if (!solicitud) {
            return res.status(404).json({ msg: "Ticket no encontrado" });
        }

        // Validar estado
        if (solicitud.estado === 'FINALIZADA') {
            return res.json({
                msg: "Este ticket ya fue validado y finalizado anteriormente.",
                ticket: solicitud,
                status: 'ALREADY_FINALIZED'
            });
        }

        // Permitir validar si está IMPRESA (listo para despacho) o DESPACHADA
        if (!['DESPACHADA', 'IMPRESA'].includes(solicitud.estado)) {
            return res.status(400).json({
                msg: `El ticket no está en estado válido para validación (Estado actual: ${solicitud.estado}). Debe estar IMPRESA o DESPACHADA.`,
                status: 'INVALID_STATE'
            });
        }

        res.json({
            msg: "Ticket listo para validación",
            ticket: solicitud,
            status: 'READY'
        });

    } catch (error) {
        console.error("Error consultando ticket:", error);
        res.status(500).json({ msg: "Error al consultar ticket" });
    }
};

/**
 * Finalizar Ticket (Cierre administrativo)
 * - Valida contraseña/seguridad (Simulado o real)
 * - Procesa excedentes (Reintegro) si aplica
 * - Cambia estado a FINALIZADA
 */
exports.finalizarTicket = async (req, res) => {
    const { codigo_ticket, cantidad_real_cargada, observaciones, password_confirmacion } = req.body;
    const id_validador = req.usuario.id_usuario;

    if (!codigo_ticket) return res.status(400).json({ msg: "Código de ticket requerido" });

    // TODO: Validar password_confirmacion contra el usuario logueado si se requiere seguridad extra
    // Por ahora confiamos en el token de sesión y el rol del middleware

    const t = await sequelize.transaction();

    try {
        const solicitud = await Solicitud.findOne({
            where: { codigo_ticket },
            transaction: t
        });

        if (!solicitud) {
            await t.rollback();
            return res.status(404).json({ msg: "Ticket no encontrado" });
        }

        if (!['DESPACHADA', 'IMPRESA'].includes(solicitud.estado)) {
            await t.rollback();
            return res.status(400).json({ msg: `El ticket debe estar IMPRESA o DESPACHADA para finalizar (Estado: ${solicitud.estado})` });
        }

        const cantidadAprobada = parseFloat(solicitud.cantidad_litros);
        const cantidadReal = parseFloat(cantidad_real_cargada);

        // Validación de integridad
        if (cantidadReal > cantidadAprobada) {
            await t.rollback();
            return res.status(400).json({ msg: "La cantidad real no puede ser mayor a la aprobada." });
        }

        const excedente = cantidadAprobada - cantidadReal;
        let mensajeExcedente = "";

        // LOGICA DE INVENTARIO (LLENADERO)
        // El descuento del llenadero se hace AQUI al finalizar si viene de IMPRESA.
        const llenadero = await Llenadero.findByPk(solicitud.id_llenadero, { transaction: t });
        
        if (llenadero) {
            if (solicitud.estado === 'IMPRESA') {
                // Flujo Nuevo: IMPRESA -> FINALIZADA
                // Nunca se descontó nada del llenadero. Descontamos solo lo REAL (ej: 70).
                // El cupo sí se descontó completo al crear la solicitud.
                await llenadero.decrement('disponibilidadActual', { by: cantidadReal, transaction: t });
                console.log(`[VALIDACION] Ticket IMPRESA: Descontando ${cantidadReal} Lts del Llenadero.`);
            } else if (solicitud.estado === 'DESPACHADA') {
                // Flujo Antiguo: Ya se había descontado el TOTAL (80).
                // Si se cargó menos (70), devolvemos la diferencia (10) al llenadero.
                if (excedente > 0) {
                    await llenadero.increment('disponibilidadActual', { by: excedente, transaction: t });
                    console.log(`[VALIDACION] Ticket DESPACHADA: Reintegrando ${excedente} Lts al Llenadero.`);
                }
            }
        }

        // PROCESAR EXCEDENTE (Reintegro de CUPO)
        // El cupo SIEMPRE se descuenta completo al inicio (APROBADA).
        // Por tanto, siempre que haya excedente, hay que devolverlo al CUPO.
        if (excedente > 0) {
            console.log(`Ticket ${codigo_ticket}: Procesando reintegro de cupo por ${excedente} litros.`);

            // 2. Reintegrar al Cupo (Inventario Lógico/Financiero)
            // Necesitamos encontrar el CupoActual correspondiente a la fecha de la solicitud (o el mes actual?)
            // Regla: Se reintegra al mes donde se descontó originalmente si es posible, o al mes actual.
            // Asumiremos reintegro al mes de la solicitud para mantener consistencia contable.
            const fechaSolicitud = moment(solicitud.fecha_solicitud);
            const periodoSolicitud = fechaSolicitud.format("YYYY-MM");

            // Buscar cupo base para saber cual cupo actual tocar
            const cupoBase = await CupoBase.findOne({
                where: {
                    id_subdependencia: solicitud.id_subdependencia,
                    id_tipo_combustible: solicitud.id_tipo_combustible
                },
                transaction: t
            });

            if (cupoBase) {
                const cupoActual = await CupoActual.findOne({
                    where: {
                        id_cupo_base: cupoBase.id_cupo_base,
                        periodo: periodoSolicitud
                    },
                    transaction: t
                });

                if (cupoActual) {
                    // Reversar consumo
                    await cupoActual.decrement('cantidad_consumida', { by: excedente, transaction: t });
                    await cupoActual.increment('cantidad_disponible', { by: excedente, transaction: t });

                    // Si estaba agotado, activarlo
                    if (cupoActual.estado === 'AGOTADO') {
                        await cupoActual.update({ estado: 'ACTIVO' }, { transaction: t });
                    }
                    mensajeExcedente = `Se reintegraron ${excedente} Lts al cupo de ${periodoSolicitud} y al llenadero.`;
                    
                    // Notificar actualización de cupo
                    if (req.io) req.io.emit("cupo:actualizado", { id_cupo_actual: cupoActual.id_cupo_actual });
                } else {
                    mensajeExcedente = `Se reintegraron ${excedente} Lts al llenadero. Cupo del periodo ${periodoSolicitud} no encontrado/cerrado.`;
                }
            }

        }

        // FINALIZAR TICKET
        // Actualizar la cantidad despachada siempre, haya excedente o no.
        await solicitud.update({
            estado: 'FINALIZADA',
            fecha_validacion: new Date(),
            id_validador: id_validador,
            observaciones_validacion: observaciones,
            cantidad_despachada: cantidadReal
        }, { transaction: t });

        await t.commit();

        // Notificar
        if (req.io) req.io.emit('solicitud:finalizada', { id_solicitud: solicitud.id_solicitud, codigo: codigo_ticket });

        res.json({
            msg: "Ticket finalizado correctamente.",
            detalle: mensajeExcedente || "Sin diferencias (Carga completa).",
            ticket: solicitud
        });

    } catch (error) {
        if (!t.finished) await t.rollback();
        console.error("Error finalizando ticket:", error);
        res.status(500).json({ msg: "Error al finalizar ticket" });
    }
};
