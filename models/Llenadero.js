const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/database");

const Llenadero = sequelize.define(
  "Llenadero",
  {
    id_llenadero: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    nombre_llenadero: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    capacidad: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      validate: {
        isDecimal: true,
        min: 0
      }
    },
    disponibilidadActual: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: 0,
      validate: {
        isDecimal: true,
        min: 0
      }
    },
    id_combustible: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'tipo_combustible',
        key: 'id_tipo_combustible'
      }
    },
    estado: {
      // Cambiado de ENUM a STRING para compatibilidad con PostgreSQL sync
      type: DataTypes.STRING(20),
      defaultValue: "ACTIVO",
    },
  
  },
  {
    tableName: "llenaderos",
    timestamps: false,
  }
);

Llenadero.associate = (models) => {
  Llenadero.belongsTo(models.TipoCombustible, { foreignKey: "id_combustible" });
};

module.exports = Llenadero;
