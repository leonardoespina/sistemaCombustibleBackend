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
const whitelist = [

  "http://localhost:5173",
  "http://10.60.7.132:5173"
];

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
    credentials: true
  }
});

// Eventos de conexión de Socket.io
io.on("connection", (socket) => {
  console.log("Cliente conectado a Socket.io:", socket.id);

  socket.on("disconnect", () => {
    console.log("Cliente desconectado de Socket.io:", socket.id);
  });
});

// Conexión BD
dbConnect();

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
app.use("/api/movimientos-llenadero", require("./routes/movimientoLlenaderoRoutes"));
app.use("/api/tanques", require("./routes/tanqueRoutes"));
app.use("/api/dispensadores", require("./routes/dispensadorRoutes"));
app.use("/api/solicitudes", require("./routes/solicitudRoutes"));
app.use("/api/despacho", require("./routes/despachoRoutes"));
app.use("/api/validacion", require("./routes/validacionRoutes"));


// Inicializar Cron Jobs
const initCronJobs = require("./scripts/cronJobs");
initCronJobs(io);

// Arranque
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});
