package com.scb.biometrics.dto;

public class VerifyRequest {
    private String probe;      // Base64 de la huella a verificar
    private String candidate;  // Base64 de la huella guardada

    // Getters y Setters
    public String getProbe() {
        return probe;
    }

    public void setProbe(String probe) {
        this.probe = probe;
    }

    public String getCandidate() {
        return candidate;
    }

    public void setCandidate(String candidate) {
        this.candidate = candidate;
    }
}
