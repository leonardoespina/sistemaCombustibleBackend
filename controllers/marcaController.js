const Marca = require("../models/Marca");
const { paginate } = require("../helpers/paginationHelper");
const { withTransaction } = require("../helpers/transactionHelper");
const { Op } = require("sequelize");

// --- CREAR MARCA (Solo Admin) ---
exports.crearMarca = async (req, res) => {
  const { nombre } = req.body;

  try {
    await withTransaction(req, async (t) => {
      // 1. Validar duplicados
      const existe = await Marca.findOne({
        where: { nombre },
        transaction: t,
      });
      if (existe) {
        return res.status(400).json({ msg: `La marca '${nombre}' ya existe.` });
      }

      // 2. Crear registro con auditoría
      const nuevaMarca = await Marca.create(
        {
          nombre,
          estado: "ACTIVO",
          registrado_por: req.usuario.id_usuario,
          fecha_registro: new Date(),
          fecha_modificacion: new Date(),
        },
        { transaction: t }
      );

      // Notificar vía socket
      req.io.emit("marca:creado", nuevaMarca);

      res.status(201).json({
        msg: "Marca creada exitosamente",
        marca: nuevaMarca,
      });
    });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ msg: "Error al crear la marca" });
    }
  }
};

// --- OBTENER MARCAS (Paginado y Búsqueda) ---
exports.obtenerMarcas = async (req, res) => {
  try {
    const searchableFields = ["nombre"];
    const where = {};

    // Si no es admin, filtramos por activos
    if (req.usuario.tipo_usuario !== "ADMIN") {
      where.estado = "ACTIVO";
    }

    const result = await paginate(Marca, req.query, {
      where,
      searchableFields,
    });

    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: "Error al obtener marcas" });
  }
};

// --- ACTUALIZAR MARCA (Solo Admin) ---
exports.actualizarMarca = async (req, res) => {
  const { id } = req.params;
  const { nombre, estado } = req.body;

  try {
    await withTransaction(req, async (t) => {
      const marca = await Marca.findByPk(id, { transaction: t });

      if (!marca) {
        return res.status(404).json({ msg: "Marca no encontrada" });
      }

      // 1. Validar nombre duplicado
      if (nombre && nombre !== marca.nombre) {
        const existe = await Marca.findOne({
          where: {
            nombre,
            id_marca: { [Op.ne]: id },
          },
          transaction: t,
        });
        if (existe) {
          return res.status(400).json({ msg: `La marca '${nombre}' ya existe.` });
        }
        marca.nombre = nombre;
      }

      if (estado) {
        marca.estado = estado;
      }

      marca.fecha_modificacion = new Date();
      await marca.save({ transaction: t });

      // Notificar vía socket
      req.io.emit("marca:actualizado", marca);

      res.json({
        msg: "Marca actualizada correctamente",
        marca,
      });
    });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ msg: "Error al actualizar la marca" });
    }
  }
};

// --- DESACTIVAR MARCA (Solo Admin - Soft Delete) ---
exports.desactivarMarca = async (req, res) => {
  const { id } = req.params;

  try {
    await withTransaction(req, async (t) => {
      const marca = await Marca.findByPk(id, { transaction: t });

      if (!marca) {
        return res.status(404).json({ msg: "Marca no encontrada" });
      }

      await marca.update(
        {
          estado: "INACTIVO",
          fecha_modificacion: new Date(),
        },
        { transaction: t }
      );

      // Notificar vía socket
      req.io.emit("marca:actualizado", { id_marca: id, estado: "INACTIVO" });

      res.json({ msg: "Marca desactivada exitosamente" });
    });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ msg: "Error al desactivar la marca" });
    }
  }
};

// --- LISTA SIMPLE (Para selectores) ---
exports.obtenerListaMarcas = async (req, res) => {
  try {
    const marcas = await Marca.findAll({
      where: { estado: "ACTIVO" },
      attributes: ["id_marca", "nombre"],
      order: [["nombre", "ASC"]],
    });

    res.json(marcas);
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: "Error al obtener la lista de marcas" });
  }
};
