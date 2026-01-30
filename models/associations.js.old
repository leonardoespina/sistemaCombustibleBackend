const Usuario = require("./Usuario");
const Marca = require("./Marca");
const Modelo = require("./Modelo");
//const Vehiculo = require("./Vehiculo");
//const Tanque = require("./Tanque");
//const Chofer = require("./Chofer");
//const Gerencia = require("./Gerencia");
const Categoria = require("./Categoria");
const Dependencia = require("./Dependencia");
const Subdependencia = require("./Subdependencia");
const Biometria = require("./Biometria");
const TipoCombustible = require("./TipoCombustible");
const CupoBase = require("./CupoBase");
const CupoActual = require("./CupoActual");
const RecargaCupo = require("./RecargaCupo");
const ConsumoCupo = require("./ConsumoCupo");
const HistorialCupoMensual = require("./HistorialCupoMensual");
const Moneda = require("./Moneda");
const PrecioCombustible = require("./PrecioCombustible");
//const Almacenista = require("./Almacenista");
//const Despacho = require("./Despacho");
//const Dispensador = require("./Dispensador");
//const CargaCisterna = require("./CargaCisterna");
//const MedicionTanque = require("./MedicionTanque");
//const CierreInventario = require("./CierreInventario");
//const TransferenciaInterna = require("./TransferenciaInterna");

// ============================================================
// DEFINIR ASOCIACIONES
// ============================================================

// --- FLOTA (Marcas, Modelos, Vehículos) ---
Marca.hasMany(Modelo, { foreignKey: "id_marca" });
Modelo.belongsTo(Marca, { foreignKey: "id_marca" });
/*
Marca.hasMany(Vehiculo, { foreignKey: "id_marca" });
Vehiculo.belongsTo(Marca, { foreignKey: "id_marca" });

Modelo.hasMany(Vehiculo, { foreignKey: "id_modelo" });
Vehiculo.belongsTo(Modelo, { foreignKey: "id_modelo" });

Gerencia.hasMany(Vehiculo, { foreignKey: "id_gerencia" });
Vehiculo.belongsTo(Gerencia, { foreignKey: "id_gerencia" });*/

// --- TANQUES Y DISPENSADORES ---
/*
Tanque.hasMany(Dispensador, { foreignKey: "id_tanque_asociado" });
Dispensador.belongsTo(Tanque, {
  as: "TanqueAsociado",
  foreignKey: "id_tanque_asociado",
});*/

// --- CISTERNA Y CARGAS ---
/*Vehiculo.hasMany(CargaCisterna, { foreignKey: "id_vehiculo" });
CargaCisterna.belongsTo(Vehiculo, { foreignKey: "id_vehiculo" });

Tanque.hasMany(CargaCisterna, { foreignKey: "id_tanque" });
CargaCisterna.belongsTo(Tanque, { foreignKey: "id_tanque" });

Almacenista.hasMany(CargaCisterna, { foreignKey: "id_almacenista" });
CargaCisterna.belongsTo(Almacenista, { foreignKey: "id_almacenista" });

Usuario.hasMany(CargaCisterna, { foreignKey: "id_usuario" });
CargaCisterna.belongsTo(Usuario, { foreignKey: "id_usuario" });*/

// --- DESPACHOS ---
/*Dispensador.hasMany(Despacho, { foreignKey: "id_dispensador" });
Despacho.belongsTo(Dispensador, { foreignKey: "id_dispensador" });

Vehiculo.hasMany(Despacho, { foreignKey: "id_vehiculo" });
Despacho.belongsTo(Vehiculo, { foreignKey: "id_vehiculo" });

Gerencia.hasMany(Despacho, { foreignKey: "id_gerencia" });
Despacho.belongsTo(Gerencia, { foreignKey: "id_gerencia" });

Almacenista.hasMany(Despacho, { foreignKey: "id_almacenista" });
Despacho.belongsTo(Almacenista, { foreignKey: "id_almacenista" });

Usuario.hasMany(Despacho, { foreignKey: "id_usuario" });
Despacho.belongsTo(Usuario, { foreignKey: "id_usuario" });*/

