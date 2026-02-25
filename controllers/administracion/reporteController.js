const {
  Solicitud,
  Usuario,
  Vehiculo,
  Dependencia,
  Subdependencia,
  PrecioCombustible,
  Moneda,
  Marca,
  Modelo,
  TipoCombustible,
  CupoActual,
  CupoBase,
  Categoria,
} = require("../../models");
const { Op } = require("sequelize");
const sequelize = require("sequelize");
const { paginate } = require("../../helpers/paginationHelper");

/**
 * Helper: Formatea datos de vehículo según tipo_suministro.
 * - BIDÓN: muestra etiqueta fija (no hay vehículo asociado).
 * - REGULAR/otros: usa el JOIN con Vehiculo y, como respaldo, el snapshot guardado en la solicitud.
 */
function formatVehiculo(solicitud) {
  if (solicitud.tipo_suministro === 'BIDON') {
    return { vehiculo: 'BIDÓN', placa: 'NO APLICA' };
  }
  const marca = solicitud.Vehiculo?.Marca?.nombre || solicitud.marca || '';
  const modelo = solicitud.Vehiculo?.Modelo?.nombre || solicitud.modelo || '';
  return {
    vehiculo: `${marca} ${modelo}`.trim() || 'Desconocido',
    placa: solicitud.Vehiculo?.placa || solicitud.placa || 'S/P',
  };
}

