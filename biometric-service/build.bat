@echo off
echo ==========================================
echo Compilando Microservicio Biometrico
echo ==========================================
echo.

REM Verificar si Java esta disponible
java -version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Java no esta instalado o no esta en el PATH.
    echo Por favor instala JDK 11 o superior desde:
    echo https://adoptium.net/
    echo.
    pause
    exit /b 1
)

REM Intentar establecer JAVA_HOME
if "%JAVA_HOME%"=="" (
    echo JAVA_HOME no configurado, buscando en ubicaciones comunes...
    
    REM Buscar en ubicaciones estandar de JDK
    if exist "C:\Program Files\Java\jdk-21" (
        set "JAVA_HOME=C:\Program Files\Java\jdk-21"
        echo JAVA_HOME encontrado: %JAVA_HOME%
    ) else if exist "C:\Program Files\Java\jdk-17" (
        set "JAVA_HOME=C:\Program Files\Java\jdk-17"
        echo JAVA_HOME encontrado: %JAVA_HOME%
    ) else if exist "C:\Program Files\Java\jdk-11" (
        set "JAVA_HOME=C:\Program Files\Java\jdk-11"
        echo JAVA_HOME encontrado: %JAVA_HOME%
    ) else (
        echo WARNING: No se pudo detectar JAVA_HOME automaticamente.
        echo Maven intentara usar el java del PATH.
    )
) else (
    echo Usando JAVA_HOME existente: %JAVA_HOME%
)

echo.

REM Compilar con Maven Wrapper
echo Ejecutando: mvnw clean package
call mvnw.cmd clean package

if %ERRORLEVEL% == 0 (
    echo.
    echo ==========================================
    echo COMPILACION EXITOSA
    echo ==========================================
    echo.
    echo Para iniciar el servicio ejecuta:
    echo   java -jar target\biometric-service-1.0-SNAPSHOT.jar
    echo.
    echo o simplemente ejecuta: run.bat
    echo.
) else (
    echo.
    echo ==========================================
    echo ERROR EN COMPILACION
    echo ==========================================
    echo.
)
pause
