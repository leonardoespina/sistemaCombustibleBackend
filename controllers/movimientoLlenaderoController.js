const { MovimientoLlenadero, Llenadero, Usuario, TipoCombustible } = require("../models");
const { withTransaction } = require("../helpers/transactionHelper");
const { paginate } = require("../helpers/paginationHelper");
const { Op } = require("sequelize");

/**
 * Crear un nuevo movimiento (Carga o Evaporación)
 * Utiliza withTransaction para garantizar integridad y auditoría DB.
 */
exports.crearMovimiento = async (req, res) => {
  try {
    const result = await withTransaction(req, async (t) => {
      const { id_usuario } = req.usuario;
      const {
        id_llenadero,
        tipo_movimiento,
        cantidad,
        observacion,
        fecha_movimiento,
        // Campos opcionales (Carga)
        numero_factura,
        litros_factura,
        datos_gandola,
        nombre_conductor,
        cedula_conductor
      } = req.body;

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

      if (!llenadero) {
        throw { status: 404, msg: "Llenadero no encontrado." };
      }

      if (llenadero.estado !== 'ACTIVO') {
        throw { status: 400, msg: "El llenadero no está activo." };
      }

      const saldo_anterior = parseFloat(llenadero.disponibilidadActual);
      const capacidad = parseFloat(llenadero.capacidad || 0);
      let saldo_nuevo = 0;

      // 2. Validaciones y Cálculos según Tipo
      if (tipo_movimiento === "CARGA") {
        if (llenadero.capacidad) {
          const capacidad = parseFloat(llenadero.capacidad);
          if (saldo_anterior + cantidadDecimal > capacidad) {
            throw { status: 400, msg: `La carga excede la capacidad del tanque. Capacidad: ${capacidad}, Actual: ${saldo_anterior}, Intento: ${cantidadDecimal}` };
          }
        }
        saldo_nuevo = saldo_anterior + cantidadDecimal;

        // Validar datos obligatorios para Carga (Todos los campos son requeridos)
        if (!numero_factura || !datos_gandola || !nombre_conductor || !cedula_conductor) {
          throw {
            status: 400,
            msg: "Todos los datos son obligatorios para la Carga: Factura, Placa, Nombre y Cédula del Conductor."
          };
        }

      } else if (tipo_movimiento === "EVAPORACION") {
        // Validación de Regla de Negocio: Solo Gasolina
        // Recuperamos el tipo de combustible en una consulta separada
        let nombreCombustible = "";
        if (llenadero.id_combustible) {
          const tipo = await TipoCombustible.findByPk(llenadero.id_combustible, { transaction: t });
          if (tipo) nombreCombustible = tipo.nombre.toUpperCase();
        }

        // Verifica si contiene "GASOLINA" (ej: "GASOLINA 91", "GASOLINA 95")
        if (!nombreCombustible.includes("GASOLINA")) {
          throw {
            status: 400,
            msg: `La evaporación solo aplica para GASOLINA. Este llenadero contiene: ${nombreCombustible || 'Desconocido'}`
          };
        }

        if (saldo_anterior < cantidadDecimal) {
          throw { status: 400, msg: `No hay suficiente disponibilidad para registrar esa evaporación. Disponible: ${saldo_anterior}` };
        }
        saldo_nuevo = saldo_anterior - cantidadDecimal;

      } else {
        throw { status: 400, msg: "Tipo de movimiento inválido." };
      }

      // 3. Actualizar Llenadero
      await llenadero.update({ disponibilidadActual: saldo_nuevo }, { transaction: t });

      // 4. Calcular Porcentajes para el histórico
      const porcentaje_anterior = capacidad > 0 ? (saldo_anterior / capacidad) * 100 : 0;
      const porcentaje_nuevo = capacidad > 0 ? (saldo_nuevo / capacidad) * 100 : 0;

      // 5. Crear Registro Histórico
      const nuevoMovimiento = await MovimientoLlenadero.create({
        id_llenadero,
        id_usuario,
        tipo_movimiento,
        cantidad: cantidadDecimal,
        saldo_anterior,
        saldo_nuevo,
        porcentaje_anterior,
        porcentaje_nuevo,
        observacion,
        numero_factura: tipo_movimiento === 'CARGA' ? numero_factura : null,
        litros_factura: tipo_movimiento === 'CARGA' ? litros_factura : null,
        datos_gandola: tipo_movimiento === 'CARGA' ? datos_gandola : null,
        nombre_conductor: tipo_movimiento === 'CARGA' ? nombre_conductor : null,
        cedula_conductor: tipo_movimiento === 'CARGA' ? cedula_conductor : null,
        fecha_movimiento: fecha_movimiento || new Date()
      }, { transaction: t });

      // Devolver datos relevantes para la respuesta
      return { nuevoMovimiento, saldo_nuevo };
    });

    // Éxito
    if (req.io) {
      req.io.emit("llenadero:actualizado", {
        id_llenadero: req.body.id_llenadero,
        disponibilidadActual: result.saldo_nuevo
      });
    }

    res.status(201).json({
      msg: "Movimiento registrado exitosamente.",
      data: result.nuevoMovimiento
    });

  } catch (error) {
    console.error("Error en crearMovimiento:", error);
    const status = error.status || 500;
    const msg = error.msg || "Error al registrar movimiento.";
    res.status(status).json({ msg });
  }
};

/**
 * Listar Movimientos con paginación y filtros
 */
exports.listarMovimientos = async (req, res) => {
  try {
    const where = {};
    const { id_llenadero, tipo_movimiento, fecha_inicio, fecha_fin } = req.query;

    if (id_llenadero) where.id_llenadero = id_llenadero;
    if (tipo_movimiento) where.tipo_movimiento = tipo_movimiento;

    if (fecha_inicio && fecha_fin) {
      const start = new Date(fecha_inicio);
      const end = new Date(fecha_fin);
      end.setHours(23, 59, 59, 999);
      where.fecha_movimiento = { [Op.between]: [start, end] };
    }

    const searchableFields = ["numero_factura", "observacion", "datos_gandola"];

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
    console.error("Error en listarMovimientos:", error);
    res.status(500).json({ msg: "Error al listar movimientos." });
  }
};
