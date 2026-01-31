const cron = require("node-cron");
const { Solicitud, CupoActual, CupoBase, sequelize } = require("../models");
const { Op } = require("sequelize");
const moment = require("moment");

const initCronJobs = (io) => {
  // RF-07: Cierre Diario a las 11:59 PM (23:59)
  // Se ejecuta todos los días a las 23:59
  cron.schedule("59 23 * * *", async () => {
    console.log("=== INICIANDO CIERRE DIARIO DE SOLICITUDES ===");
    const t = await sequelize.transaction();
    try {
      // 1. Buscar solicitudes activas que no fueron despachadas
      // Estados: PENDIENTE, APROBADA, IMPRESA
      const solicitudesVencidas = await Solicitud.findAll({
        where: {
          estado: { [Op.in]: ["PENDIENTE", "APROBADA", "IMPRESA"] }
        },
        transaction: t
      });

      console.log(`Encontradas ${solicitudesVencidas.length} solicitudes para vencer.`);

      for (const sol of solicitudesVencidas) {
        // 2. Reintegrar Cupo (RF-14)
        // Buscamos el cupo actual de la subdependencia a través de CupoBase
        const periodoActual = moment().format("YYYY-MM");
        const cupo = await CupoActual.findOne({
          where: { periodo: periodoActual },
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
          // Devolvemos los litros a 'cantidad_disponible'
          await cupo.increment("cantidad_disponible", { by: sol.cantidad_litros, transaction: t });
          // Restamos de 'cantidad_consumida'
          await cupo.decrement("cantidad_consumida", { by: sol.cantidad_litros, transaction: t });
        }

        // 3. Marcar como Vencida
        // Esto libera la placa automáticamente (RF-05 ya no la verá como activa)
        await sol.update({ estado: "VENCIDA" }, { transaction: t });
      }

      await t.commit();
      console.log("=== CIERRE DIARIO COMPLETADO EXITOSAMENTE ===");
      
      if (io) io.emit("cierre:diario", { msg: "Cierre diario ejecutado", cantidad: solicitudesVencidas.length });

    } catch (error) {
      if (!t.finished) await t.rollback();
      console.error("ERROR EN CIERRE DIARIO:", error);
    }
  });

  console.log("✅ Tareas programadas (Cron Jobs) iniciadas.");
};

module.exports = initCronJobs;
