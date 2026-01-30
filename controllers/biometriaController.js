const Biometria = require("../models/Biometria");
const Categoria = require("../models/Categoria");
const Dependencia = require("../models/Dependencia");
const Subdependencia = require("../models/Subdependencia");
const { paginate } = require("../helpers/paginationHelper");
const { withTransaction } = require("../helpers/transactionHelper");
const { Op } = require("sequelize");
const axios = require("axios");

// URL del microservicio de verificación biométrica
const BIOMETRIC_SERVICE_URL = "http://localhost:7000/api/verify";

/**
 * Servicio de Biometría
 * Maneja el registro y la verificación (matching) de huellas dactilares.
 */

// --- REGISTRAR BIOMETRÍA ---
exports.registrarBiometria = async (req, res) => {
  const { cedula, nombre, rol, id_categoria, id_dependencia, id_subdependencia, huellas } = req.body;

  try {
    await withTransaction(req, async (t) => {
      // 1. Verificar si ya existe el registro
      let registro = await Biometria.findOne({ where: { cedula }, transaction: t });
      
      const biometricData = JSON.stringify({
        templates: huellas, // Array de strings Base64 (FMDs)
        updatedAt: new Date().toISOString()
      });

      if (registro) {
        await registro.update({
          nombre,
          rol,
          id_categoria,
          id_dependencia,
          id_subdependencia,
          template: biometricData,
          fecha_modificacion: new Date()
        }, { transaction: t });
      } else {
        registro = await Biometria.create({
          cedula,
          nombre,
          rol,
          id_categoria,
          id_dependencia,
          id_subdependencia,
          template: biometricData
        }, { transaction: t });
      }

      req.io.emit("biometria:actualizado", registro);

      res.status(201).json({
        msg: "Identidad biométrica sincronizada correctamente",
        registro
      });
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: "Error al procesar registro biométrico" });
  }
};

// --- COMPARAR DOS HUELLAS (PARA VALIDACIÓN EN REGISTRO) ---
exports.compararHuellas = async (req, res) => {
  const { muestra1, muestra2 } = req.body;

  if (!muestra1 || !muestra2) {
    return res.status(400).json({ msg: "Se requieren ambas muestras para comparar" });
  }

  try {
    const response = await axios.post(BIOMETRIC_SERVICE_URL, {
      probe: muestra1,
      candidate: muestra2
    }, {
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' }
    });

    res.json(response.data);
  } catch (error) {
    console.error("Error en comparación directa:", error.message);
    res.status(500).json({ msg: "Error en el servicio biométrico" });
  }
};

// --- VERIFICAR IDENTIDAD (MATCHING 1:1 CONTRA BD) ---
exports.verificarIdentidad = async (req, res) => {
  const { cedula, muestraActual } = req.body; 
  
  console.log("=== INICIO VERIFICACIÓN BIOMÉTRICA ===");
  console.log("Cédula buscada:", cedula);
  console.log("Longitud muestra recibida:", muestraActual?.length);

  if (!cedula || !muestraActual) {
    return res.status(400).json({ msg: "Cédula y muestra biométrica son requeridas" });
  }

  try {
    const registro = await Biometria.findOne({ 
      where: { cedula, estado: "ACTIVO" }
    });

    if (!registro) {
      console.log("Resultado: Cédula no encontrada en biometría");
      return res.status(404).json({ match: false, msg: "Persona no registrada" });
    }

    const biometricData = JSON.parse(registro.template);
    
    // --- LÓGICA DE MATCHING CON MICROSERVICIO JAVA (SOURCEAFIS) ---
    console.log(`Comparando contra ${biometricData.templates.length} template(s) almacenado(s)`);
    
    const matchPromises = biometricData.templates.map(async (templateGuardado, index) => {
      try {
        console.log(`Enviando comparación ${index + 1} al microservicio...`);
        
        const response = await axios.post(BIOMETRIC_SERVICE_URL, {
          probe: muestraActual,
          candidate: templateGuardado
        }, {
          timeout: 10000, // 10 segundos de timeout
          headers: { 'Content-Type': 'application/json' }
        });

        const { match, score } = response.data;
        console.log(`Template ${index + 1} - Score: ${score}, Match: ${match}`);
        return score;
      } catch (error) {
        console.error(`Error al comparar template ${index + 1}:`, error.message);
        if (error.code === 'ECONNREFUSED') {
          throw new Error('Microservicio biométrico no disponible. Verifica que esté corriendo en puerto 7000.');
        }
        return 0; // Si falla la comparación, retorna 0
      }
    });

    const scores = await Promise.all(matchPromises);
    const mejorScore = Math.max(...scores);
    const umbral = 40; // Umbral estándar de SourceAFIS para alta confianza

    if (mejorScore >= umbral) {
      console.log(`MATCH ENCONTRADO! Score: ${mejorScore}`);
      res.json({ match: true, score: mejorScore, persona: registro });
    } else {
      console.log("NO SE ENCONTRÓ COINCIDENCIA");
      res.status(200).json({ match: false, msg: "La huella no coincide" });
    }

  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: "Error durante la verificación biométrica" });
  }
};

// --- OBTENER REGISTROS (CRUD) ---
exports.obtenerRegistros = async (req, res) => {
  try {
    const searchableFields = ["nombre", "cedula"];
    const where = { estado: "ACTIVO" };

    const results = await paginate(Biometria, req.query, {
      where,
      searchableFields,
      include: [
        { model: Categoria, as: "Categoria", attributes: ["nombre"] },
        { model: Dependencia, as: "Dependencia", attributes: ["nombre_dependencia"] },
        { model: Subdependencia, as: "Subdependencia", attributes: ["nombre"] },
      ]
    });

    res.json(results);
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: "Error al obtener listado biométrico" });
  }
};

// --- ELIMINAR REGISTRO ---
exports.eliminarRegistro = async (req, res) => {
  const { id } = req.params;
  try {
    const registro = await Biometria.findByPk(id);
    if (!registro) return res.status(404).json({ msg: "Registro no encontrado" });

    await registro.update({ estado: "INACTIVO", fecha_modificacion: new Date() });
    
    req.io.emit("biometria:actualizado", { id_biometria: id, estado: "INACTIVO" });
    res.json({ msg: "Registro biométrico desactivado" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: "Error al desactivar registro" });
  }
};
