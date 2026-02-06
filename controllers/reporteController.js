const { Solicitud, Usuario, Vehiculo, Dependencia, Subdependencia, PrecioCombustible, Moneda, Marca, Modelo } = require("../models");
const { Op } = require("sequelize");
const sequelize = require("sequelize");

exports.generarReporteDiario = async (req, res) => {
  try {
    const { id_llenadero, fecha } = req.query;

    console.log(`[DEBUG] Generando reporte diario - Llenadero: ${id_llenadero}, Fecha: ${fecha}`);

    if (!id_llenadero || !fecha) {
      return res.status(400).json({ msg: "Faltan parámetros obligatorios (id_llenadero, fecha)." });
    }

    const fechaInicio = new Date(fecha);
    fechaInicio.setHours(0, 0, 0, 0);
    const fechaFin = new Date(fecha);
    fechaFin.setHours(23, 59, 59, 999);

    // USAMOS fecha_solicitud COMO RESPALDO SI fecha_despacho ES NULL
    const whereBase = {
      id_llenadero,
      [Op.or]: [
        { fecha_despacho: { [Op.between]: [fechaInicio, fechaFin] } },
        { 
          [Op.and]: [
            { fecha_despacho: null },
            { fecha_solicitud: { [Op.between]: [fechaInicio, fechaFin] } }
          ]
        }
      ],
      estado: 'FINALIZADA'
    };

    console.log("[DEBUG] Filtros SQL Ajustados:", JSON.stringify(whereBase));

    // --- CONSULTA INSTITUCIONAL ---
    const institucional = await Solicitud.findAll({
      where: { ...whereBase, tipo_solicitud: 'INSTITUCIONAL' },
      include: [
        { model: Usuario, as: 'Solicitante', attributes: ['nombre', 'apellido'] },
        { 
            model: Vehiculo, 
            attributes: ['placa'],
            include: [
                { model: Marca, as: 'Marca', attributes: ['nombre'] },
                { model: Modelo, as: 'Modelo', attributes: ['nombre'] }
            ]
        },
        { model: Dependencia, as: 'Dependencia', attributes: ['nombre_dependencia'] }, 
        { model: Subdependencia, as: 'Subdependencia', attributes: ['nombre'] }
      ],
      attributes: ['id_solicitud', 'cantidad_litros', 'cantidad_despachada'],
      order: [['id_solicitud', 'ASC']]
    });

    // --- CONSULTA VENTA ---
    const ventas = await Solicitud.findAll({
      where: { ...whereBase, tipo_solicitud: 'VENTA' },
      include: [
        { model: Usuario, as: 'Solicitante', attributes: ['nombre', 'apellido'] },
        { 
            model: Vehiculo, 
            attributes: ['placa'],
            include: [
                { model: Marca, as: 'Marca', attributes: ['nombre'] },
                { model: Modelo, as: 'Modelo', attributes: ['nombre'] }
            ]
        },
        { model: Dependencia, as: 'Dependencia', attributes: ['nombre_dependencia'] }, 
        { model: Subdependencia, as: 'Subdependencia', attributes: ['nombre'] }, 
        { 
            model: PrecioCombustible, 
            as: 'PrecioCombustible', 
            attributes: ['precio', 'id_moneda'],
            include: [{ model: Moneda, as: 'Moneda', attributes: ['nombre', 'simbolo'] }] 
        }
      ],
      attributes: ['id_solicitud', 'cantidad_litros', 'cantidad_despachada', 'monto_total', 'precio_unitario'],
      order: [['id_solicitud', 'ASC']]
    });

    const totalInstitucional = institucional.reduce((sum, item) => sum + parseFloat(item.cantidad_despachada || 0), 0);
    const totalVentaLitros = ventas.reduce((sum, item) => sum + parseFloat(item.cantidad_despachada || 0), 0);
    const totalVentaMonto = ventas.reduce((sum, item) => sum + parseFloat(item.monto_total || 0), 0);

    const reporteData = {
      institucional: institucional.map(i => ({
        solicitante: `${i.Solicitante?.nombre} ${i.Solicitante?.apellido}`,
        vehiculo: `${i.Vehiculo?.Marca?.nombre} ${i.Vehiculo?.Modelo?.nombre}`,
        placa: i.Vehiculo?.placa,
        dependencia: i.Dependencia?.nombre_dependencia,
        subdependencia: i.Subdependencia?.nombre,
        cant_solic: i.cantidad_litros,
        cant_desp: i.cantidad_despachada
      })),
      venta: ventas.map(v => ({
        solicitante: `${v.Solicitante?.nombre} ${v.Solicitante?.apellido}`,
        vehiculo: `${v.Vehiculo?.Marca?.nombre} ${v.Vehiculo?.Modelo?.nombre}`,
        placa: v.Vehiculo?.placa,
        dependencia: v.Dependencia?.nombre_dependencia,
        subdependencia: v.Subdependencia?.nombre,
        cant_solic: v.cantidad_litros,
        cant_desp: v.cantidad_despachada,
        precio: v.PrecioCombustible?.precio || v.precio_unitario,
        total_pagar: v.monto_total,
        moneda: v.PrecioCombustible?.Moneda?.simbolo 
      })),
      totales: {
        litros_institucional: totalInstitucional.toFixed(2),
        litros_venta: totalVentaLitros.toFixed(2),
        monto_venta: totalVentaMonto.toFixed(2),
        total_litros: (totalInstitucional + totalVentaLitros).toFixed(2)
      }
    };

    res.json(reporteData);

  } catch (error) {
    console.error("CRITICAL Error en reporte diario:", error);
    res.status(500).json({ msg: "Error al generar el reporte.", error: error.message });
  }
};
