const { MovimientoLlenadero, Llenadero, Usuario, TipoCombustible } = require("../models");
const { withTransaction } = require("../helpers/transactionHelper");
const { paginate } = require("../helpers/paginationHelper");
const { Op } = require("sequelize");

/**
 * Registrar una nueva evaporación
 * Solo permitido para Gasolina. Resta inventario.
 */
exports.registrarEvaporacion = async (req, res) => {
  try {
    const result = await withTransaction(req, async (t) => {
      const { id_usuario } = req.usuario;
      const { id_llenadero, cantidad, observacion } = req.body;

      const cantidadDecimal = parseFloat(cantidad);
      if (isNaN(cantidadDecimal) || cantidadDecimal <= 0) {
        throw { status: 400, msg: "La cantidad debe ser un número positivo." };
      }

      // 1. Buscar y Bloquear Llenadero
      // NOTA: No usamos include aquí para evitar error "FOR UPDATE cannot be applied to the nullable side of an outer join"
      const llenadero = await Llenadero.findByPk(id_llenadero, {
        transaction: t,
        lock: true
      });

      if (!llenadero) throw { status: 404, msg: "Llenadero no encontrado." };
      if (llenadero.estado !== 'ACTIVO') throw { status: 400, msg: "El llenadero no está activo." };

      // 2. Validación de Regla de Negocio: Solo Gasolina
      // Recuperamos el tipo de combustible en una consulta separada
      let nombreCombustible = "";
      if (llenadero.id_combustible) {
         const tipo = await TipoCombustible.findByPk(llenadero.id_combustible, { transaction: t });
         if (tipo) nombreCombustible = tipo.nombre.toUpperCase();
      }

      if (!nombreCombustible.includes("GASOLINA")) {
        throw { 
          status: 400, 
          msg: `La evaporación solo aplica para GASOLINA. Este llenadero contiene: ${nombreCombustible || 'Desconocido'}` 
        };
      }

      const saldo_anterior = parseFloat(llenadero.disponibilidadActual);

      if (saldo_anterior < cantidadDecimal) {
        throw { status: 400, msg: `No hay suficiente disponibilidad para registrar esa evaporación. Disponible: ${saldo_anterior}` };
      }

      const saldo_nuevo = saldo_anterior - cantidadDecimal;

      // 3. Actualizar Llenadero
      await llenadero.update({ disponibilidadActual: saldo_nuevo }, { transaction: t });

      // 4. Crear Registro Histórico
      const nuevoMovimiento = await MovimientoLlenadero.create({
        id_llenadero,
        id_usuario,
        tipo_movimiento: "EVAPORACION",
        cantidad: cantidadDecimal,
        saldo_anterior,
        saldo_nuevo,
        observacion,
        fecha_movimiento: new Date()
      }, { transaction: t });

      return { nuevoMovimiento, saldo_nuevo };
    });

    // Notificar socket
    if (req.io) {
      req.io.emit("llenadero:actualizado", { 
        id_llenadero: req.body.id_llenadero, 
        disponibilidadActual: result.saldo_nuevo 
      });
    }

    res.status(201).json({
      msg: "Evaporación registrada exitosamente.",
      data: result.nuevoMovimiento
    });

  } catch (error) {
    console.error("Error en registrarEvaporacion:", error);
    const status = error.status || 500;
    const msg = error.msg || "Error al registrar evaporación.";
    res.status(status).json({ msg });
  }
};

/**
 * Listar solo Evaporaciones
 */
exports.listarEvaporaciones = async (req, res) => {
  try {
    const where = { tipo_movimiento: "EVAPORACION" };
    
    if (req.query.id_llenadero) where.id_llenadero = req.query.id_llenadero;
    
    if (req.query.fecha_inicio && req.query.fecha_fin) {
        const start = new Date(req.query.fecha_inicio);
        const end = new Date(req.query.fecha_fin);
        end.setHours(23, 59, 59, 999);
        where.fecha_movimiento = { [Op.between]: [start, end] };
    }

    const searchableFields = ["observacion"];

    const result = await paginate(MovimientoLlenadero, req.query, {
      where,
      searchableFields,
      include: [
        { model: Llenadero, as: 'Llenadero', attributes: ['nombre_llenadero'] },
        { model: Usuario, as: 'Usuario', attributes: ['nombre', 'apellido', 'cedula'] }
      ],
      order: [['fecha_movimiento', 'DESC']]
    });

    res.json(result);
  } catch (error) {
    console.error("Error en listarEvaporaciones:", error);
    res.status(500).json({ msg: "Error al listar evaporaciones." });
  }
};
