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
      // Calcular el inicio del día actual (00:00:00)
      const inicioDiaActual = moment().startOf('day').toDate();

      console.log(`Buscando solicitudes creadas ANTES de: ${moment(inicioDiaActual).format("YYYY-MM-DD HH:mm:ss")}`);

      // 1. Buscar solicitudes activas que no fueron despachadas Y que son de días anteriores
      // Estados: PENDIENTE, APROBADA, IMPRESA
      // IMPORTANTE: Solo vencer solicitudes del día anterior o anteriores
      const solicitudesVencidas = await Solicitud.findAll({
        where: {
          estado: { [Op.in]: ["PENDIENTE", "APROBADA", "IMPRESA"] },
          fecha_solicitud: { [Op.lt]: inicioDiaActual } // Menor que inicio del día actual
        },
        transaction: t
      });

      console.log(`Encontradas ${solicitudesVencidas.length} solicitudes para vencer.`);

      for (const sol of solicitudesVencidas) {
        console.log(`Venciendo solicitud ID: ${sol.id_solicitud}, Placa: ${sol.placa}, Fecha: ${moment(sol.fecha_solicitud).format("YYYY-MM-DD HH:mm:ss")}`);

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
          console.log(`Reintegrando ${sol.cantidad_litros} litros al cupo ID: ${cupo.id_cupo_actual}`);
          // Devolvemos los litros a 'cantidad_disponible'
          await cupo.increment("cantidad_disponible", { by: sol.cantidad_litros, transaction: t });
          // Restamos de 'cantidad_consumida'
          await cupo.decrement("cantidad_consumida", { by: sol.cantidad_litros, transaction: t });
        } else {
          console.log(`⚠️ No se encontró cupo para reintegrar - Solicitud ID: ${sol.id_solicitud}`);
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
    console.log("=== INICIANDO REINICIO MENSUAL DE CUPOS ===");
    console.log(`Fecha/Hora actual: ${moment().format("YYYY-MM-DD HH:mm:ss")}`);

    const t = await sequelize.transaction();

    try {
      const mesAnterior = moment().subtract(1, 'month').format("YYYY-MM");
      const mesNuevo = moment().format("YYYY-MM");
      const fechaInicio = moment().startOf("month").toDate();
      const fechaFin = moment().endOf("month").toDate();

      console.log(`Cerrando cupos del mes: ${mesAnterior}`);
      console.log(`Creando cupos para el mes: ${mesNuevo}`);

      // 1. Cerrar cupos del mes anterior
      const cuposAnteriores = await CupoActual.findAll({
        where: { periodo: mesAnterior, estado: { [Op.ne]: "CERRADO" } },
        transaction: t
      });

      console.log(`Encontrados ${cuposAnteriores.length} cupos del mes anterior para cerrar.`);

      for (const cupo of cuposAnteriores) {
        // Guardar historial
        await HistorialCupoMensual.create({
          id_cupo_base: cupo.id_cupo_base,
          periodo: cupo.periodo,
          cantidad_asignada: cupo.cantidad_asignada,
          cantidad_consumida: cupo.cantidad_consumida,
          cantidad_recargada: cupo.cantidad_recargada,
          cantidad_no_utilizada: cupo.cantidad_disponible,
          fecha_cierre: new Date()
        }, { transaction: t });

        // Cerrar
        await cupo.update({ estado: "CERRADO" }, { transaction: t });
        console.log(`  ✅ Cupo ID ${cupo.id_cupo_actual} cerrado (Periodo: ${cupo.periodo})`);
      }

      // 2. Crear nuevos cupos para el mes actual
      const cuposBaseActivos = await CupoBase.findAll({
        where: { activo: true },
        transaction: t
      });

      console.log(`Encontrados ${cuposBaseActivos.length} cupos base activos para crear.`);

      let cuposCreados = 0;
      for (const base of cuposBaseActivos) {
        // Verificar si ya existe para evitar duplicados
        const existe = await CupoActual.findOne({
          where: { id_cupo_base: base.id_cupo_base, periodo: mesNuevo },
          transaction: t
        });

        if (!existe) {
          await CupoActual.create({
            id_cupo_base: base.id_cupo_base,
            periodo: mesNuevo,
            cantidad_asignada: base.cantidad_mensual,
            cantidad_disponible: base.cantidad_mensual,
            cantidad_consumida: 0,
            cantidad_recargada: 0,
            fecha_inicio: fechaInicio,
            fecha_fin: fechaFin,
            estado: "ACTIVO"
          }, { transaction: t });
          cuposCreados++;
          console.log(`  ✅ Cupo creado para base ID ${base.id_cupo_base} (${base.cantidad_mensual} litros)`);
        } else {
          console.log(`  ⚠️  Cupo ya existe para base ID ${base.id_cupo_base} - Saltando`);
        }
      }

      await t.commit();
      console.log("=== REINICIO MENSUAL COMPLETADO EXITOSAMENTE ===");
      console.log(`📊 Resumen:`);
      console.log(`   - Cupos cerrados (${mesAnterior}): ${cuposAnteriores.length}`);
      console.log(`   - Cupos creados (${mesNuevo}): ${cuposCreados}`);

      if (io) {
        io.emit("cupo:reinicio-mensual", {
          msg: "Reinicio mensual completado",
          mesAnterior,
          mesNuevo,
          cerrados: cuposAnteriores.length,
          creados: cuposCreados
        });
      }

    } catch (error) {
      if (!t.finished) await t.rollback();
      console.error("ERROR EN REINICIO MENSUAL:", error);

      if (io) {
        io.emit("cupo:reinicio-mensual-error", {
          msg: "Error en reinicio mensual",
          error: error.message
        });
      }
    }
  }, {
    timezone: "America/Caracas"
  });

  console.log("✅ Tareas programadas (Cron Jobs) iniciadas.");
  console.log("📅 Cron de cierre diario: Todos los días a las 23:59 (America/Caracas)");
  console.log("📅 Cron de reinicio mensual: Día 1 de cada mes a las 00:05 (America/Caracas)");
};

module.exports = initCronJobs;
