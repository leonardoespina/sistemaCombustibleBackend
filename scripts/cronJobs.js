const cron = require("node-cron");
const { Solicitud, CupoActual, CupoBase, HistorialCupoMensual, sequelize } = require("../models");
const { Op } = require("sequelize");
const moment = require("moment");

const initCronJobs = (io) => {
  // RF-07: Cierre Diario a las 11:59 PM (23:59)
  // Se ejecuta todos los días a las 23:59
  // Configuración de timezone para Venezuela (UTC-4)
  cron.schedule("59 23 * * *", async () => {
    console.log("=== INICIANDO CIERRE DIARIO DE SOLICITUDES ===");
    console.log(`Fecha/Hora actual: ${moment().format("YYYY-MM-DD HH:mm:ss")}`);

    const t = await sequelize.transaction();
    try {
      // Calcular el final del día actual (23:59:59)
      const finDiaActual = moment().endOf('day').toDate();

      console.log(`Buscando solicitudes activas ANTES de: ${moment(finDiaActual).format("YYYY-MM-DD HH:mm:ss")}`);

      // 1. Buscar solicitudes activas que no fueron despachadas
      // Estados: PENDIENTE, APROBADA, IMPRESA
      const solicitudesVencidas = await Solicitud.findAll({
        where: {
          estado: { [Op.in]: ["PENDIENTE", "APROBADA", "IMPRESA"] },
          fecha_solicitud: { [Op.lte]: finDiaActual } // Menor o igual al final del día de ejecución
        },
        transaction: t
      });

      console.log(`Encontradas ${solicitudesVencidas.length} solicitudes para vencer.`);

      for (const sol of solicitudesVencidas) {
        console.log(`Venciendo solicitud ID: ${sol.id_solicitud}, Placa: ${sol.placa}, Fecha: ${moment(sol.fecha_solicitud).format("YYYY-MM-DD HH:mm:ss")}`);

        // 2. Reintegrar Cupo (RF-14)
        // Buscamos el cupo del periodo en que se creó la solicitud
        const periodoSolicitud = moment(sol.fecha_solicitud).format("YYYY-MM");
        const cupo = await CupoActual.findOne({
          where: {
            periodo: periodoSolicitud,
            estado: { [Op.ne]: "CERRADO" } // No reintegrar a cupos ya cerrados legalmente
          },
          include: [{
            model: CupoBase,
            as: "CupoBase",
            where: {
              id_subdependencia: sol.id_subdependencia,
              id_tipo_combustible: sol.id_tipo_combustible
            }
          }],
          transaction: t
        });

        if (cupo) {
          console.log(`Reintegrando ${sol.cantidad_litros} litros al cupo ID: ${cupo.id_cupo_actual} del periodo ${periodoSolicitud}`);
          // Devolvemos los litros a 'cantidad_disponible'
          await cupo.increment("cantidad_disponible", { by: sol.cantidad_litros, transaction: t });
          // Restamos de 'cantidad_consumida'
          await cupo.decrement("cantidad_consumida", { by: sol.cantidad_litros, transaction: t });
        } else {
          console.log(`⚠️ No se encontró cupo ABIERTO para el periodo ${periodoSolicitud} - Solicitud ID: ${sol.id_solicitud}`);
        }

        // 3. Marcar como Vencida
        // Esto libera la placa automáticamente (RF-05 ya no la verá como activa)
        await sol.update({ estado: "VENCIDA" }, { transaction: t });
      }

      await t.commit();
      console.log("=== CIERRE DIARIO COMPLETADO EXITOSAMENTE ===");
      console.log(`Total de solicitudes vencidas: ${solicitudesVencidas.length}`);

      if (io) io.emit("cierre:diario", { msg: "Cierre diario ejecutado", cantidad: solicitudesVencidas.length });

    } catch (error) {
      if (!t.finished) await t.rollback();
      console.error("ERROR EN CIERRE DIARIO:", error);
    }
  }, {
    timezone: "America/Caracas" // Zona horaria de Venezuela (UTC-4)
  });

  // ============================================================
  // CRON JOB 2: REINICIO MENSUAL DE CUPOS
  // ============================================================
  // Se ejecuta el día 1 de cada mes a las 00:05 AM
  cron.schedule("5 0 1 * *", async () => {
    console.log("=== INICIANDO REINICIO MENSUAL AUTOMÁTICO (CRON) ===");
    try {
      const cupoController = require("../controllers/cupoController");
      const resultado = await cupoController.reiniciarCuposMensuales();

      if (resultado.success) {
        if (io) io.emit("cupo:reinicio-mensual", { msg: "Reinicio mensual completado exitosamente" });
      } else {
        throw new Error(resultado.error);
      }
    } catch (error) {
      console.error("ERROR EN REINICIO MENSUAL (CRON):", error);
    }
  }, {
    timezone: "America/Caracas"
  });

  console.log("✅ Tareas programadas (Cron Jobs) iniciadas.");
  console.log("📅 Cron de cierre diario: Todos los días a las 23:59 (America/Caracas)");
  console.log("📅 Cron de reinicio mensual: Día 1 de cada mes a las 00:05 (America/Caracas)");
};

module.exports = initCronJobs;
