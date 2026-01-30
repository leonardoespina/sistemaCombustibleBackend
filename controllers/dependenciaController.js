const Dependencia = require("../models/Dependencia");
const Categoria = require("../models/Categoria");
const { paginate } = require("../helpers/paginationHelper");
const { withTransaction } = require("../helpers/transactionHelper");
const { Op } = require("sequelize");

// --- CREAR DEPENDENCIA ---
exports.crearDependencia = async (req, res) => {
  const { 
    id_categoria,
    nombre_dependencia, 
    codigo, 
    tipo_venta,
    estatus 
  } = req.body;

  try {
    await withTransaction(req, async (t) => {
      // Validar que exista la Categoría
      const categoria = await Categoria.findByPk(id_categoria, { transaction: t });
      if (!categoria) {
        return res.status(404).json({ msg: "Categoría no encontrada" });
      }

      // Verificar si ya existe una dependencia con el mismo nombre
      const existe = await Dependencia.findOne({ where: { nombre_dependencia }, transaction: t });
      if (existe) {
        return res.status(400).json({ msg: "La dependencia ya existe con ese nombre" });
      }

      const dependencia = await Dependencia.create({
        id_categoria,
        nombre_dependencia,
        codigo,
        tipo_venta: tipo_venta || "INSTITUCIONAL",
        estatus: estatus || "ACTIVO",
        fecha_registro: new Date(),
        fecha_modificacion: new Date(),
      }, { transaction: t });

      // Notificar a clientes
      req.io.emit("dependencia:creado", dependencia);

      res.status(201).json({ msg: "Dependencia creada exitosamente", dependencia });
    });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ msg: "Error al crear dependencia" });
    }
  }
};

// --- OBTENER DEPENDENCIAS ---
exports.obtenerDependencias = async (req, res) => {
  try {
    const searchableFields = ["nombre_dependencia", "codigo"];
    
    // Incluir datos de la Categoría
    const include = [
      { model: Categoria, as: 'Categoria', attributes: ["nombre"] },
    ];

    const where = {};
    // Si NO es admin, forzamos que solo vea los activos.
    if (!req.usuario || req.usuario.tipo_usuario !== 'ADMIN') {
      where.estatus = 'ACTIVO';
    }

    const paginatedResults = await paginate(Dependencia, req.query, {
      searchableFields,
      include,
      where
    });
    
    res.json(paginatedResults);
  } catch (error) {
     console.error(error);
     res.status(500).json({ msg: "Error al obtener dependencias" });
  }
};

// --- ACTUALIZAR DEPENDENCIA ---
exports.actualizarDependencia = async (req, res) => {
    const { id } = req.params;
    const { 
      id_categoria,
      nombre_dependencia, 
      codigo, 
      tipo_venta,
      estatus 
    } = req.body;

    try {
        await withTransaction(req, async (t) => {
            const dependencia = await Dependencia.findByPk(id, { transaction: t });
            if (!dependencia) {
                return res.status(404).json({ msg: "Dependencia no encontrada" });
            }

            if (id_categoria) {
                 const categoria = await Categoria.findByPk(id_categoria, { transaction: t });
                 if (!categoria) return res.status(404).json({ msg: "Categoría no encontrada" });
                 dependencia.id_categoria = id_categoria;
            }

            // Validar que el nombre no se repita
            if (nombre_dependencia && nombre_dependencia !== dependencia.nombre_dependencia) {
                const existe = await Dependencia.findOne({
                    where: {
                        nombre_dependencia,
                        id_dependencia: { [Op.ne]: id }
                    },
                    transaction: t
                });
                if (existe) {
                    return res.status(400).json({ msg: "La dependencia ya existe con ese nombre" });
                }
                dependencia.nombre_dependencia = nombre_dependencia;
            }

            if (codigo) dependencia.codigo = codigo;
            if (tipo_venta) dependencia.tipo_venta = tipo_venta;
            if (estatus) dependencia.estatus = estatus;

            dependencia.fecha_modificacion = new Date();
            
            await dependencia.save({ transaction: t });

            req.io.emit("dependencia:actualizado", dependencia);
            
            res.json({ msg: "Dependencia actualizada", dependencia });
        });
    } catch (error) {
        console.error(error);
        if (!res.headersSent) {
            res.status(500).json({ msg: "Error al actualizar dependencia" });
        }
    }
};

// --- DESACTIVAR DEPENDENCIA ---
exports.desactivarDependencia = async (req, res) => {
    const { id } = req.params;
    try {
        await withTransaction(req, async (t) => {
             const dependencia = await Dependencia.findByPk(id, { transaction: t });
             if (!dependencia) return res.status(404).json({ msg: "Dependencia no encontrada" });
             
             await dependencia.update({ estatus: "INACTIVO", fecha_modificacion: new Date() }, { transaction: t });
             
             req.io.emit("dependencia:actualizado", dependencia);
             res.json({ msg: "Dependencia desactivada" });
        });
    } catch (error) {
        console.error(error);
        if (!res.headersSent) {
            res.status(500).json({ msg: "Error al desactivar" });
        }
    }
};

// --- LISTAR TODAS (Para selectores) ---
exports.listarTodas = async (req, res) => {
    try {
        const dependencias = await Dependencia.findAll({
            where: { estatus: 'ACTIVO' },
            attributes: ['id_dependencia', 'nombre_dependencia', 'id_categoria'],
            order: [['nombre_dependencia', 'ASC']]
        });
        res.json({ data: dependencias });
    } catch (error) {
        console.error(error);
        res.status(500).json({ msg: "Error al listar dependencias" });
    }
};
