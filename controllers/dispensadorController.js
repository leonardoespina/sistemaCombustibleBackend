const { Dispensador, Tanque } = require("../models");
const { paginate } = require("../helpers/paginationHelper");
const { withTransaction } = require("../helpers/transactionHelper");
const { Op } = require("sequelize");

// --- CREAR DISPENSADOR (Auth) ---
exports.crearDispensador = async (req, res) => {
  const { codigo, nombre, id_tanque, estado } = req.body;

  try {
    await withTransaction(req, async (t) => {
      // 1. Verificar duplicado por código
      const existe = await Dispensador.findOne({ where: { codigo }, transaction: t });
      if (existe) {
        return res.status(400).json({ msg: `El código ${codigo} ya está registrado.` });
      }

      // 2. Verificar existencia del Tanque
      const tanque = await Tanque.findByPk(id_tanque, { transaction: t });
      if (!tanque) {
        return res.status(404).json({ msg: "El tanque especificado no existe." });
      }

      // 3. Crear registro
      const dispensador = await Dispensador.create({
        codigo,
        nombre,
        id_tanque,
        estado: estado || "ACTIVO",
        registrado_por: req.usuario.id_usuario,
        fecha_registro: new Date(),
        fecha_modificacion: new Date(),
      }, { transaction: t });

      // Notificar
      req.io.emit("dispensador:creado", dispensador);

      res.status(201).json({ msg: "Dispensador creado exitosamente", dispensador });
    });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ msg: "Error al crear dispensador" });
    }
  }
};

// --- OBTENER DISPENSADORES (Paginado) ---
exports.obtenerDispensadores = async (req, res) => {
  try {
    const { id_tanque, estado } = req.query;
    const searchableFields = ["codigo", "nombre"];
    const where = {};

    if (id_tanque) where.id_tanque = id_tanque;
    if (estado) where.estado = estado;

    // Si no es admin, quizás filtrar por activos (opcional según requerimiento, 
    // pero el usuario pidió acceso a varios roles, asumimos que todos ven todo o filtro por estado)
    // Dejaré el filtro abierto a parámetros.

    const result = await paginate(Dispensador, req.query, {
      where,
      searchableFields,
      include: [
        { model: Tanque, as: "Tanque", attributes: ["nombre", "codigo"] }
      ],
      order: [["codigo", "ASC"]]
    });

    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: "Error al obtener dispensadores" });
  }
};

// --- ACTUALIZAR DISPENSADOR ---
exports.actualizarDispensador = async (req, res) => {
  const { id } = req.params;
  const { codigo, nombre, id_tanque, estado } = req.body;

  try {
    await withTransaction(req, async (t) => {
      const dispensador = await Dispensador.findByPk(id, { transaction: t });
      if (!dispensador) {
        return res.status(404).json({ msg: "Dispensador no encontrado" });
      }

      // Validar código duplicado
      if (codigo && codigo !== dispensador.codigo) {
        const existe = await Dispensador.findOne({
          where: { codigo, id_dispensador: { [Op.ne]: id } },
          transaction: t
        });
        if (existe) {
          return res.status(400).json({ msg: `El código ${codigo} ya está en uso.` });
        }
        dispensador.codigo = codigo;
      }

      if (id_tanque) {
         const tanque = await Tanque.findByPk(id_tanque, { transaction: t });
         if (!tanque) return res.status(404).json({ msg: "El tanque especificado no existe." });
         dispensador.id_tanque = id_tanque;
      }

      if (nombre) dispensador.nombre = nombre;
      if (estado) dispensador.estado = estado;

      dispensador.fecha_modificacion = new Date();
      await dispensador.save({ transaction: t });

      req.io.emit("dispensador:actualizado", dispensador);

      res.json({ msg: "Dispensador actualizado correctamente", dispensador });
    });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ msg: "Error al actualizar dispensador" });
    }
  }
};

// --- DESACTIVAR DISPENSADOR ---
exports.desactivarDispensador = async (req, res) => {
  const { id } = req.params;
  try {
    await withTransaction(req, async (t) => {
      const dispensador = await Dispensador.findByPk(id, { transaction: t });
      if (!dispensador) return res.status(404).json({ msg: "Dispensador no encontrado" });

      await dispensador.update({ estado: "INACTIVO", fecha_modificacion: new Date() }, { transaction: t });
      req.io.emit("dispensador:actualizado", { id_dispensador: id, estado: "INACTIVO" });
      
      res.json({ msg: "Dispensador desactivado exitosamente" });
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: "Error al desactivar dispensador" });
  }
};

// --- LISTA SIMPLE ---
exports.obtenerListaDispensadores = async (req, res) => {
  try {
    const { id_tanque } = req.query;
    const where = { estado: "ACTIVO" };
    if (id_tanque) where.id_tanque = id_tanque;

    const lista = await Dispensador.findAll({
      where,
      attributes: ["id_dispensador", "codigo", "nombre"],
      include: [{ model: Tanque, as: "Tanque", attributes: ["nombre"] }],
      order: [["codigo", "ASC"]]
    });
    res.json(lista);
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: "Error al listar dispensadores" });
  }
};
