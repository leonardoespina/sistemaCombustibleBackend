const {
  Solicitud,
  CupoActual,
  Llenadero,
  Subdependencia,
  Usuario,
  CupoBase,
  Dependencia,
  TipoCombustible,
} = require("../models");
const { executeTransaction } = require("../helpers/transactionHelper");
const moment = require("moment");
const { Op } = require("sequelize");

/**
 * Consultar datos de un Ticket para validación
 */
exports.consultarTicket = async (codigo) => {
  const solicitud = await Solicitud.findOne({
    where: { codigo_ticket: codigo },
    include: [
      {
        model: Dependencia,
        as: "Dependencia",
        attributes: ["nombre_dependencia", "codigo"],
      },
      { model: Subdependencia, as: "Subdependencia", attributes: ["nombre"] },
      { model: TipoCombustible, attributes: ["nombre"] },
      { model: Llenadero, attributes: ["nombre_llenadero"] },
      {
        model: Usuario,
        as: "Solicitante",
        attributes: ["nombre", "apellido", "cedula"],
      },
      { model: Usuario, as: "Validador", attributes: ["nombre", "apellido"] },
    ],
  });

  if (!solicitud) {
    const error = new Error("Ticket no encontrado");
    error.status = 404;
    throw error;
  }

  // Validar estado
  if (solicitud.estado === "FINALIZADA") {
    return {
      msg: "Este ticket ya fue validado y finalizado anteriormente.",
      ticket: solicitud,
      status: "ALREADY_FINALIZED",
    };
  }

  if (!["DESPACHADA", "IMPRESA"].includes(solicitud.estado)) {
    const error = new Error(
      `El ticket no está en estado válido para validación (Estado actual: ${solicitud.estado}). Debe estar IMPRESA o DESPACHADA.`,
    );
    error.status = 400;
    error.statusCode = "INVALID_STATE";
    throw error;
  }

  return {
    msg: "Ticket listo para validación",
    ticket: solicitud,
    status: "READY",
  };
};

/**
 * Finalizar Ticket
 */
exports.finalizarTicket = async (data, user, clientIp) => {
  const { codigo_ticket, cantidad_real_cargada, observaciones } = data;
  const id_validador = user.id_usuario;

  if (!codigo_ticket) throw new Error("Código de ticket requerido");

  return await executeTransaction(clientIp, async (t) => {
    const solicitud = await Solicitud.findOne({
      where: { codigo_ticket },
      transaction: t,
    });

    if (!solicitud) {
      throw new Error("Ticket no encontrado");
    }

    if (!["DESPACHADA", "IMPRESA"].includes(solicitud.estado)) {
      throw new Error(
        `El ticket debe estar IMPRESA o DESPACHADA para finalizar (Estado: ${solicitud.estado})`,
      );
    }

    const cantidadAprobada = parseFloat(solicitud.cantidad_litros);
    const cantidadReal = parseFloat(cantidad_real_cargada);

    if (cantidadReal > cantidadAprobada) {
      throw new Error("La cantidad real no puede ser mayor a la aprobada.");
    }

    const excedente = cantidadAprobada - cantidadReal;
    let mensajeExcedente = "";

    // LOGICA DE INVENTARIO (LLENADERO)
    const llenadero = await Llenadero.findByPk(solicitud.id_llenadero, {
      transaction: t,
    });

    if (llenadero) {
      if (solicitud.estado === "IMPRESA") {
        await llenadero.decrement("disponibilidadActual", {
          by: cantidadReal,
          transaction: t,
        });
      } else if (solicitud.estado === "DESPACHADA") {
        if (excedente > 0) {
          await llenadero.increment("disponibilidadActual", {
            by: excedente,
            transaction: t,
          });
        }
      }
    }

    // PROCESAR EXCEDENTE (Reintegro de CUPO)
    let updatedCupoId = null;
    if (excedente > 0) {
      const fechaSolicitud = moment(solicitud.fecha_solicitud);
      const periodoSolicitud = fechaSolicitud.format("YYYY-MM");

      const cupoBase = await CupoBase.findOne({
        where: {
          id_subdependencia: solicitud.id_subdependencia,
          id_tipo_combustible: solicitud.id_tipo_combustible,
        },
        transaction: t,
      });

      if (cupoBase) {
        const cupoActual = await CupoActual.findOne({
          where: {
            id_cupo_base: cupoBase.id_cupo_base,
            periodo: periodoSolicitud,
          },
          transaction: t,
        });

        if (cupoActual) {
          await cupoActual.decrement("cantidad_consumida", {
            by: excedente,
            transaction: t,
          });
          await cupoActual.increment("cantidad_disponible", {
            by: excedente,
            transaction: t,
          });

          if (cupoActual.estado === "AGOTADO") {
            await cupoActual.update({ estado: "ACTIVO" }, { transaction: t });
          }
          mensajeExcedente = `Se reintegraron ${excedente} Lts al cupo de ${periodoSolicitud} y al llenadero.`;
          updatedCupoId = cupoActual.id_cupo_actual;
        } else {
          mensajeExcedente = `Se reintegraron ${excedente} Lts al llenadero. Cupo del periodo ${periodoSolicitud} no encontrado/cerrado.`;
        }
      }
    }

    // FINALIZAR TICKET
    await solicitud.update(
      {
        estado: "FINALIZADA",
        fecha_validacion: new Date(),
        id_validador: id_validador,
        observaciones_validacion: observaciones,
        cantidad_despachada: cantidadReal,
      },
      { transaction: t },
    );

    return {
      msg: "Ticket finalizado correctamente.",
      detalle: mensajeExcedente || "Sin diferencias (Carga completa).",
      ticket: solicitud,
      updatedCupoId,
    };
  });
};
