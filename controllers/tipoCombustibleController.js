const TipoCombustible = require("../models/TipoCombustible");
const { paginate } = require("../helpers/paginationHelper");
const { withTransaction } = require("../helpers/transactionHelper");
const { Op } = require("sequelize");

// --- CREAR TIPO DE COMBUSTIBLE ---
exports.crearTipoCombustible = async (req, res) => {
  const { nombre, descripcion, activo } = req.body;

  try {
    await withTransaction(req, async (t) => {
      // Verificar si ya existe con el mismo nombre
      const existe = await TipoCombustible.findOne({ where: { nombre }, transaction: t });
      if (existe) {
        return res.status(400).json({ msg: "El tipo de combustible ya existe" });
      }

      const tipo = await TipoCombustible.create({
        nombre,
        descripcion,
        activo: activo !== undefined ? activo : true
      }, { transaction: t });

      req.io.emit("tipo_combustible:creado", tipo);

      res.status(201).json({ msg: "Tipo de combustible creado exitosamente", data: tipo });
    });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ msg: "Error al crear tipo de combustible" });
    }
  }
};

// --- OBTENER TIPOS DE COMBUSTIBLE (Paginado) ---
exports.obtenerTiposCombustible = async (req, res) => {
  try {
    const searchableFields = ["nombre", "descripcion"];
    const where = {};
    
    // Si no es admin, quizás solo mostrar activos (opcional, aquí asumimos solo admin accede según requerimiento)
    // if (!req.usuario || req.usuario.tipo_usuario !== 'ADMIN') { where.activo = true; }

    const paginatedResults = await paginate(TipoCombustible, req.query, {
      searchableFields,
      where
    });
    
    res.json(paginatedResults);
  } catch (error) {
     console.error(error);
     res.status(500).json({ msg: "Error al obtener tipos de combustible" });
  }
};

// --- OBTENER TODOS (Lista simple para Selects) ---
exports.listarTodos = async (req, res) => {
    try {
        const tipos = await TipoCombustible.findAll({
            where: { activo: true },
            attributes: ['id_tipo_combustible', 'nombre'],
            order: [["nombre", "ASC"]],
        });
        res.json(tipos);
    } catch (error) {
        console.error(error);
        res.status(500).json({ msg: "Error al listar tipos de combustible" });
    }
};

// --- ACTUALIZAR TIPO DE COMBUSTIBLE ---
exports.actualizarTipoCombustible = async (req, res) => {
    const { id } = req.params;
    const { nombre, descripcion, activo } = req.body;

    try {
        await withTransaction(req, async (t) => {
            const tipo = await TipoCombustible.findByPk(id, { transaction: t });
            if (!tipo) {
                return res.status(404).json({ msg: "Tipo de combustible no encontrado" });
            }

            if (nombre && nombre !== tipo.nombre) {
                const existe = await TipoCombustible.findOne({
                    where: { nombre, id_tipo_combustible: { [Op.ne]: id } },
                    transaction: t
                });
                if (existe) {
                    return res.status(400).json({ msg: "Ya existe otro tipo de combustible con ese nombre" });
                }
                tipo.nombre = nombre;
            }

            if (descripcion !== undefined) tipo.descripcion = descripcion;
            if (activo !== undefined) tipo.activo = activo;
            
            await tipo.save({ transaction: t });

            req.io.emit("tipo_combustible:actualizado", tipo);
            
            res.json({ msg: "Tipo de combustible actualizado", data: tipo });
        });
    } catch (error) {
        console.error(error);
        if (!res.headersSent) {
            res.status(500).json({ msg: "Error al actualizar tipo de combustible" });
        }
    }
};

// --- ELIMINAR (Soft Delete / Desactivar) ---
exports.eliminarTipoCombustible = async (req, res) => {
    const { id } = req.params;
    try {
        await withTransaction(req, async (t) => {
             const tipo = await TipoCombustible.findByPk(id, { transaction: t });
             if (!tipo) return res.status(404).json({ msg: "Tipo de combustible no encontrado" });
             
             // En lugar de borrar físico, desactivamos para mantener integridad referencial
             await tipo.update({ activo: false }, { transaction: t });
             
             req.io.emit("tipo_combustible:actualizado", tipo);
             res.json({ msg: "Tipo de combustible desactivado" });
        });
    } catch (error) {
        console.error(error);
        if (!res.headersSent) {
            res.status(500).json({ msg: "Error al desactivar tipo de combustible" });
        }
    }
};
