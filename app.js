// app.js (CORREGIDO)

const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const { dbConnect } = require("./config/database");
require("dotenv").config();

// ============================================================
// 1. CARGAR MODELOS Y ASOCIACIONES (Carga Dinámica)
// ============================================================
const db = require("./models");

const app = express();
const server = http.createServer(app);

// ============================================================
// 2. CONFIGURACIÓN DEL SERVIDOR
// ============================================================
// Obtener orígenes permitidos desde el .env (separados por coma)
const whitelist = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",")
  : ["http://localhost:5173"];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (whitelist.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error("No permitido por CORS"));
    }
  },
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  credentials: true,
};

// Configuración Socket.io
const io = new Server(server, {
  cors: {
    origin: whitelist,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    credentials: true,
  },
});

// Control de sockets activos por usuario para evitar liberaciones prematuras
const activeSockets = new Map(); // id_usuario -> Set(socket_id)
io.activeSockets = activeSockets; // Exponerlo para los controladores

io.on("connection", (socket) => {
  console.log("Cliente conectado a Socket.io:", socket.id);

  socket.on("usuario:identificar", (id_usuario) => {
    socket.id_usuario = id_usuario;
    socket.join(`usuario_${id_usuario}`);

    // Registrar el socket para este usuario
    if (!activeSockets.has(id_usuario)) {
      activeSockets.set(id_usuario, new Set());
    }
    activeSockets.get(id_usuario).add(socket.id);

    console.log(
      `Usuario ${id_usuario} conectado. Sockets activos: ${activeSockets.get(id_usuario).size}`,
    );
  });

  socket.on("disconnect", async () => {
    const id_usuario = socket.id_usuario;
    if (!id_usuario) return;

    console.log(`Socket ${socket.id} desconectado (Usuario: ${id_usuario})`);

    // Eliminar este socket del registro
    if (activeSockets.has(id_usuario)) {
      const userSockets = activeSockets.get(id_usuario);
      userSockets.delete(socket.id);

      // Si ya no quedan sockets abiertos para este usuario...
      if (userSockets.size === 0) {
        activeSockets.delete(id_usuario);

        // Esperamos un breve periodo (ej: 10 seg) antes de liberar la sesión en BD
        // Esto evita expulsiones por recargas de página o parpadeos de internet
        setTimeout(async () => {
          // Verificamos si en este tiempo el usuario no volvió a conectar
          if (!activeSockets.has(id_usuario)) {
            try {
              const { Usuario } = require("./models");
              // Solo liberamos si no hay nuevas conexiones
              await Usuario.update(
                { id_sesion: null },
                { where: { id_usuario: id_usuario } },
              );
              console.log(
                `Sesión del usuario ${id_usuario} liberada tras periodo de gracia.`,
              );
            } catch (error) {
              console.error("Error al liberar sesión diferida:", error);
            }
          }
        }, 10000);
      }
    }
  });
});

// Conexión BD e Inicialización del Servidor
dbConnect()
  .then(() => {
    // Inicializar Cron Jobs después de que la BD esté lista
    const initCronJobs = require("./scripts/cronJobs");
    initCronJobs(io);

    // Arranque del Servidor
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
      console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("❌ Error crítico al iniciar la aplicación:", error);
  });

// Middlewares
app.use(cors(corsOptions));
// Aumentar el límite del body para soportar imágenes de huellas dactilares (Base64)
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Middleware para pasar 'io' a las rutas
app.use((req, res, next) => {
  req.io = io;
  next();
});

// ============================================================
// RATE LIMITING - Protección contra abuso de API
// ============================================================
const { apiLimiter } = require("./middlewares/rateLimitMiddleware");

// Aplicar rate limiting general a toda la API
app.use("/api/", apiLimiter);

// ============================================================
// 3. RUTAS
// ============================================================
app.use("/api/usuarios", require("./routes/usuarioRoutes"));
app.use("/api/categorias", require("./routes/categoriaRoutes"));
app.use("/api/dependencias", require("./routes/dependenciaRoutes"));
app.use("/api/subdependencias", require("./routes/subdependenciaRoutes"));
app.use("/api/biometria", require("./routes/biometriaRoutes"));
app.use("/api/cupos", require("./routes/cupoRoutes"));
app.use("/api/tipos-combustible", require("./routes/tipoCombustibleRoutes"));
app.use("/api/precios", require("./routes/precioRoutes"));
app.use("/api/modelos", require("./routes/modeloRoutes"));
app.use("/api/marcas", require("./routes/marcaRoutes"));
app.use("/api/vehiculos", require("./routes/vehiculoRoutes"));
app.use("/api/vehiculos-sin-placa", require("./routes/vehiculoSinPlaca"));
app.use("/api/llenaderos", require("./routes/llenaderoRoutes"));
app.use(
  "/api/movimientos-llenadero",
  require("./routes/movimientoLlenaderoRoutes"),
);
app.use("/api/evaporaciones", require("./routes/evaporacionRoutes"));
app.use("/api/tanques", require("./routes/tanqueRoutes"));

app.use("/api/dispensadores", require("./routes/dispensadorRoutes"));
app.use("/api/solicitudes", require("./routes/solicitudRoutes"));
app.use("/api/despacho", require("./routes/despachoRoutes"));
app.use("/api/validacion", require("./routes/validacionRoutes"));
app.use("/api/mediciones", require("./routes/medicionRoutes"));
app.use("/api/cargas-cisterna", require("./routes/cargaCisternaRoutes"));
app.use(
  "/api/transferencias-internas",
  require("./routes/transferenciaRoutes"),
);
app.use("/api/dashboard", require("./routes/dashboardRoutes"));
app.use("/api/reportes", require("./routes/reporteRoutes"));

// (Inicialización movida dentro de la conexión a BD)
