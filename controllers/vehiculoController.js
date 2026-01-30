const {
  Vehiculo,
  Marca,
  Modelo,
  Categoria,
  Dependencia,
  Subdependencia,
  TipoCombustible,
} = require("../models");
const VehiculoSinPlaca = require("../models/VehiculoSinPlaca");
const { paginate } = require("../helpers/paginationHelper");
const { withTransaction } = require("../helpers/transactionHelper");
const { Op } = require("sequelize");

// --- CREAR VEHÍCULO (Solo Admin) ---
exports.crearVehiculo = async (req, res) => {
  const {
    placa,
    es_sin_placa,
    id_marca,
    id_modelo,
    id_categoria,
    id_dependencia,
    id_subdependencia,
    es_generador,
    id_tipo_combustible,
  } = req.body;

  try {
    await withTransaction(req, async (t) => {
      let placaFinal = placa;

      // Si es vehículo sin placa, generar el correlativo
      if (es_sin_placa) {
        const registro = await VehiculoSinPlaca.findByPk(1, { transaction: t });
        
        const siguienteCorrelativo = registro ? registro.ultimo_correlativo + 1 : 54;
        
        if (!registro) {
          // Crear registro inicial
          await VehiculoSinPlaca.create({
            id: 1,
            ultimo_correlativo: siguienteCorrelativo,
            prefijo: "SPMB"
          }, { transaction: t });
        } else {
          // Incrementar el correlativo
          await registro.update({
            ultimo_correlativo: siguienteCorrelativo,
            fecha_actualizacion: new Date()
          }, { transaction: t });
        }

        placaFinal = `SPMB${String(siguienteCorrelativo).padStart(4, '0')}`;
      }

      // 1. Validar duplicado de placa
      const vehiculoExistente = await Vehiculo.findOne({
        where: { placa: placaFinal },
        transaction: t,
      });
      if (vehiculoExistente) {
        return res
          .status(400)
          .json({ msg: `La placa/código ${placaFinal} ya está registrada.` });
      }

      // 2. Validar consistencia Modelo/Marca
      const modelo = await Modelo.findOne({
        where: { id_modelo, id_marca },
        transaction: t,
      });
      if (!modelo) {
        return res.status(400).json({
          msg: "El modelo seleccionado no pertenece a la marca indicada",
        });
      }

      // 3. Validar Tipo de Combustible
      const combustible = await TipoCombustible.findByPk(id_tipo_combustible, { transaction: t });
      if (!combustible) {
        return res.status(400).json({ msg: "El tipo de combustible no es válido" });
      }

      // 4. Crear con Auditoría
      const vehiculo = await Vehiculo.create(
        {
          placa: placaFinal,
          id_marca,
          id_modelo,
          id_categoria, // Requerido por modelo
          id_dependencia, // Requerido por modelo
          id_subdependencia: id_subdependencia || null, // Opcional
          id_tipo_combustible,
          es_generador: es_generador || false,
          registrado_por: req.usuario.id_usuario,
          fecha_registro: new Date(),
          fecha_modificacion: new Date(),
          estado: "ACTIVO",
        },
        { transaction: t }
      );

      // Notificar vía socket
      req.io.emit("vehiculo:creado", vehiculo);

      res.status(201).json({ 
        msg: "Vehículo registrado exitosamente", 
        vehiculo,
        ...(es_sin_placa && { placaGenerada: placaFinal })
      });
    });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ msg: "Error al registrar vehículo" });
    }
  }
};

// --- OBTENER VEHÍCULOS (Paginado + Filtros) ---
exports.obtenerVehiculos = async (req, res) => {
  try {
    const {
      id_categoria,
      id_dependencia,
      id_subdependencia,
      id_tipo_combustible,
      es_generador,
      estado,
    } = req.query;

    const searchableFields = ["placa", "color"];
    const where = {};

    if (id_categoria) where.id_categoria = id_categoria;
    if (id_dependencia) where.id_dependencia = id_dependencia;
    if (id_subdependencia) where.id_subdependencia = id_subdependencia;
    if (id_tipo_combustible) where.id_tipo_combustible = id_tipo_combustible;
    if (es_generador !== undefined) where.es_generador = es_generador === "true";

    if (req.usuario.tipo_usuario !== "ADMIN") {
      where.estado = "ACTIVO";
    } else if (estado) {
      where.estado = estado;
    }

    const result = await paginate(Vehiculo, req.query, {
      where,
      searchableFields,
      include: [
        { model: Marca, as: "Marca", attributes: ["nombre"] },
        { model: Modelo, as: "Modelo", attributes: ["nombre"] },
        { model: Categoria, as: "Categoria", attributes: ["nombre"] },
        { model: Dependencia, as: "Dependencia", attributes: ["nombre_dependencia"] },
        { model: Subdependencia, as: "Subdependencia", attributes: ["nombre"] },
        { model: TipoCombustible, as: "TipoCombustible", attributes: ["nombre"] },
      ],
    });

    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: "Error al obtener vehículos" });
  }
};

