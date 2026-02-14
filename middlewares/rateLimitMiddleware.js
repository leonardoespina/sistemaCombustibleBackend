const rateLimit = require('express-rate-limit');

// ============================================================
// RATE LIMITER PARA LOGIN (MUY RESTRICTIVO)
// ============================================================
// Previene ataques de fuerza bruta en el endpoint de autenticación
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5, // Máximo 5 intentos por ventana
  skipSuccessfulRequests: true, // No contar logins exitosos en el límite
  message: {
    msg: 'Demasiados intentos de inicio de sesión. Por favor, intente nuevamente en 15 minutos.',
    tipo: 'RATE_LIMIT_LOGIN'
  },
  // Rastrear por IP + cédula para evitar ataques distribuidos
  // Nota: No usar keyGenerator personalizado con req.ip directamente por IPv6
  // En su lugar, usar solo por IP (express-rate-limit maneja IPv6 automáticamente)
  standardHeaders: true, // Retorna headers RateLimit-* (draft-6)
  legacyHeaders: false, // Deshabilita X-RateLimit-* headers
  handler: (req, res) => {
    console.log(`⚠️ Rate limit excedido en LOGIN - IP: ${req.ip}, Cédula: ${req.body.cedula || 'N/A'}`);
    res.status(429).json({
      msg: 'Demasiados intentos de inicio de sesión. Por favor, intente nuevamente en 15 minutos.',
      tipo: 'RATE_LIMIT_LOGIN',
      retry_after: Math.ceil(req.rateLimit.resetTime / 1000)
    });
  }
});

// ============================================================
// RATE LIMITER PARA APIs GENERALES (MODERADO)
// ============================================================
// Protege toda la API contra uso excesivo
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 100, // 100 requests por minuto por IP
  message: {
    msg: 'Demasiadas peticiones desde esta dirección. Intente nuevamente más tarde.',
    tipo: 'RATE_LIMIT_API'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.log(`⚠️ Rate limit excedido en API - IP: ${req.ip}, Ruta: ${req.path}`);
    res.status(429).json({
      msg: 'Demasiadas peticiones desde esta dirección. Intente nuevamente más tarde.',
      tipo: 'RATE_LIMIT_API'
    });
  }
});

// ============================================================
// RATE LIMITER PARA OPERACIONES CRÍTICAS (RESTRICTIVO)
// ============================================================
// Para operaciones que afectan cupos, inventarios, aprobaciones
const criticalLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutos
  max: 20, // 20 operaciones cada 5 minutos
  message: {
    msg: 'Ha excedido el límite de operaciones críticas. Intente en unos minutos.',
    tipo: 'RATE_LIMIT_CRITICAL'
  },
  // Por defecto usa req.ip (maneja IPv6 automáticamente)
  // Si deseas rastrear por usuario, considerar usar Redis store
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    const userId = req.usuario?.id_usuario || 'Anónimo';
    console.log(`⚠️ Rate limit excedido en OPERACIÓN CRÍTICA - Usuario: ${userId}, IP: ${req.ip}, Ruta: ${req.path}`);
    res.status(429).json({
      msg: 'Ha excedido el límite de operaciones críticas. Intente en unos minutos.',
      tipo: 'RATE_LIMIT_CRITICAL'
    });
  }
});

// ============================================================
// RATE LIMITER PARA CREACIÓN DE RECURSOS (MODERADO-RESTRICTIVO)
// ============================================================
// Para prevenir spam en creación de usuarios, vehículos, etc.
const creationLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutos
  max: 30, // 30 creaciones cada 10 minutos
  message: {
    msg: 'Ha alcanzado el límite de creación de recursos. Intente más tarde.',
    tipo: 'RATE_LIMIT_CREATION'
  },
  // Por defecto usa req.ip (maneja IPv6 automáticamente)
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    const userId = req.usuario?.id_usuario || 'Anónimo';
    console.log(`⚠️ Rate limit excedido en CREACIÓN - Usuario: ${userId}, IP: ${req.ip}, Ruta: ${req.path}`);
    res.status(429).json({
      msg: 'Ha alcanzado el límite de creación de recursos. Intente más tarde.',
      tipo: 'RATE_LIMIT_CREATION'
    });
  }
});

module.exports = {
  loginLimiter,
  apiLimiter,
  criticalLimiter,
  creationLimiter
};