exports.generarReporteDiario = async (req, res) => {
  try {
    const { id_llenadero, fecha } = req.query;


    if (!id_llenadero || !fecha) {
      return res
        .status(400)
        .json({ msg: "Faltan parámetros obligatorios (id_llenadero, fecha)." });
    }

    // Ajuste para Zona Horaria (Venezuela UTC-4)
    // Se fuerza la interpretación de la fecha en la zona horaria correcta para cubrir el día local completo
    const fechaInicio = new Date(`${fecha}T00:00:00-04:00`);
    const fechaFin = new Date(`${fecha}T23:59:59.999-04:00`);

    // USAMOS fecha_solicitud COMO RESPALDO SI fecha_despacho ES NULL
    const whereBase = {
      id_llenadero,
      [Op.or]: [
        { fecha_despacho: { [Op.between]: [fechaInicio, fechaFin] } },
        {
          [Op.and]: [
            { fecha_despacho: null },
            { fecha_solicitud: { [Op.between]: [fechaInicio, fechaFin] } },
          ],
        },
      ],
      estado: "FINALIZADA",
    };


    // --- CONSULTAS PARA TOTALES (No paginadas) ---
    // Necesitamos el total del día independientemente de la página que estemos viendo
    const totalInstitucional = await Solicitud.sum("cantidad_despachada", {
      where: { ...whereBase, tipo_solicitud: "INSTITUCIONAL" },
    });

    const totalVentaLitros = await Solicitud.sum("cantidad_despachada", {
      where: { ...whereBase, tipo_solicitud: "VENTA" },
    });

    const totalVentaMonto = await Solicitud.sum("monto_total", {
      where: { ...whereBase, tipo_solicitud: "VENTA" },
    });

    // --- CONSULTA PAGINADA ---
    const result = await paginate(Solicitud, req.query, {
      where: whereBase,
      include: [
        {
          model: Usuario,
          as: "Solicitante",
          attributes: ["nombre", "apellido"],
        },
        {
          model: Vehiculo,
          required: false,
          attributes: ["placa"],
          include: [
            { model: Marca, as: "Marca", attributes: ["nombre"] },
            { model: Modelo, as: "Modelo", attributes: ["nombre"] },
          ],
        },
        {
          model: Dependencia,
          as: "Dependencia",
          attributes: ["nombre_dependencia"],
        },
        { model: Subdependencia, as: "Subdependencia", attributes: ["nombre"] },
        {
          model: PrecioCombustible,
          as: "PrecioCombustible",
          attributes: ["precio", "id_moneda"],
          include: [
            { model: Moneda, as: "Moneda", attributes: ["nombre", "simbolo"] },
          ],
        },
      ],
      attributes: [
        "id_solicitud",
        "codigo_ticket",
        "fecha_validacion",
        "cantidad_litros",
        "cantidad_despachada",
        "monto_total",
        "precio_unitario",
        "tipo_solicitud",
        "tipo_suministro",
        "placa",
        "marca",
        "modelo",
      ],
      order: [["id_solicitud", "ASC"]],
    });

    const institucionalData = result.data.filter(
      (s) => s.tipo_solicitud === "INSTITUCIONAL",
    );
    const ventasData = result.data.filter((s) => s.tipo_solicitud === "VENTA");

    let saldosPorMoneda = {};

    const formatVenta = (v) => {
      const f = v.fecha_validacion; // Mostrar fecha de validación
      const cant_solic = parseFloat(v.cantidad_litros || 0);
      const cant_desp = parseFloat(v.cantidad_despachada || 0);
      const precio = parseFloat(
        v.PrecioCombustible?.precio || v.precio_unitario || 0,
      );
      const simbolo =
        v.PrecioCombustible?.Moneda?.simbolo || (v.id_precio ? "N/A" : "$");

      let saldo_favor = 0;
      if (cant_desp < cant_solic) {
        saldo_favor = (cant_solic - cant_desp) * precio;
      }

      if (saldo_favor > 0) {
        if (!saldosPorMoneda[simbolo]) saldosPorMoneda[simbolo] = 0;
        saldosPorMoneda[simbolo] += saldo_favor;
      }

      return {
        id_solicitud: v.id_solicitud,
        codigo_ticket: v.codigo_ticket,
        fecha: f,
        hora: f
          ? new Date(f).toLocaleTimeString("es-VE", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
          })
          : "",
        solicitante: `${v.Solicitante?.nombre} ${v.Solicitante?.apellido}`,
        ...formatVehiculo(v),
        dependencia: v.Dependencia?.nombre_dependencia,
        subdependencia: v.Subdependencia?.nombre,
        cant_solic: v.cantidad_litros,
        cant_desp: v.cantidad_despachada,
        precio: v.PrecioCombustible?.precio || v.precio_unitario,
        total_pagar: v.monto_total,
        moneda: simbolo,
        saldo_favor: saldo_favor.toFixed(2),
      };
    };

    const ventasMapped = ventasData.map(formatVenta);

    // Convertir objeto de saldos a array para el frontend
    const resumenSaldos = Object.keys(saldosPorMoneda).map((moneda) => ({
      moneda,
      total: saldosPorMoneda[moneda].toFixed(2),
    }));

    const reporteData = {
      institucional: institucionalData.map((i) => {
        const f = i.fecha_validacion; // Mostrar fecha de validación
        return {
          id_solicitud: i.id_solicitud,
          codigo_ticket: i.codigo_ticket,
          fecha: f,
          hora: f
            ? new Date(f).toLocaleTimeString("es-VE", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: true,
            })
            : "",
          solicitante: `${i.Solicitante?.nombre} ${i.Solicitante?.apellido}`,
          ...formatVehiculo(i),
          dependencia: i.Dependencia?.nombre_dependencia,
          subdependencia: i.Subdependencia?.nombre,
          cant_solic: i.cantidad_litros,
          cant_desp: i.cantidad_despachada,
        };
      }),
      venta: ventasMapped,
      pagination: result.pagination,
      totales: {
        litros_institucional: (parseFloat(totalInstitucional) || 0).toFixed(2),
        litros_venta: (parseFloat(totalVentaLitros) || 0).toFixed(2),
        monto_venta: (parseFloat(totalVentaMonto) || 0).toFixed(2),
        total_litros: (
          (parseFloat(totalInstitucional) || 0) +
          (parseFloat(totalVentaLitros) || 0)
        ).toFixed(2),
        resumen_saldos: resumenSaldos,
      },
    };

    res.json(reporteData);
  } catch (error) {
    console.error("CRITICAL Error en reporte diario:", error);
    res
      .status(500)
      .json({ msg: "Error al generar el reporte.", error: error.message });
  }
};

/**
 * Reporte detallado de despachos con filtros por Dependencia, Subdependencia y Fechas.
 */