// --- ACTUALIZAR VEHÍCULO ---
exports.actualizarVehiculo = async (req, res) => {
  const { id } = req.params;
  const {
    placa,
    
    id_marca,
    id_modelo,
    id_categoria,
    id_dependencia,
    id_subdependencia,
    es_generador,
    id_tipo_combustible,
    estado,
  } = req.body;

  try {
    await withTransaction(req, async (t) => {
      const vehiculo = await Vehiculo.findByPk(id, { transaction: t });
      if (!vehiculo) {
        return res.status(404).json({ msg: "Vehículo no encontrado" });
      }

      // Validar placa duplicada
      if (placa && placa !== vehiculo.placa) {
        const existe = await Vehiculo.findOne({
          where: { placa, id_vehiculo: { [Op.ne]: id } },
          transaction: t,
        });
        if (existe) {
          return res.status(400).json({ msg: "La placa ya está registrada en otro vehículo" });
        }
        vehiculo.placa = placa;
      }

      // Validar Marca/Modelo
      if (id_marca || id_modelo) {
        const checkMarca = id_marca || vehiculo.id_marca;
        const checkModelo = id_modelo || vehiculo.id_modelo;
        const modeloValido = await Modelo.findOne({
          where: { id_modelo: checkModelo, id_marca: checkMarca },
          transaction: t,
        });
        if (!modeloValido) {
          return res.status(400).json({ msg: "El modelo no coincide con la marca" });
        }
        vehiculo.id_marca = checkMarca;
        vehiculo.id_modelo = checkModelo;
      }

      // Validar Tipo Combustible
      if (id_tipo_combustible) {
        const combustible = await TipoCombustible.findByPk(id_tipo_combustible, { transaction: t });
        if (!combustible) {
          return res.status(400).json({ msg: "Tipo de combustible inválido" });
        }
        vehiculo.id_tipo_combustible = id_tipo_combustible;
      }

      // Actualizar campos
      
      if (id_categoria) vehiculo.id_categoria = id_categoria;
      if (id_dependencia) vehiculo.id_dependencia = id_dependencia;
      
      // Permitir setear subdependencia como null explícitamente
      if (id_subdependencia !== undefined) vehiculo.id_subdependencia = id_subdependencia;
      
      if (es_generador !== undefined) vehiculo.es_generador = es_generador;
      if (estado) vehiculo.estado = estado;

      vehiculo.fecha_modificacion = new Date();
      await vehiculo.save({ transaction: t });

      req.io.emit("vehiculo:actualizado", vehiculo);
      res.json({ msg: "Vehículo actualizado correctamente", vehiculo });
    });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ msg: "Error al actualizar vehículo" });
    }
  }
};

// --- DESACTIVAR VEHÍCULO (Solo Admin) ---
exports.desactivarVehiculo = async (req, res) => {
  const { id } = req.params;
  try {
    await withTransaction(req, async (t) => {
      const vehiculo = await Vehiculo.findByPk(id, { transaction: t });
      if (!vehiculo) return res.status(404).json({ msg: "Vehículo no encontrado" });

      await vehiculo.update({ estado: "INACTIVO", fecha_modificacion: new Date() }, { transaction: t });
      req.io.emit("vehiculo:actualizado", { id_vehiculo: id, estado: "INACTIVO" });
      res.json({ msg: "Vehículo desactivado exitosamente" });
    });
  } catch (error) {
    res.status(500).json({ msg: "Error al desactivar" });
  }
};

// --- LISTA SIMPLE (Para selectores) ---
exports.obtenerListaVehiculos = async (req, res) => {
  try {
    const { es_generador, id_categoria, id_dependencia } = req.query;
    const where = { estado: "ACTIVO" };

    if (es_generador !== undefined) where.es_generador = es_generador === "true";
    if (id_categoria) where.id_categoria = id_categoria;
    if (id_dependencia) where.id_dependencia = id_dependencia;

    const vehiculos = await Vehiculo.findAll({
      where,
      // attributes: ["id_vehiculo", "placa", ...], // Comentado para traer todo y evitar errores de columnas faltantes en definición manual
      include: [
        { model: Marca, as: "Marca", attributes: ["nombre"] },
        { model: Modelo, as: "Modelo", attributes: ["nombre"] },
        { model: TipoCombustible, as: "TipoCombustible", attributes: ["nombre"] },
      ],
      order: [["placa", "ASC"]],
    });
    res.json(vehiculos);
  } catch (error) {
    res.status(500).json({ msg: "Error al listar vehículos" });
  }
};

// --- MODELOS POR MARCA ---
exports.obtenerModelosPorMarca = async (req, res) => {
  const { id_marca } = req.params;
  try {
    const modelos = await Modelo.findAll({
      where: { id_marca, estado: "ACTIVO" },
      attributes: ["id_modelo", "nombre"],
      order: [["nombre", "ASC"]],
    });
    res.json(modelos);
  } catch (error) {
    res.status(500).json({ msg: "Error al obtener modelos" });
  }
};
