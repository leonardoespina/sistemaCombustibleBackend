const Subdependencia = require("../models/Subdependencia");
const Dependencia = require("../models/Dependencia");
const { paginate } = require("../helpers/paginationHelper");
const { withTransaction } = require("../helpers/transactionHelper");
const { Op } = require("sequelize");

exports.crearSubdependencia = async (req, res) => {
  const { nombre, estatus, id_dependencia, ubicacion, responsable, cedula_rif, cobra_venta } = req.body;
  try {
    await withTransaction(req, async (t) => {

      const dependencia = await Dependencia.findByPk(id_dependencia, { transaction: t });
      if (!dependencia) {
        return res.status(404).json({ msg: "Dependencia no encontrada" });
      }

      // Validar campos adicionales según el tipo de venta
      const camposValidacion = {
        ubicacion: ubicacion,
        responsable: responsable,
        cedula_rif: cedula_rif
      };

      const mensajesError = {
        ubicacion: "La ubicación",
        responsable: "El responsable",
        cedula_rif: "La cédula/RIF"
      };

      // Definir reglas de validación por tipo de venta
      const reglasValidacion = {
        VENTA: { obligatorios: true, opcionales: false },
        AMBOS: { obligatorios: false, opcionales: true },
        INSTITUCIONAL: { obligatorios: false, opcionales: false }
      };

      const regla = reglasValidacion[dependencia.tipo_venta] || reglasValidacion.INSTITUCIONAL;

      // Validar campos según la regla correspondiente
      for (const [campo, valor] of Object.entries(camposValidacion)) {
        const esCampoVacio = !valor || valor.trim() === "";
        
        if (regla.obligatorios && esCampoVacio) {
          return res.status(400).json({ 
            msg: `${mensajesError[campo]} es obligatorio para tipo de venta ${dependencia.tipo_venta}` 
          });
        }
        
        if (regla.opcionales && valor && esCampoVacio) {
          return res.status(400).json({ 
            msg: `${mensajesError[campo]} no puede estar vacío` 
          });
        }
      }
      // Para tipo INSTITUCIONAL, los campos se omiten (se establecen como null)

      // Verificar si ya existe una subdependencia con el mismo nombre
      const existe = await Subdependencia.findOne({ where: { nombre }, transaction: t });
      if (existe) {
        return res.status(400).json({ msg: "La subdependencia ya existe con ese nombre" });
      }

      // Determinar si se debe cobrar la venta según el tipo de venta de la dependencia
      let debeCobrar = false;
      if (dependencia.tipo_venta === "VENTA") {
        debeCobrar = true;
      } else if (dependencia.tipo_venta === "AMBOS") {
        debeCobrar = cobra_venta === true;
      }
      // Para INSTITUCIONAL, debeCobrar permanece false

      const subdependencia = await Subdependencia.create({
        nombre,
        estatus: estatus || "ACTIVO",
        id_dependencia,
        ubicacion: ubicacion || null,
        responsable: responsable || null,
        cedula_rif: cedula_rif || null,
        cobra_venta: debeCobrar,
        fecha_registro: new Date(),
        fecha_modificacion: new Date(),
      }, { transaction: t });

      req.io.emit("subdependencia:creado", subdependencia);
      res.status(201).json({ msg: "Subdependencia creada exitosamente", subdependencia });
    });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.status(500).json({ msg: "Error al crear subdependencia" });
  }
};

exports.obtenerSubdependencias = async (req, res) => {
  try {
    const searchableFields = ["nombre"];
    const include = [{ model: Dependencia, as: 'Dependencia', attributes: ["nombre_dependencia"] }];
    
    const where = {};
    if (!req.usuario || req.usuario.tipo_usuario !== 'ADMIN') {
      where.estatus = 'ACTIVO';
    }

    const paginatedResults = await paginate(Subdependencia, req.query, {
      searchableFields,
      include,
      where
    });
    res.json(paginatedResults);
  } catch (error) {
     console.error(error);
     res.status(500).json({ msg: "Error al obtener subdependencias" });
  }
};