exports.consultarDespachos = async (req, res) => {
  try {
    const {
      id_dependencia,
      id_subdependencia,
      id_tipo_combustible,
      fecha_desde,
      fecha_hasta,
    } = req.query;

    if (!fecha_desde || !fecha_hasta) {
      return res
        .status(400)
        .json({ msg: "Debe seleccionar un rango de fechas (Desde y Hasta)." });
    }

    const where = {
      estado: "FINALIZADA",
    };

    // Filtros opcionales (manejo robusto de valores nulos o vacíos)
    const isValidFilter = (val) =>
      val && val !== "null" && val !== "undefined" && val !== "";

    if (isValidFilter(id_dependencia)) {
      where.id_dependencia = id_dependencia;
    }
    if (isValidFilter(id_subdependencia)) {
      where.id_subdependencia = id_subdependencia;
    }
    if (isValidFilter(id_tipo_combustible)) {
      where.id_tipo_combustible = id_tipo_combustible;
    }

    // Rango de fechas (Zona horaria)
    const start = new Date(`${fecha_desde}T00:00:00-04:00`);
    const end = new Date(`${fecha_hasta}T23:59:59.999-04:00`);

    // Criterio de fecha: Usar fecha_despacho, o fecha_solicitud como respaldo
    where[Op.or] = [
      { fecha_despacho: { [Op.between]: [start, end] } },
      {
        [Op.and]: [
          { fecha_despacho: null },
          { fecha_solicitud: { [Op.between]: [start, end] } },
        ],
      },
    ];


    // Usar el helper de paginación
    const result = await paginate(Solicitud, req.query, {
      where,
      include: [
        {
          model: Vehiculo,
          required: false,
          attributes: ["placa"],
          include: [
            { model: Marca, as: "Marca", attributes: ["nombre"] },
            { model: Modelo, as: "Modelo", attributes: ["nombre"] },
          ],
        },
        {
          model: Usuario,
          as: "Solicitante",
          attributes: ["nombre", "apellido"],
        },
        {
          model: Dependencia,
          as: "Dependencia",
          attributes: ["nombre_dependencia"],
        },
        { model: Subdependencia, as: "Subdependencia", attributes: ["nombre"] },
      ],
      attributes: [
        "id_solicitud",
        "codigo_ticket",
        "fecha_validacion",
        "cantidad_litros",
        "cantidad_despachada",
        "tipo_suministro",
        "placa",
        "marca",
        "modelo",
      ],
      order: [["fecha_validacion", "ASC"]],
    });

    // Calcular el Total General de TODA la consulta (no solo de la página actual)
    const totalDespachado = await Solicitud.sum("cantidad_despachada", {
      where,
    });

    // Procesar datos para el reporte
    const filas = result.data.map((d) => {
      const f = d.fecha_validacion; // Mostrar fecha de validación
      return {
        id: d.id_solicitud,
        codigo_ticket: d.codigo_ticket,
        fecha: f,
        hora: f
          ? new Date(f).toLocaleTimeString("es-VE", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
          })
          : "",
        ...formatVehiculo(d),
        dependencia: d.Dependencia?.nombre_dependencia,
        subdependencia: d.Subdependencia?.nombre,
        solicitante: `${d.Solicitante?.nombre} ${d.Solicitante?.apellido}`,
        cantidad_aprobada: parseFloat(d.cantidad_litros),
        cantidad_despachada: parseFloat(d.cantidad_despachada || 0),
      };
    });

    res.json({
      data: filas,
      pagination: result.pagination,
      total_general: (totalDespachado || 0).toFixed(2),
    });
  } catch (error) {
    console.error("Error en reporte de despachos:", error);
    res
      .status(500)
      .json({ msg: "Error al consultar despachos.", error: error.message });
  }
};

/**
 * Reporte de consumo agregado por Dependencia y Tipo de Combustible.
 * Utiliza agregación SQL para mayor eficiencia y escalabilidad.
 */
exports.obtenerConsumoPorDependencia = async (req, res) => {
  try {
    const { fecha_desde, fecha_hasta } = req.query;

    if (!fecha_desde || !fecha_hasta) {
      return res
        .status(400)
        .json({ msg: "Rango de fechas requerido (fecha_desde, fecha_hasta)." });
    }

    // Ajuste de zona horaria local
    const start = new Date(`${fecha_desde}T00:00:00-04:00`);
    const end = new Date(`${fecha_hasta}T23:59:59.999-04:00`);

    const where = {
      estado: "FINALIZADA",
      fecha_validacion: { [Op.between]: [start, end] },
    };

    // Consultar sumatorias agrupadas por Dependencia y Tipo de Combustible
    const consumos = await Solicitud.findAll({
      where,
      attributes: [
        "id_dependencia",
        "id_tipo_combustible",
        [
          sequelize.fn("SUM", sequelize.col("cantidad_despachada")),
          "total_litros",
        ],
      ],
      include: [
        {
          model: Dependencia,
          as: "Dependencia",
          attributes: ["nombre_dependencia"],
        },
        {
          model: TipoCombustible,
          attributes: ["nombre"],
        },
      ],
      group: [
        "Solicitud.id_dependencia",
        "Solicitud.id_tipo_combustible",
        "Dependencia.id_dependencia",
        "Dependencia.nombre_dependencia",
        "TipoCombustible.id_tipo_combustible",
        "TipoCombustible.nombre",
      ],
      order: [[sequelize.col("Dependencia.nombre_dependencia"), "ASC"]],
    });

    // Formatear la respuesta para el consumo del frontend
    const data = consumos.map((c) => ({
      id_dependencia: c.id_dependencia,
      dependencia: c.Dependencia?.nombre_dependencia || "Desconocida",
      id_tipo_combustible: c.id_tipo_combustible,
      tipo_combustible: c.TipoCombustible?.nombre || "N/A",
      total_litros: parseFloat(
        parseFloat(c.get("total_litros") || 0).toFixed(2),
      ),
    }));

    res.json(data);
  } catch (error) {
    console.error("Error en reporte de consumo por dependencia:", error);
    res.status(500).json({
      msg: "Error al generar el reporte estadístico.",
      error: error.message,
    });
  }
};

