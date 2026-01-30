const Llenadero = require("../models/Llenadero");
const { paginate } = require("../helpers/paginationHelper");
const { withTransaction } = require("../helpers/transactionHelper");
const { Op } = require("sequelize");

// --- CREAR LLENADERO (Solo Admin) ---
exports.crearLlenadero = async (req, res) => {
  const { nombre_llenadero, capacidad, id_combustible, disponibilidadActual } = req.body;

  try {
    await withTransaction(req, async (t) => {
      // 1. Validar duplicados
      const existe = await Llenadero.findOne({
        where: { nombre_llenadero },
        transaction: t,
      });
      if (existe) {
        return res.status(400).json({ msg: `El llenadero '${nombre_llenadero}' ya existe.` });
      }

      // 2. Crear registro con auditoría
      const nuevoLlenadero = await Llenadero.create(
        {
          nombre_llenadero,
          capacidad,
          id_combustible,
          disponibilidadActual: disponibilidadActual || 0,
          estado: "ACTIVO",
        },
        { transaction: t }
      );

      // Notificar vía socket
      req.io.emit("llenadero:creado", nuevoLlenadero);

      res.status(201).json({
        msg: "Llenadero creado exitosamente",
        llenadero: nuevoLlenadero,
      });
    });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ msg: "Error al crear el llenadero" });
    }
  }
};

// --- OBTENER LLENADEROS (Paginado y Búsqueda) ---
exports.obtenerLlenaderos = async (req, res) => {
  try {
    const searchableFields = ["nombre_llenadero"];
    const where = {};

    // Si no es admin, filtramos por activos
    if (req.usuario.tipo_usuario !== "ADMIN") {
      where.estado = "ACTIVO";
    }

    const result = await paginate(Llenadero, req.query, {
      where,
      searchableFields,
      include: [
        { model: require("../models/TipoCombustible"), as: "TipoCombustible", attributes: ["nombre"] }
      ],
    });

    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: "Error al obtener llenaderos" });
  }
};

// --- ACTUALIZAR LLENADERO (Solo Admin) ---
exports.actualizarLlenadero = async (req, res) => {
  const { id } = req.params;
  const { nombre_llenadero, capacidad, id_combustible, disponibilidadActual, estado } = req.body;

  try {
    await withTransaction(req, async (t) => {
      const llenadero = await Llenadero.findByPk(id, { transaction: t });

      if (!llenadero) {
        return res.status(404).json({ msg: "Llenadero no encontrado" });
      }

      // 1. Validar nombre duplicado
      if (nombre_llenadero && nombre_llenadero !== llenadero.nombre_llenadero) {
        const existe = await Llenadero.findOne({
          where: {
            nombre_llenadero,
            id_llenadero: { [Op.ne]: id },
          },
          transaction: t,
        });
        if (existe) {
          return res.status(400).json({ msg: `El llenadero '${nombre_llenadero}' ya existe.` });
        }
        llenadero.nombre_llenadero = nombre_llenadero;
      }

      // 2. Actualizar capacidad
      if (capacidad !== undefined) {
        llenadero.capacidad = capacidad;
      }

      // 3. Actualizar tipo de combustible
      if (id_combustible !== undefined) {
        llenadero.id_combustible = id_combustible;
      }

      // 4. Actualizar disponibilidad actual
      if (disponibilidadActual !== undefined) {
        llenadero.disponibilidadActual = disponibilidadActual;
      }

      if (estado) {
        llenadero.estado = estado;
      }

      llenadero.fecha_modificacion = new Date();
      await llenadero.save({ transaction: t });

      // Notificar vía socket
      req.io.emit("llenadero:actualizado", llenadero);

      res.json({
        msg: "Llenadero actualizado correctamente",
        llenadero,
      });
    });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ msg: "Error al actualizar el llenadero" });
    }
  }
};

// --- DESACTIVAR LLENADERO (Solo Admin - Soft Delete) ---
exports.desactivarLlenadero = async (req, res) => {
  const { id } = req.params;

  try {
    await withTransaction(req, async (t) => {
      const llenadero = await Llenadero.findByPk(id, { transaction: t });

      if (!llenadero) {
        return res.status(404).json({ msg: "Llenadero no encontrado" });
      }

      await llenadero.update(
        {
          estado: "INACTIVO",
          fecha_modificacion: new Date(),
        },
        { transaction: t }
      );

      // Notificar vía socket
      req.io.emit("llenadero:actualizado", { id_llenadero: id, estado: "INACTIVO" });

      res.json({ msg: "Llenadero desactivado exitosamente" });
    });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ msg: "Error al desactivar el llenadero" });
    }
  }
};

// --- LISTA SIMPLE (Para selectores) ---
exports.obtenerListaLlenaderos = async (req, res) => {
  try {
    const llenaderos = await Llenadero.findAll({
      where: { estado: "ACTIVO" },
      include: [
        { model: require("../models/TipoCombustible"), as: "TipoCombustible", attributes: ["nombre"] }
      ],
      order: [["nombre_llenadero", "ASC"]],
    });

    res.json(llenaderos);
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: "Error al obtener la lista de llenaderos" });
  }
};
