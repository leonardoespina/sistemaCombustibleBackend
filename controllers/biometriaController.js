const Biometria = require("../models/Biometria");
const Categoria = require("../models/Categoria");
const Dependencia = require("../models/Dependencia");
const Subdependencia = require("../models/Subdependencia");
const { paginate } = require("../helpers/paginationHelper");
const { withTransaction } = require("../helpers/transactionHelper");
const { Op } = require("sequelize");
const axios = require("axios");

// ============================================================================
// 🔧 CONFIGURACIÓN SIMPLE - COMENTA/DESCOMENTA SEGÚN NECESITES
// ============================================================================

// 🏠 PARA PRUEBAS LOCALES (descomenta esta línea, comenta la otra)
 //const BIOMETRIC_SERVICE_URL = "http://localhost:7000";

// 🌐 PARA PRODUCCIÓN/RENDER (descomenta esta línea, comenta la otra)
const BIOMETRIC_SERVICE_URL = "https://captura-huellas-microservicio.onrender.com";

// ⚠️ IMPORTANTE: Solo una línea debe estar descomentada a la vez
// ============================================================================

console.log(`✅ Microservicio configurado: ${BIOMETRIC_SERVICE_URL}`);

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
        templates: huellas,
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
    // ✅ URL completa: base + /api/verify
    const response = await axios.post(
      `${BIOMETRIC_SERVICE_URL}/api/verify`,
      {
        probe: muestra1,
        candidate: muestra2
      }, 
      {
        // Timeout diferente según entorno
        timeout: BIOMETRIC_SERVICE_URL.includes("localhost") ? 10000 : 30000,
        headers: { 'Content-Type': 'application/json' }
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error("❌ Error en comparación directa:", error.message);
    
    // Mensaje útil según entorno
    if (BIOMETRIC_SERVICE_URL.includes("localhost")) {
      console.log("💡 ¿Está corriendo el microservicio Java? (puerto 7000)");
    } else {
      console.log("💡 El servicio en Render puede estar en 'cold start' (espere 30-60s)");
    }
    
    res.status(500).json({ 
      msg: "Error en el servicio biométrico",
      detalle: error.message,
      urlUsada: `${BIOMETRIC_SERVICE_URL}/api/verify`
    });
  }
};

// --- VERIFICAR IDENTIDAD (MATCHING 1:1 CONTRA BD) ---
exports.verificarIdentidad = async (req, res) => {
  const { cedula, muestraActual } = req.body; 
  
  console.log("=== INICIO VERIFICACIÓN BIOMÉTRICA ===");
  console.log("🔧 Entorno:", BIOMETRIC_SERVICE_URL.includes("localhost") ? "LOCAL" : "RENDER");
  console.log("🔍 Cédula:", cedula);
  console.log("📏 Longitud muestra:", muestraActual?.length || 0);

  if (!cedula || !muestraActual) {
    return res.status(400).json({ msg: "Cédula y muestra biométrica son requeridas" });
  }

  try {
    const registro = await Biometria.findOne({ 
      where: { cedula, estado: "ACTIVO" }
    });

    if (!registro) {
      console.log("❌ Cédula no encontrada");
      return res.status(404).json({ match: false, msg: "Persona no registrada" });
    }

    const biometricData = JSON.parse(registro.template);
    
    console.log(`🔢 Comparando contra ${biometricData.templates.length} template(s)`);
    
    const matchPromises = biometricData.templates.map(async (templateGuardado, index) => {
      try {
        console.log(`📤 Enviando comparación ${index + 1}...`);
        
        const response = await axios.post(
          `${BIOMETRIC_SERVICE_URL}/api/verify`,
          {
            probe: muestraActual,
            candidate: templateGuardado
          }, 
          {
            // Timeout ajustado según entorno
            timeout: BIOMETRIC_SERVICE_URL.includes("localhost") ? 10000 : 30000,
            headers: { 'Content-Type': 'application/json' }
          }
        );

        const { match, score } = response.data;
        console.log(`✅ Template ${index + 1} - Score: ${score}, Match: ${match}`);
        return score;
      } catch (error) {
        console.error(`❌ Error template ${index + 1}:`, error.message);
        
        // Diagnóstico específico
        if (error.code === 'ECONNREFUSED' && BIOMETRIC_SERVICE_URL.includes("localhost")) {
          console.log("🔥 MICROSERVICIO LOCAL NO DISPONIBLE");
          console.log("   Ejecuta: java -jar target\\biometric-service-1.0-SNAPSHOT.jar");
        }
        
        return 0;
      }
    });

    const scores = await Promise.all(matchPromises);
    const mejorScore = Math.max(...scores);
    const umbral = 40;

    console.log(`🎯 Mejor score: ${mejorScore} (umbral: ${umbral})`);

    if (mejorScore >= umbral) {
      console.log(`✅ MATCH ENCONTRADO!`);
      res.json({ 
        match: true, 
        score: mejorScore, 
        persona: registro,
        entorno: BIOMETRIC_SERVICE_URL.includes("localhost") ? "LOCAL" : "RENDER"
      });
    } else {
      console.log("❌ NO HAY COINCIDENCIA");
      res.status(200).json({ 
        match: false, 
        msg: "La huella no coincide",
        score: mejorScore,
        entorno: BIOMETRIC_SERVICE_URL.includes("localhost") ? "LOCAL" : "RENDER"
      });
    }

  } catch (error) {
    console.error("💥 Error general:", error);
    res.status(500).json({ 
      msg: "Error durante la verificación biométrica",
      detalle: error.message
    });
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

// --- FUNCIÓN PARA VERIFICAR CONEXIÓN (ÚTIL PARA DEBUG) ---
exports.verificarConexionMicroservicio = async (req, res) => {
  try {
    const healthCheck = await axios.get(
      BIOMETRIC_SERVICE_URL.includes("localhost") 
        ? "http://localhost:7000/health" 
        : "https://captura-huellas-microservicio.onrender.com/health",
      { timeout: 5000 }
    );
    
    res.json({
      conectado: healthCheck.data === "OK",
      entorno: BIOMETRIC_SERVICE_URL.includes("localhost") ? "LOCAL" : "RENDER",
      urlBase: BIOMETRIC_SERVICE_URL,
      healthCheck: healthCheck.data,
      mensaje: "✅ Microservicio disponible"
    });
  } catch (error) {
    res.status(503).json({
      conectado: false,
      entorno: BIOMETRIC_SERVICE_URL.includes("localhost") ? "LOCAL" : "RENDER",
      urlBase: BIOMETRIC_SERVICE_URL,
      error: error.message,
      mensaje: BIOMETRIC_SERVICE_URL.includes("localhost") 
        ? "❌ Microservicio local no responde. Ejecuta: java -jar target\\biometric-service-1.0-SNAPSHOT.jar"
        : "❌ Microservicio en Render no disponible. Puede estar en 'cold start'."
    });
  }
};