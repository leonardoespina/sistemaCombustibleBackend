const { Moneda, PrecioCombustible, TipoCombustible } = require("../models");
const { paginate } = require("../helpers/paginationHelper");
const { withTransaction } = require("../helpers/transactionHelper");
const { Op } = require("sequelize");

/**
 * === GESTIÓN DE MONEDAS ===
 */

// Obtener Monedas (con paginación y búsqueda)
exports.obtenerMonedas = async (req, res) => {
  try {
    const searchableFields = ["nombre", "simbolo"];
    const where = { activo: true };

    const paginatedResults = await paginate(Moneda, req.query, {
      where,
      searchableFields,
    });

    res.json(paginatedResults);
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: "Error al obtener monedas" });
  }
};

// Crear Moneda (Solo Admin)
exports.crearMoneda = async (req, res) => {
  const { nombre, simbolo } = req.body;

  try {
    await withTransaction(req, async (t) => {
      // Verificar si ya existe
      const existe = await Moneda.findOne({ where: { nombre }, transaction: t });
      if (existe) {
        return res.status(400).json({ msg: "La moneda ya existe con ese nombre" });
      }

      const nuevaMoneda = await Moneda.create({ nombre, simbolo, activo: true }, { transaction: t });

      req.io.emit("moneda:creado", nuevaMoneda);

      res.status(201).json({
        msg: "Moneda creada exitosamente",
        moneda: nuevaMoneda,
      });
    });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ msg: "Error al crear moneda" });
    }
  }
};

// Actualizar Moneda
exports.actualizarMoneda = async (req, res) => {
  const { id } = req.params;
  const { nombre, simbolo } = req.body;

  try {
    await withTransaction(req, async (t) => {
      let moneda = await Moneda.findByPk(id, { transaction: t });
      if (!moneda) {
        return res.status(404).json({ msg: "Moneda no encontrada" });
      }

      if (nombre && nombre !== moneda.nombre) {
        const existe = await Moneda.findOne({
          where: { nombre, id_moneda: { [Op.ne]: id } },
          transaction: t,
        });
        if (existe) {
          return res.status(400).json({ msg: "Ya existe una moneda con ese nombre" });
        }
        moneda.nombre = nombre;
      }

      if (simbolo) moneda.simbolo = simbolo;

      await moneda.save({ transaction: t });

      req.io.emit("moneda:actualizado", moneda);

      res.json({ msg: "Moneda actualizada correctamente", moneda });
    });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ msg: "Error al actualizar moneda" });
    }
  }
};

// Desactivar Moneda
exports.desactivarMoneda = async (req, res) => {
  const { id } = req.params;

  try {
    await withTransaction(req, async (t) => {
      const moneda = await Moneda.findByPk(id, { transaction: t });
      if (!moneda) {
        return res.status(404).json({ msg: "Moneda no encontrada" });
      }

      // Verificar si hay precios activos con esta moneda
      const preciosActivos = await PrecioCombustible.count({
        where: { id_moneda: id, activo: true },
        transaction: t,
      });

      if (preciosActivos > 0) {
        return res.status(400).json({
          msg: "No se puede desactivar la moneda porque tiene precios activos asociados",
        });
      }

      await moneda.update({ activo: false }, { transaction: t });

      req.io.emit("moneda:actualizado", moneda);

      res.json({ msg: "Moneda desactivada exitosamente" });
    });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ msg: "Error al desactivar moneda" });
    }
  }
};

/**
 * === GESTIÓN DE PRECIOS ===
 */

// Obtener Precios Actuales (Vista de Tabla Dinámica)
exports.obtenerPreciosActuales = async (req, res) => {
  try {
    const tipos = await TipoCombustible.findAll({
      include: [
        {
          model: PrecioCombustible,
          as: "Precios",
          where: { activo: true },
          required: false,
          include: [{ model: Moneda, as: "Moneda", where: { activo: true } }],
        },
      ],
    });

    // Formatear: cada combustible con sus precios agrupados por moneda
    const resultado = tipos.map((t) => {
      const fila = {
        id_tipo_combustible: t.id_tipo_combustible,
        nombre: t.nombre,
        precios: {}, // {Bs: 50, USD: 1.2, Au: 0.025}
      };

      t.Precios.forEach((p) => {
        fila.precios[p.Moneda.simbolo] = parseFloat(p.precio);
      });

      return fila;
    });

    res.json(resultado);
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: "Error al obtener precios" });
  }
};

// Actualizar Precios para un Combustible
exports.actualizarPrecios = async (req, res) => {
  const { id_tipo_combustible, precios } = req.body; // precios = { "Bs": 50, "USD": 1.2 }

  try {
    await withTransaction(req, async (t) => {
      // Validar que el combustible exista
      const combustible = await TipoCombustible.findByPk(id_tipo_combustible, { transaction: t });
      if (!combustible) {
        return res.status(404).json({ msg: "Tipo de combustible no encontrado" });
      }

      // Obtener monedas activas
      const monedas = await Moneda.findAll({ where: { activo: true }, transaction: t });

      for (const moneda of monedas) {
        const nuevoValor = precios[moneda.simbolo];

        if (nuevoValor !== undefined && nuevoValor !== null) {
          // Desactivar precio anterior
          await PrecioCombustible.update(
            { activo: false },
            {
              where: { id_tipo_combustible, id_moneda: moneda.id_moneda, activo: true },
              transaction: t,
            }
          );

          // Crear nuevo precio
          await PrecioCombustible.create(
            {
              id_tipo_combustible,
              id_moneda: moneda.id_moneda,
              precio: nuevoValor,
              activo: true,
              fecha_vigencia: new Date(),
            },
            { transaction: t }
          );
        }
      }

      req.io.emit("precio:actualizado", { id_tipo_combustible });

      res.json({ msg: "Precios actualizados correctamente" });
    });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ msg: "Error al actualizar precios" });
    }
  }
};