/*Chofer.hasMany(Despacho, { foreignKey: "id_chofer" });
Despacho.belongsTo(Chofer, { foreignKey: "id_chofer" });*/

// --- MEDICIONES TANQUE ---
/*Tanque.hasMany(MedicionTanque, { foreignKey: "id_tanque" });
MedicionTanque.belongsTo(Tanque, { foreignKey: "id_tanque" });*//*

/*Usuario.hasMany(MedicionTanque, { foreignKey: "id_usuario" });
MedicionTanque.belongsTo(Usuario, { foreignKey: "id_usuario" });*/

// --- CIERRE DE INVENTARIO ---
// Relaciones para el Cierre
/*Tanque.hasMany(CierreInventario, { foreignKey: "id_tanque" });
CierreInventario.belongsTo(Tanque, { foreignKey: "id_tanque" });*/

/*Usuario.hasMany(CierreInventario, { foreignKey: "id_usuario" });
CierreInventario.belongsTo(Usuario, { foreignKey: "id_usuario" });*/

// Un Cierre agrupa muchos despachos
/*CierreInventario.hasMany(Despacho, { foreignKey: "id_cierre" });
Despacho.belongsTo(CierreInventario, { foreignKey: "id_cierre" });*/

// Un Cierre agrupa muchas cargas
/*CierreInventario.hasMany(CargaCisterna, { foreignKey: "id_cierre" });
CargaCisterna.belongsTo(CierreInventario, { foreignKey: "id_cierre" });*/

// Un Cierre agrupa muchas mediciones
/*CierreInventario.hasMany(MedicionTanque, { foreignKey: "id_cierre" });
MedicionTanque.belongsTo(CierreInventario, { foreignKey: "id_cierre" });*/

// --- TRANSFERENCIAS INTERNAS ---
/*
Tanque.hasMany(TransferenciaInterna, {
  as: "TransferenciasOrigen",
  foreignKey: "id_tanque_origen",
});
TransferenciaInterna.belongsTo(Tanque, {
  as: "TanqueOrigen",
  foreignKey: "id_tanque_origen",
});

Tanque.hasMany(TransferenciaInterna, {
  as: "TransferenciasDestino",
  foreignKey: "id_tanque_destino",
});
TransferenciaInterna.belongsTo(Tanque, {
  as: "TanqueDestino",
  foreignKey: "id_tanque_destino",
});*/

/*Almacenista.hasMany(TransferenciaInterna, { foreignKey: "id_almacenista" });
TransferenciaInterna.belongsTo(Almacenista, { foreignKey: "id_almacenista" });*/

/*Usuario.hasMany(TransferenciaInterna, { foreignKey: "id_usuario" });
TransferenciaInterna.belongsTo(Usuario, { foreignKey: "id_usuario" });*/

// --- CATEGORIA Y DEPENDENCIAS ---
Categoria.hasMany(Dependencia, { foreignKey: "id_categoria" });
Dependencia.belongsTo(Categoria, { foreignKey: "id_categoria", as: "Categoria" });

// --- SUBDEPENDENCIA Y DEPENDENCIA ---
Dependencia.hasMany(Subdependencia, { foreignKey: "id_dependencia" });
Subdependencia.belongsTo(Dependencia, { foreignKey: "id_dependencia", as: "Dependencia" });

// --- USUARIO Y JERARQUÍA ---
Usuario.belongsTo(Categoria, { foreignKey: "id_categoria", as: "Categoria" });
Categoria.hasMany(Usuario, { foreignKey: "id_categoria" });

Usuario.belongsTo(Dependencia, { foreignKey: "id_dependencia", as: "Dependencia" });
Dependencia.hasMany(Usuario, { foreignKey: "id_dependencia" });

Usuario.belongsTo(Subdependencia, { foreignKey: "id_subdependencia", as: "Subdependencia" });
Subdependencia.hasMany(Usuario, { foreignKey: "id_subdependencia" });

// --- BIOMETRÍA Y JERARQUÍA ---
Biometria.belongsTo(Categoria, { foreignKey: "id_categoria", as: "Categoria" });
Categoria.hasMany(Biometria, { foreignKey: "id_categoria" });

