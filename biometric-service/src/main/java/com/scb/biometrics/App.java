package com.scb.biometrics;

import com.scb.biometrics.dto.VerifyRequest;
import com.scb.biometrics.dto.VerifyResponse;
import io.javalin.Javalin;
import java.util.Base64;

public class App {
    public static void main(String[] args) {
        // Inicializar servicio biométrico
        BiometricService biometricService = new BiometricService();

        // Iniciar Javalin en puerto 7000
        Javalin app = Javalin.create(config -> {
            config.http.maxRequestSize = 50 * 1024 * 1024; // 50MB max body size
        }).start(7000);

        // Endpoint de verificación
        app.post("/api/verify", ctx -> {
            try {
                VerifyRequest req = ctx.bodyAsClass(VerifyRequest.class);

                if (req.getProbe() == null || req.getCandidate() == null) {
                    ctx.status(400).json(new VerifyResponse("Faltan datos de huella (probe o candidate)"));
                    return;
                }

                // Normalizar Base64 (URL Safe a Standard si es necesario)
                String probeB64 = req.getProbe().replace('-', '+').replace('_', '/');
                String candidateB64 = req.getCandidate().replace('-', '+').replace('_', '/');

                byte[] probeBytes = Base64.getDecoder().decode(probeB64);
                byte[] candidateBytes = Base64.getDecoder().decode(candidateB64);

                double score = biometricService.verify(probeBytes, candidateBytes);
                boolean match = score >= 40.0; // Umbral de coincidencia

                ctx.json(new VerifyResponse(match, score));

            } catch (IllegalArgumentException e) {
                ctx.status(400).json(new VerifyResponse("Base64 inválido"));
            } catch (Exception e) {
                e.printStackTrace();
                ctx.status(500).json(new VerifyResponse("Error interno del servidor: " + e.getMessage()));
            }
        });

        // Endpoint de salud
        app.get("/health", ctx -> ctx.result("OK"));

        System.out.println("🚀 Microservicio Biométrico corriendo en http://localhost:7000");
    }
}