/**
 * Reporte de Cupos Actuales por Dependencia del Usuario
 * Permite a cualquier usuario ver el estado de los cupos de SU dependencia asignada.
 */
exports.obtenerReporteCuposUsuario = async (req, res) => {
  try {
    const { id_usuario } = req.usuario;
    const { periodo } = req.query; // Opcional: YYYY-MM

    // Usar periodo actual si no se especifica
    const periodoConsulta = periodo || new Date().toISOString().slice(0, 7); // YYYY-MM

    // 1. Obtener datos frescos del usuario (Dependencia/Subdependencia) desde la BD
    const usuarioBD = await Usuario.findByPk(id_usuario, {
      attributes: [
        "id_dependencia",
        "id_subdependencia",
        "nombre",
        "apellido",
        "estado",
      ],
    });

    if (!usuarioBD) {
      return res.status(404).json({ msg: "Usuario no encontrado." });
    }

    if (usuarioBD.estado !== "ACTIVO") {
      return res.status(403).json({ msg: "Usuario inactivo." });
    }

    const { id_dependencia } = usuarioBD;

    console.log(
      `[Reporte Cupos] Usuario: ${id_usuario}, Dep: ${id_dependencia}, Periodo: ${periodoConsulta}`,
    );

    if (!id_dependencia) {
      return res.status(400).json({
        msg: "El usuario no tiene una dependencia asignada para consultar cupos.",
      });
    }

    // Construir filtro para CupoBase
    // CAMBIO SOLICITADO: Mostrar TODOS los cupos de la dependencia,
    // independientemente de si el usuario tiene subdependencia asignada o no.
    const whereCupoBase = {
      id_dependencia: id_dependencia,
    };

    const cupos = await CupoActual.findAll({
      where: {
        periodo: periodoConsulta,
      },
      include: [
        {
          model: CupoBase,
          as: "CupoBase",
          where: whereCupoBase, // Filtra por dependencia, trayendo todas las subdependencias
          include: [
            { model: Categoria, as: "Categoria", attributes: ["nombre"] },
            {
              model: Dependencia,
              as: "Dependencia",
              attributes: ["nombre_dependencia"],
            },
            {
              model: Subdependencia,
              as: "Subdependencia",
              attributes: ["nombre"],
            },
            {
              model: TipoCombustible,
              as: "TipoCombustible",
              attributes: ["nombre"],
            },
          ],
        },
      ],
      order: [
        // Ordenar primero por dependencia (aunque es la misma) y luego por subdependencia
        [sequelize.col("CupoBase.Dependencia.nombre_dependencia"), "ASC"],
        [sequelize.col("CupoBase.Subdependencia.nombre"), "ASC"],
      ],
    });

    // Formatear respuesta para el reporte
    const reporte = cupos.map((c) => ({
      id_cupo_actual: c.id_cupo_actual,
      periodo: c.periodo,
      dependencia: c.CupoBase?.Dependencia?.nombre_dependencia,
      subdependencia: c.CupoBase?.Subdependencia?.nombre || "General",
      categoria: c.CupoBase?.Categoria?.nombre,
      tipo_combustible: c.CupoBase?.TipoCombustible?.nombre,
      asignado: parseFloat(c.cantidad_asignada),
      consumido: parseFloat(c.cantidad_consumida),
      recargado: parseFloat(c.cantidad_recargada),
      disponible: parseFloat(c.cantidad_disponible),
      estado: c.estado,
      porcentaje_uso:
        c.cantidad_asignada > 0
          ? ((c.cantidad_consumida / c.cantidad_asignada) * 100).toFixed(1)
          : "0.0",
    }));

    res.json({
      periodo: periodoConsulta,
      usuario_solicitante: req.usuario.nombre + " " + req.usuario.apellido,
      data: reporte,
    });
  } catch (error) {
    console.error("Error al obtener reporte de cupos de usuario:", error);
    res
      .status(500)
      .json({ msg: "Error al consultar sus cupos.", error: error.message });
  }
};
