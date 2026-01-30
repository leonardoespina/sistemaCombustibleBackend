@echo off
echo ==========================================
echo Iniciando Microservicio Biometrico
echo ==========================================
echo.

if not exist "target\biometric-service-1.0-SNAPSHOT.jar" (
    echo ERROR: El archivo JAR no existe.
    echo Por favor ejecuta primero: build.bat
    echo.
    pause
    exit /b 1
)

echo Servicio corriendo en http://localhost:7000
echo Presiona Ctrl+C para detener el servicio
echo.

java -jar target\biometric-service-1.0-SNAPSHOT.jar
