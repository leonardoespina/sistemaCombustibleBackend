# Microservicio de Verificación Biométrica

Microservicio independiente desarrollado en Java con Javalin que proporciona verificación de huellas dactilares usando **SourceAFIS 3.14**.

## Arquitectura

```
┌─────────────────────┐          HTTP POST           ┌──────────────────────┐
│                     │ ────────────────────────────> │                      │
│  Backend Node.js    │   /api/verify                │  Microservicio Java  │
│  (Express)          │   { probe, candidate }       │  (Javalin + SourceAFIS)│
│                     │ <──────────────────────────── │                      │
└─────────────────────┘   { match, score }           └──────────────────────┘
     Puerto 3000                                            Puerto 7000
```

## Requisitos

- **Java JDK 11 o superior** (recomendado JDK 21)
- Maven (incluido como wrapper en el proyecto)

## Instalación y Ejecución

### 1. Compilar el Proyecto

Desde la carpeta `C:\scb\biometric-service`:

```cmd
build.bat
```

Este script:
- Detecta automáticamente la instalación de Java
- Descarga Maven (primera vez, ~5-10 minutos)
- Descarga todas las dependencias necesarias
- Compila y empaqueta el microservicio en un JAR

### 2. Ejecutar el Microservicio

```cmd
run.bat
```

O manualmente:

```cmd
java -jar target\biometric-service-1.0-SNAPSHOT.jar
```

El servicio estará disponible en: **http://localhost:7000**

## API Endpoints

### POST `/api/verify`

Compara dos huellas dactilares y determina si coinciden.

**Request:**
```json
{
  "probe": "BASE64_IMAGEN_HUELLA_A_VERIFICAR",
  "candidate": "BASE64_IMAGEN_HUELLA_ALMACENADA"
}
```

**Response (Match):**
```json
{
  "match": true,
  "score": 85.4,
  "error": null
}
```

**Response (No Match):**
```json
{
  "match": false,
  "score": 12.3,
  "error": null
}
```

**Response (Error):**
```json
{
  "match": false,
  "score": 0.0,
  "error": "Base64 inválido"
}
```

### GET `/health`

Verifica que el servicio esté activo.

**Response:**
```
OK
```

## Umbral de Coincidencia

El microservicio usa un **score >= 40** como umbral para considerar una coincidencia válida. Este es el estándar recomendado por SourceAFIS para alta confianza.

## Integración con Backend Node.js

El backend Node.js en `C:\scb\controllers\biometriaController.js` ya está configurado para usar este microservicio mediante peticiones HTTP con `axios`.

**Asegúrate de que ambos servicios estén corriendo:**

1. **Microservicio Java** (puerto 7000): `run.bat`
2. **Backend Node.js** (puerto 3000): `npm start`

## Despliegue en Producción

Para ejecutar el servicio en background como un servicio de Windows:

1. Usa **NSSM** (Non-Sucking Service Manager): https://nssm.cc/
2. Instala como servicio:
   ```cmd
   nssm install BiometricService "C:\Program Files\Java\jdk-21\bin\java.exe" "-jar C:\scb\biometric-service\target\biometric-service-1.0-SNAPSHOT.jar"
   nssm start BiometricService
   ```

## Solución de Problemas

### Error: JAVA_HOME not found

Verifica que Java esté instalado:
```cmd
java -version
```

Si no está instalado, descarga JDK 21 desde: https://adoptium.net/

### Error: Connection refused (ECONNREFUSED)

El microservicio no está corriendo. Ejecuta `run.bat` primero.

### Error: Port 7000 already in use

Otro proceso está usando el puerto 7000. Cierra esa aplicación o cambia el puerto en `App.java` (línea 15).

## Desarrollo

### Estructura del Proyecto

```
biometric-service/
├── src/main/java/com/scb/biometrics/
│   ├── App.java                    # Servidor Javalin
│   ├── BiometricService.java       # Lógica SourceAFIS
│   └── dto/
│       ├── VerifyRequest.java      # DTO de entrada
│       └── VerifyResponse.java     # DTO de salida
├── pom.xml                          # Dependencias Maven
├── build.bat                        # Script de compilación
└── run.bat                          # Script de ejecución
```

### Dependencias Principales

- **Javalin 6.1.3**: Framework web ligero
- **SourceAFIS 3.14.0**: Motor de comparación biométrica
- **Jackson**: Serialización JSON
- **SLF4J**: Logging

## Licencia

Este microservicio es parte del Sistema de Control de Combustible (SCF).

---

**Última actualización:** Enero 2026
