const Modelo = require("../models/Modelo");
const Marca = require("../models/Marca");
const { paginate } = require("../helpers/paginationHelper");
const { withTransaction } = require("../helpers/transactionHelper");
const { Op } = require("sequelize");

// --- CREAR MODELO (Solo Admin) ---
exports.crearModelo = async (req, res) => {
  const { nombre, id_marca } = req.body;

  try {
    await withTransaction(req, async (t) => {
      // 1. Validar que la Marca exista
      const marcaExiste = await Marca.findByPk(id_marca, { transaction: t });
      if (!marcaExiste) {
        return res.status(404).json({ msg: "La marca seleccionada no existe." });
      }

      // 2. Validar duplicado (Mismo nombre en la misma marca)
      const modeloExiste = await Modelo.findOne({
        where: { nombre, id_marca },
        transaction: t,
      });
      if (modeloExiste) {
        return res
          .status(400)
          .json({ msg: `El modelo '${nombre}' ya existe en esta marca.` });
      }

      // 3. Crear
      const nuevoModelo = await Modelo.create(
        {
          nombre,
          id_marca,
          estado: "ACTIVO",
          
        },
        { transaction: t }
      );

      // Notificar vía socket
      req.io.emit("modelo:creado", nuevoModelo);

      res.status(201).json({
        msg: "Modelo creado exitosamente",
        modelo: nuevoModelo,
      });
    });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ msg: "Error al crear modelo" });
    }
  }
};

// --- OBTENER MODELOS (Solo Admin - Paginado) ---
exports.obtenerModelos = async (req, res) => {
  try {
    const searchableFields = ["nombre"];
    const where = {};
    
    // Si no es admin, filtramos por activos
    if (req.usuario.tipo_usuario !== "ADMIN") {
      where.estado = "ACTIVO";
    }

    const result = await paginate(Modelo, req.query, {
      where,
      searchableFields,
      include: [
        {
          model: Marca,
          attributes: ["nombre"],
        },
      ],
    });

    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: "Error al obtener modelos" });
  }
};

// --- ACTUALIZAR MODELO (Solo Admin) ---
exports.actualizarModelo = async (req, res) => {
  const { id } = req.params;
  const { nombre, id_marca, estado } = req.body;

  try {
    await withTransaction(req, async (t) => {
      const modelo = await Modelo.findByPk(id, { transaction: t });
      if (!modelo) {
        return res.status(404).json({ msg: "Modelo no encontrado" });
      }

      // Validar si cambia la marca
      if (id_marca && id_marca !== modelo.id_marca) {
        const marcaExiste = await Marca.findByPk(id_marca, { transaction: t });
        if (!marcaExiste) {
          return res.status(404).json({ msg: "La nueva marca no existe" });
        }
        modelo.id_marca = id_marca;
      }

      // Validar duplicado si cambia nombre o marca
      if (nombre || id_marca) {
        const checkNombre = nombre || modelo.nombre;
        const checkMarca = id_marca || modelo.id_marca;
        
        const existe = await Modelo.findOne({
          where: {
            nombre: checkNombre,
            id_marca: checkMarca,
            id_modelo: { [Op.ne]: id }
          },
          transaction: t
        });
        
        if (existe) {
          return res.status(400).json({ msg: "Ya existe un modelo con ese nombre en esa marca" });
        }
      }

      if (nombre) modelo.nombre = nombre;
      if (estado) modelo.estado = estado;

      modelo.fecha_modificacion = new Date();
      await modelo.save({ transaction: t });

      req.io.emit("modelo:actualizado", modelo);

      res.json({ msg: "Modelo actualizado", modelo });
    });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ msg: "Error al actualizar modelo" });
    }
  }
};

// --- DESACTIVAR MODELO (Solo Admin) ---
exports.desactivarModelo = async (req, res) => {
  const { id } = req.params;

  try {
    await withTransaction(req, async (t) => {
      const modelo = await Modelo.findByPk(id, { transaction: t });
      if (!modelo) {
        return res.status(404).json({ msg: "Modelo no encontrado" });
      }

      await modelo.update(
        {
          estado: "INACTIVO",
          fecha_modificacion: new Date(),
        },
        { transaction: t }
      );

      req.io.emit("modelo:actualizado", { id_modelo: id, estado: "INACTIVO" });

      res.json({ msg: "Modelo desactivado exitosamente" });
    });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ msg: "Error al desactivar modelo" });
    }
  }
};
