package com.scb.biometrics;

import com.machinezoo.sourceafis.FingerprintMatcher;
import com.machinezoo.sourceafis.FingerprintTemplate;
import com.machinezoo.sourceafis.FingerprintImage;

public class BiometricService {

    /**
     * Compara dos huellas dactilares usando SourceAFIS (API v3.14+).
     * 
     * @param probeBytes     Imagen de la huella a verificar (PNG, JPEG, etc.)
     * @param candidateBytes Imagen de la huella almacenada (PNG, JPEG, etc.)
     * @return Score de similitud (>= 40 suele considerarse un match)
     */
    public double verify(byte[] probeBytes, byte[] candidateBytes) {
        try {
            // 1. Crear imágenes definiendo el DPI
            FingerprintImage probeImg = new FingerprintImage()
                .dpi(500)
                .decode(probeBytes);

            FingerprintImage candidateImg = new FingerprintImage()
                .dpi(500)
                .decode(candidateBytes);

            // 2. Crear templates desde las imágenes
            FingerprintTemplate probe = new FingerprintTemplate(probeImg);
            FingerprintTemplate candidate = new FingerprintTemplate(candidateImg);

            // 3. Comparar
            double score = new FingerprintMatcher()
                .index(probe)
                .match(candidate);

            return score;
        } catch (Exception e) {
            System.err.println("Error procesando huellas: " + e.getMessage());
            // En caso de error (formato inválido, etc.), retornamos 0.0
            return 0.0;
        }
    }
}