exports.actualizarSubdependencia = async (req, res) => {
    const { id } = req.params;
    const { nombre, estatus, id_dependencia, ubicacion, responsable, cedula_rif, cobra_venta } = req.body;
    try {
        await withTransaction(req, async (t) => {
            const subdependencia = await Subdependencia.findByPk(id, { transaction: t });
            if (!subdependencia) return res.status(404).json({ msg: "Subdependencia no encontrada" });

            if(id_dependencia){
              const dependencia = await Dependencia.findByPk(id_dependencia, { transaction: t });
              if (!dependencia) {
                return res.status(404).json({ msg: "Dependencia no encontrada" });
              }
              subdependencia.id_dependencia = id_dependencia;
              
              // Validar campos adicionales según el tipo de venta
              const camposValidacion = {
                ubicacion: ubicacion,
                responsable: responsable,
                cedula_rif: cedula_rif
              };

              const mensajesError = {
                ubicacion: "La ubicación",
                responsable: "El responsable",
                cedula_rif: "La cédula/RIF"
              };

              // Definir reglas de validación por tipo de venta
              const reglasValidacion = {
                VENTA: { obligatorios: true, opcionales: false },
                AMBOS: { obligatorios: false, opcionales: true },
                INSTITUCIONAL: { obligatorios: false, opcionales: false }
              };

              const regla = reglasValidacion[dependencia.tipo_venta] || reglasValidacion.INSTITUCIONAL;

              // Validar campos según la regla correspondiente
              for (const [campo, valor] of Object.entries(camposValidacion)) {
                const esCampoVacio = !valor || valor.trim() === "";
                
                if (regla.obligatorios && esCampoVacio) {
                  return res.status(400).json({ 
                    msg: `${mensajesError[campo]} es obligatorio para tipo de venta ${dependencia.tipo_venta}` 
                  });
                }
                
                if (regla.opcionales && valor && esCampoVacio) {
                  return res.status(400).json({ 
                    msg: `${mensajesError[campo]} no puede estar vacío` 
                  });
                }
              }
              // Para tipo INSTITUCIONAL, los campos se omiten (se establecen como null)
              
              // Actualizar bandera de cobro según el tipo de venta
              if (dependencia.tipo_venta === "VENTA") {
                subdependencia.cobra_venta = true;
              } else if (dependencia.tipo_venta === "AMBOS") {
                subdependencia.cobra_venta = cobra_venta === true;
              } else {
                // INSTITUCIONAL
                subdependencia.cobra_venta = false;
              }
            }

            // Validar que el nombre no se repita
            if (nombre && nombre !== subdependencia.nombre) {
                const existe = await Subdependencia.findOne({
                    where: {
                        nombre,
                        id_subdependencia: { [Op.ne]: id }
                    },
                    transaction: t
                });
                if (existe) {
                    return res.status(400).json({ msg: "La subdependencia ya existe con ese nombre" });
                }
                subdependencia.nombre = nombre;
            }

            if (ubicacion !== undefined) subdependencia.ubicacion = ubicacion;
            if (responsable !== undefined) subdependencia.responsable = responsable;
            if (cedula_rif !== undefined) subdependencia.cedula_rif = cedula_rif;
            if (estatus) subdependencia.estatus = estatus;
            subdependencia.fecha_modificacion = new Date();
            
            await subdependencia.save({ transaction: t });
            req.io.emit("subdependencia:actualizado", subdependencia);
            res.json({ msg: "Subdependencia actualizada", subdependencia });
        });
    } catch (error) {
        console.error(error);
        if (!res.headersSent) res.status(500).json({ msg: "Error al actualizar subdependencia" });
    }
};

exports.desactivarSubdependencia = async (req, res) => {
    const { id } = req.params;
    try {
        await withTransaction(req, async (t) => {
             const subdependencia = await Subdependencia.findByPk(id, { transaction: t });
             if (!subdependencia) return res.status(404).json({ msg: "Subdependencia no encontrada" });
             
             await subdependencia.update({ estatus: "INACTIVO", fecha_modificacion: new Date() }, { transaction: t });
             
             req.io.emit("subdependencia:actualizado", subdependencia);
             res.json({ msg: "Subdependencia desactivada" });
        });
    } catch (error) {
        console.error(error);
        if (!res.headersSent) res.status(500).json({ msg: "Error al desactivar" });
    }
};
