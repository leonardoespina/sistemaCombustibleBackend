const { Tanque, Llenadero, TipoCombustible } = require("../models");
const { paginate } = require("../helpers/paginationHelper");
const { withTransaction } = require("../helpers/transactionHelper");
const { Op } = require("sequelize");

// --- CREAR TANQUE (Solo Admin) ---
exports.crearTanque = async (req, res) => {
  const {
    id_llenadero,
    codigo,
    nombre,
    id_tipo_combustible,
    tipo_tanque,
    capacidad_maxima,
    nivel_alarma_bajo,
    nivel_alarma_alto,
    unidad_medida,
    alto,
    radio,
    largo,
    ancho,
    con_aforo,
    aforo,
  } = req.body;

  try {
    await withTransaction(req, async (t) => {
      // 1. Validaciones de Integridad
      const [llenadero, combustible] = await Promise.all([
        Llenadero.findByPk(id_llenadero, { transaction: t }),
        TipoCombustible.findByPk(id_tipo_combustible, { transaction: t }),
      ]);

      if (!llenadero) return res.status(404).json({ msg: "El llenadero especificado no existe" });
      if (!combustible) return res.status(404).json({ msg: "El tipo de combustible no es válido" });

      // 2. Validar duplicado de código
      const tanqueExistente = await Tanque.findOne({ where: { codigo }, transaction: t });
      if (tanqueExistente) {
        return res.status(400).json({ msg: `El código ${codigo} ya está registrado.` });
      }

      // 3. Crear registro
      const tanque = await Tanque.create(
        {
          id_llenadero,
          codigo,
          nombre,
          id_tipo_combustible,
          tipo_tanque,
          capacidad_maxima: capacidad_maxima || 0,
          nivel_actual: 0,
          nivel_alarma_bajo,
          nivel_alarma_alto,
          unidad_medida: unidad_medida || "CM",
          alto,
          radio,
          largo,
          ancho,
          estado: "ACTIVO",
          con_aforo: !!con_aforo,
          aforo: aforo || [],
        },
        { transaction: t }
      );

      req.io.emit("tanque:creado", tanque);
      res.status(201).json({ msg: "Tanque registrado exitosamente", tanque });
    });
  } catch (error) {
    console.error("Error al crear tanque:", error);
    if (!res.headersSent) res.status(500).json({ msg: "Error interno al registrar el tanque" });
  }
};

// --- OBTENER TANQUES (Paginado + Filtros) ---
exports.obtenerTanques = async (req, res) => {
  try {
    const { id_llenadero, id_tipo_combustible, estado, tipo_tanque, con_aforo } = req.query;

    const searchableFields = ["codigo", "nombre"];
    const where = {};

    if (id_llenadero) where.id_llenadero = id_llenadero;
    if (id_tipo_combustible) where.id_tipo_combustible = id_tipo_combustible;
    if (estado) where.estado = estado;
    if (tipo_tanque) where.tipo_tanque = tipo_tanque;
    if (con_aforo !== undefined) where.con_aforo = con_aforo === "true";

    const result = await paginate(Tanque, req.query, {
      where,
      searchableFields,
      include: [
        { model: Llenadero, as: "Llenadero", attributes: ["nombre_llenadero"] },
        { model: TipoCombustible, as: "TipoCombustible", attributes: ["nombre"] },
      ],
      order: [["id_tanque", "DESC"]]
    });

    res.json(result);
  } catch (error) {
    console.error("Error al obtener tanques:", error);
    res.status(500).json({ msg: "Error al obtener el listado de tanques" });
  }
};

// --- ACTUALIZAR TANQUE (Solo Admin) ---
exports.actualizarTanque = async (req, res) => {
  const { id } = req.params;
  const campos = req.body;

  try {
    await withTransaction(req, async (t) => {
      const tanque = await Tanque.findByPk(id, { transaction: t });
      if (!tanque) return res.status(404).json({ msg: "Tanque no encontrado" });

      // 1. Validar código duplicado
      if (campos.codigo && campos.codigo !== tanque.codigo) {
        const existe = await Tanque.findOne({
          where: { codigo: campos.codigo, id_tanque: { [Op.ne]: id } },
          transaction: t,
        });
        if (existe) return res.status(400).json({ msg: "El nuevo código ya está en uso" });
      }

      // 2. Validar Relaciones si cambian
      if (campos.id_llenadero) {
        const existeLlenadero = await Llenadero.findByPk(campos.id_llenadero, { transaction: t });
        if (!existeLlenadero) return res.status(404).json({ msg: "Llenadero no válido" });
      }
      if (campos.id_tipo_combustible) {
        const existeCombustible = await TipoCombustible.findByPk(campos.id_tipo_combustible, { transaction: t });
        if (!existeCombustible) return res.status(404).json({ msg: "Tipo de combustible no válido" });
      }

      // 3. Actualizar registro
      await tanque.update(campos, { transaction: t });

      req.io.emit("tanque:actualizado", tanque);
      res.json({ msg: "Tanque actualizado correctamente", tanque });
    });
  } catch (error) {
    console.error("Error al actualizar tanque:", error);
    if (!res.headersSent) res.status(500).json({ msg: "Error al modificar los datos del tanque" });
  }
};

// --- DESACTIVAR / CAMBIAR ESTADO (Soft Delete) ---
exports.eliminarTanque = async (req, res) => {
  const { id } = req.params;
  try {
    await withTransaction(req, async (t) => {
      const tanque = await Tanque.findByPk(id, { transaction: t });
      if (!tanque) return res.status(404).json({ msg: "Tanque no encontrado" });

      await tanque.update({ estado: "INACTIVO" }, { transaction: t });
      
      req.io.emit("tanque:actualizado", { id_tanque: id, estado: "INACTIVO" });
      res.json({ msg: "Tanque desactivado exitosamente" });
    });
  } catch (error) {
    res.status(500).json({ msg: "Error al desactivar el recurso" });
  }
};

// --- LISTA SIMPLE ---
exports.obtenerListaTanques = async (req, res) => {
  try {
    const { id_llenadero, id_tipo_combustible } = req.query;
    const where = { estado: "ACTIVO" };
    
    if (id_llenadero) where.id_llenadero = id_llenadero;
    if (id_tipo_combustible) where.id_tipo_combustible = id_tipo_combustible;

    const tanques = await Tanque.findAll({
      where,
      attributes: ["id_tanque", "codigo", "nombre", "capacidad_maxima", "nivel_actual", "tipo_tanque", "con_aforo"],
      include: [
        { model: TipoCombustible, as: "TipoCombustible", attributes: ["nombre"] },
      ],
      order: [["nombre", "ASC"]],
    });
    res.json(tanques);
  } catch (error) {
    res.status(500).json({ msg: "Error al obtener lista de tanques" });
  }
};