Biometria.belongsTo(Dependencia, { foreignKey: "id_dependencia", as: "Dependencia" });
Dependencia.hasMany(Biometria, { foreignKey: "id_dependencia" });

Biometria.belongsTo(Subdependencia, { foreignKey: "id_subdependencia", as: "Subdependencia" });
Subdependencia.hasMany(Biometria, { foreignKey: "id_subdependencia" });

// --- CUPOS Y GESTIÓN DE COMBUSTIBLE ---

// CupoBase -> Categoria
CupoBase.belongsTo(Categoria, { foreignKey: "id_categoria", as: "Categoria" });
Categoria.hasMany(CupoBase, { foreignKey: "id_categoria" });

// CupoBase -> Dependencia
CupoBase.belongsTo(Dependencia, { foreignKey: "id_dependencia", as: "Dependencia" });
Dependencia.hasMany(CupoBase, { foreignKey: "id_dependencia" });

// CupoBase -> Subdependencia
CupoBase.belongsTo(Subdependencia, { foreignKey: "id_subdependencia", as: "Subdependencia" });
Subdependencia.hasMany(CupoBase, { foreignKey: "id_subdependencia" });

// CupoBase -> TipoCombustible
CupoBase.belongsTo(TipoCombustible, { foreignKey: "id_tipo_combustible", as: "TipoCombustible" });
TipoCombustible.hasMany(CupoBase, { foreignKey: "id_tipo_combustible" });

// CupoBase -> CupoActual (1:N, aunque generalmente es 1 activo por mes)
CupoBase.hasMany(CupoActual, { foreignKey: "id_cupo_base", as: "CuposMensuales" });
CupoActual.belongsTo(CupoBase, { foreignKey: "id_cupo_base", as: "CupoBase" });

// CupoActual -> RecargaCupo (1:N)
CupoActual.hasMany(RecargaCupo, { foreignKey: "id_cupo_actual", as: "Recargas" });
RecargaCupo.belongsTo(CupoActual, { foreignKey: "id_cupo_actual", as: "CupoActual" });

// RecargaCupo -> Usuario (Autorizado por)
RecargaCupo.belongsTo(Usuario, { foreignKey: "autorizado_por", as: "AutorizadoPor" });
Usuario.hasMany(RecargaCupo, { foreignKey: "autorizado_por" });

// CupoActual -> ConsumoCupo (1:N)
CupoActual.hasMany(ConsumoCupo, { foreignKey: "id_cupo_actual", as: "Consumos" });
ConsumoCupo.belongsTo(CupoActual, { foreignKey: "id_cupo_actual", as: "CupoActual" });

// CupoBase -> HistorialCupoMensual (1:N)
CupoBase.hasMany(HistorialCupoMensual, { foreignKey: "id_cupo_base", as: "HistorialMensual" });
HistorialCupoMensual.belongsTo(CupoBase, { foreignKey: "id_cupo_base", as: "CupoBase" });

// --- PRECIOS Y MONEDAS ---

// PrecioCombustible -> TipoCombustible
TipoCombustible.hasMany(PrecioCombustible, { foreignKey: "id_tipo_combustible", as: "Precios" });
PrecioCombustible.belongsTo(TipoCombustible, { foreignKey: "id_tipo_combustible", as: "TipoCombustible" });

// PrecioCombustible -> Moneda
Moneda.hasMany(PrecioCombustible, { foreignKey: "id_moneda", as: "Precios" });
PrecioCombustible.belongsTo(Moneda, { foreignKey: "id_moneda", as: "Moneda" });


module.exports = {
  Usuario,
  Biometria,
  CupoBase,
  CupoActual,
  RecargaCupo,
  ConsumoCupo,
  HistorialCupoMensual,
  TipoCombustible,
  Moneda,
  PrecioCombustible,
 // Marca,
  //Modelo,
  //Vehiculo,
 // Tanque,
 // Chofer,
  // Gerencia,
  Categoria,
  Dependencia,
  Subdependencia,
 // Almacenista,
 // Despacho,
 // Dispensador,
 // CargaCisterna,
 // MedicionTanque,
 // CierreInventario,
 // TransferenciaInterna,
};
