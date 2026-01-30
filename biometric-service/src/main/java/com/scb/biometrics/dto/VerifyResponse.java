package com.scb.biometrics.dto;

public class VerifyResponse {
    private boolean match;
    private double score;
    private String error;

    public VerifyResponse(boolean match, double score) {
        this.match = match;
        this.score = score;
    }

    public VerifyResponse(String error) {
        this.match = false;
        this.score = 0.0;
        this.error = error;
    }

    // Getters y Setters
    public boolean isMatch() {
        return match;
    }

    public void setMatch(boolean match) {
        this.match = match;
    }

    public double getScore() {
        return score;
    }

    public void setScore(double score) {
        this.score = score;
    }

    public String getError() {
        return error;
    }

    public void setError(String error) {
        this.error = error;
    }
}
