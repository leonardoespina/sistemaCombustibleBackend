const Categoria = require("../models/Categoria");
const Dependencia = require("../models/Dependencia");
const Subdependencia = require("../models/Subdependencia");
const { paginate } = require("../helpers/paginationHelper");
const { getHierarchy } = require("../helpers/hierarchyHelper");
const { withTransaction } = require("../helpers/transactionHelper");
const { Op } = require("sequelize");

// --- CREAR CATEGORÍA (Solo Admin) ---
exports.crearCategoria = async (req, res) => {
  const { nombre } = req.body;

  try {
    await withTransaction(req, async (t) => {
      // 1. Verificar si ya existe (opcional, por nombre)
      const existe = await Categoria.findOne({ where: { nombre }, transaction: t });
      if (existe) {
        return res.status(400).json({ msg: "La categoría ya existe con ese nombre" });
      }

      // 2. Crear
      const categoria = await Categoria.create({
        nombre,
        registrado_por: req.usuario.id_usuario, // Asumiendo que req.usuario existe por el middleware de auth
        fecha_registro: new Date(),
        estado: "ACTIVO",
      }, { transaction: t });

      // Notificar a clientes
      req.io.emit("categoria:creado", categoria);

      res.status(201).json({
        msg: "Categoría creada exitosamente",
        categoria,
      });
    });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ msg: "Error en el servidor" });
    }
  }
};

// --- OBTENER JERARQUÍA (Lazy Loading / Search) ---
exports.obtenerJerarquia = async (req, res) => {
  try {
    // Definición de la estructura jerárquica
    const levels = [
      { 
        model: Categoria, 
        type: 'categoria',
        searchFields: ['nombre'],
        where: { estado: 'ACTIVO' }
      },
      { 
        model: Dependencia, 
        alias: 'Dependencias', 
        foreignKey: 'id_categoria', 
        type: 'dependencia',
        where: { estatus: 'ACTIVO' }
      },
      { 
        model: Subdependencia, 
        alias: 'Subdependencias', 
        foreignKey: 'id_dependencia', 
        type: 'subdependencia',
        where: { estatus: 'ACTIVO' }
      }
    ];

    // Filtros base para el nivel raíz (Categorías)
    // Nota: Aunque getHierarchy usa rootWhere, hemos añadido 'where' a cada nivel 
    // para que el helper lo use.
    const rootWhere = { estado: 'ACTIVO' };

    const result = await getHierarchy(levels, req.query, { rootWhere });
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: "Error obteniendo jerarquía de categorías" });
  }
};

// --- OBTENER CATEGORÍAS (Solo Admin o Auth) ---
exports.obtenerCategorias = async (req, res) => {
  try {
    const searchableFields = ["nombre"];

    const where = {};
    
    // Si NO es admin, forzamos que solo vea los activos.
    // Si ES admin, podrá ver todo (o lo que filtre por query).
    if (!req.usuario || req.usuario.tipo_usuario !== 'ADMIN') {
      where.estado = 'ACTIVO';
    }

    const paginatedResults = await paginate(Categoria, req.query, {
      where,
      searchableFields,
    });

    res.json(paginatedResults);
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: "Error obteniendo categorías" });
  }
};

// --- ACTUALIZAR CATEGORÍA ---
exports.actualizarCategoria = async (req, res) => {
  const { id } = req.params;
  const { nombre, estado } = req.body;

  try {
    await withTransaction(req, async (t) => {
      // 1. Verificar existencia
      let categoria = await Categoria.findByPk(id, { transaction: t });
      if (!categoria) {
        return res.status(404).json({ msg: "Categoría no encontrada" });
      }

      // Validar que el nombre no se repita en otra categoría
      if (nombre && nombre !== categoria.nombre) {
        const existe = await Categoria.findOne({
          where: {
            nombre,
            id_categoria: { [Op.ne]: id }
          },
          transaction: t
        });
        if (existe) {
          return res.status(400).json({ msg: "La categoría ya existe con ese nombre" });
        }
        categoria.nombre = nombre;
      }

      // 2. Actualizar
      // if (nombre) categoria.nombre = nombre; // Ya se asignó arriba si cambió
      if (estado) categoria.estado = estado;
      
      categoria.fecha_modificacion = new Date();

      await categoria.save({ transaction: t });

      // Notificar a clientes
      req.io.emit("categoria:actualizado", categoria);

      res.json({
        msg: "Categoría actualizada correctamente",
        categoria,
      });
    });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ msg: "Error al actualizar categoría" });
    }
  }
};

// --- DESACTIVAR CATEGORÍA ---
exports.desactivarCategoria = async (req, res) => {
  const { id } = req.params;

  try {
    await withTransaction(req, async (t) => {
      const categoria = await Categoria.findByPk(id, { transaction: t });

      if (!categoria) {
        return res.status(404).json({ msg: "Categoría no encontrada" });
      }

      // Verificar si hay dependencias activas asociadas
      const dependenciasActivas = await Dependencia.count({
        where: {
          id_categoria: id,
          estatus: "ACTIVO"
        },
        transaction: t
      });

      if (dependenciasActivas > 0) {
        return res.status(400).json({ 
          msg: "No se puede desactivar la categoría porque tiene dependencias activas asociadas. Desactive las dependencias primero." 
        });
      }

      // Soft Delete
      await categoria.update({
        estado: "INACTIVO",
        fecha_modificacion: new Date(),
      }, { transaction: t });

      // Notificar a clientes
      req.io.emit("categoria:actualizado", categoria);

      res.json({ msg: "Categoría desactivada exitosamente" });
    });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ msg: "Error al desactivar categoría" });
    }
  }
};
