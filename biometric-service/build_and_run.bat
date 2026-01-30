@echo off
echo Compilando Microservicio Biometrico...

REM Verificar si JAVA_HOME esta configurado, sino intentar usar el path comun
if "%JAVA_HOME%" == "" set JAVA_HOME=C:\Program Files\Java\jdk-21

REM Usar mvnw si existe, sino mvn del sistema
if exist "mvnw.cmd" (
    call mvnw.cmd clean package
) else (
    call mvn clean package
)

if %ERRORLEVEL% == 0 (
    echo.
    echo ==========================================
    echo COMPILACION EXITOSA
    echo ==========================================
    echo.
    echo Para iniciar el servicio ejecute:
    echo java -jar target/biometric-service-1.0-SNAPSHOT.jar
    echo.
) else (
    echo.
    echo ERROR EN COMPILACION
)
pause
