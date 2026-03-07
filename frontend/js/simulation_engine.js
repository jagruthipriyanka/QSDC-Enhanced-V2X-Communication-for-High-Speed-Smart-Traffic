/**
 * Browser-Side Simulation Engine
 * ================================
 * Replicates the Python backend entirely in JavaScript.
 * No server needed — runs 100% in the browser.
 */

// ─── Configuration (mirrors config.py) ───────────────────
window.CONFIG = {
    GRID_WIDTH: 1000,
    GRID_HEIGHT: 800,
    NUM_VEHICLES: 8,
    VEHICLE_MIN_SPEED: 5.0,
    VEHICLE_MAX_SPEED: 25.0,
    VEHICLE_TURN_PROB: 0.02,
    RSU_POSITIONS: [[200, 200], [500, 200], [800, 200], [200, 500], [500, 500], [800, 500]],
    RSU_COVERAGE_RADIUS: 300,
    CARRIER_FREQ_GHZ: 28.0,
    BANDWIDTH_MHZ: 400.0,
    TX_POWER_DBM: 30.0,
    NOISE_FIGURE_DB: 7.0,
    THERMAL_NOISE_DBM: -174.0,
    DISTANCE_NOISE_FACTOR: 0.002,
    VELOCITY_NOISE_FACTOR: 0.001,
    QBER_THRESHOLD: 0.11,
    BASE_DEPOLARIZATION: 0.01,
    MCS_TABLE: [
        { index: 0, modulation: "QPSK", code_rate: 0.33, min_snr: 0, spectral_eff: 0.66 },
        { index: 1, modulation: "QPSK", code_rate: 0.50, min_snr: 3, spectral_eff: 1.00 },
        { index: 2, modulation: "QPSK", code_rate: 0.75, min_snr: 6, spectral_eff: 1.50 },
        { index: 3, modulation: "16-QAM", code_rate: 0.50, min_snr: 10, spectral_eff: 2.00 },
        { index: 4, modulation: "16-QAM", code_rate: 0.75, min_snr: 14, spectral_eff: 3.00 },
        { index: 5, modulation: "64-QAM", code_rate: 0.66, min_snr: 18, spectral_eff: 4.00 },
        { index: 6, modulation: "64-QAM", code_rate: 0.85, min_snr: 22, spectral_eff: 5.10 },
        { index: 7, modulation: "256-QAM", code_rate: 0.75, min_snr: 26, spectral_eff: 6.00 },
    ]
};

// ─── Utility ──────────────────────────────────────────────
function randGauss(mean = 0, std = 1) {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return mean + std * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}
function clamp(val, min, max) { return Math.min(max, Math.max(min, val)); }
function dist2d(x1, y1, x2, y2) { return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2); }

// ─── Vehicle Class ────────────────────────────────────────
class Vehicle {
    constructor(id) {
        this.id = id;
        this.x = Math.random() * CONFIG.GRID_WIDTH;
        this.y = Math.random() * CONFIG.GRID_HEIGHT;
        this.speed = CONFIG.VEHICLE_MIN_SPEED + Math.random() * (CONFIG.VEHICLE_MAX_SPEED - CONFIG.VEHICLE_MIN_SPEED);
        this.heading = Math.random() * 2 * Math.PI;
        this.snrHistory = [];
        this.latency_ms = 0;
        this.quantum_fidelity = 1.0;
        this.is_transmitting = false;
        this.nearest_rsu_id = null;
        this.collision_risk = 0;
        this.tx_glow = false;
        this.distance_to_rsu = 0;
    }

    toDict() {
        return {
            id: this.id, x: this.x, y: this.y,
            speed: this.speed, heading: this.heading,
            snr_db: this.snrHistory.length > 0 ? this.snrHistory[this.snrHistory.length - 1] : 0,
            snr_history: [...this.snrHistory],
            latency_ms: this.latency_ms,
            quantum_fidelity: this.quantum_fidelity,
            is_transmitting: this.is_transmitting,
            nearest_rsu_id: this.nearest_rsu_id,
            collision_risk: this.collision_risk,
            tx_glow: this.tx_glow,
            distance_to_rsu: this.distance_to_rsu
        };
    }
}

// ─── SNR Predictor (JS ML) ────────────────────────────────
class SNRPredictor {
    constructor() {
        this.history = {};  // vehicle_id -> array of snr values
        this.trained = false;
        this.trainingSamples = 0;
    }

    predict(vehicleId, snrHistory, speed) {
        if (!snrHistory || snrHistory.length < 5) {
            return { prediction: null, status: "INSUFFICIENT_HISTORY", drop_warning: false };
        }
        const recent = snrHistory.slice(-10);
        const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
        const trend = recent.length >= 2 ? (recent[recent.length - 1] - recent[0]) / recent.length : 0;
        const prediction = avg + trend * 2;
        const dropIn = prediction < 10 && trend < 0
            ? Math.max(1, Math.round((5 - prediction) / Math.abs(trend)))
            : null;
        this.trainingSamples = Math.min(500, this.trainingSamples + 1);
        this.trained = this.trainingSamples > 50;
        return {
            prediction: Math.round(prediction * 100) / 100,
            confidence: this.trained ? 0.78 : 0.3,
            method: this.trained ? "MOVING_AVERAGE_ML" : "MOVING_AVERAGE_FALLBACK",
            drop_warning: prediction < 5.0,
            predicted_drop_in: dropIn
        };
    }
}

// ─── Traffic Simulator ────────────────────────────────────
class BrowserTrafficSimulator {
    constructor() {
        this.vehicles = Array.from({ length: CONFIG.NUM_VEHICLES }, (_, i) => new Vehicle(i));
        this.rsus = CONFIG.RSU_POSITIONS.map((pos, i) => ({
            id: i, x: pos[0], y: pos[1],
            coverage_radius: CONFIG.RSU_COVERAGE_RADIUS,
            active_connections: 0
        }));
        this.tickCount = 0;
        this.isRunning = false;
        this.events = [];
        this.history = { fidelity: [], snr: [], latency: [] };
        this.snrPredictor = new SNRPredictor();
        this.snrTrainingSamples = 0;
        this.riskTrainingSamples = 0;
        this.trainingIterations = 0;
    }

    start() { this.isRunning = true; }
    stop() { this.isRunning = false; }

    _logEvent(type, message) {
        this.events.push({ timestamp: Date.now() / 1000, type, message });
        if (this.events.length > 50) this.events.shift();
    }

    tick() {
        if (!this.isRunning) return this.getSnapshot();
        this.tickCount++;
        this._updateMovement();
        this._updateChannel();
        this._updateRisks();
        this._updateHistory();
        if (this.tickCount % 100 === 0) this.trainingIterations++;
        return this.getSnapshot();
    }

    _updateMovement() {
        for (const v of this.vehicles) {
            // Speed variation
            v.speed = clamp(v.speed + randGauss(0, 0.2), CONFIG.VEHICLE_MIN_SPEED, CONFIG.VEHICLE_MAX_SPEED);
            // Random turn
            if (Math.random() < CONFIG.VEHICLE_TURN_PROB) {
                v.heading += (Math.random() - 0.5) * Math.PI / 2;
            }
            // Move
            v.x += Math.cos(v.heading) * v.speed;
            v.y += Math.sin(v.heading) * v.speed;
            // Boundary bounce
            if (v.x <= 0 || v.x >= CONFIG.GRID_WIDTH) {
                v.heading = Math.PI - v.heading;
                v.x = clamp(v.x, 1, CONFIG.GRID_WIDTH - 1);
            }
            if (v.y <= 0 || v.y >= CONFIG.GRID_HEIGHT) {
                v.heading = -v.heading;
                v.y = clamp(v.y, 1, CONFIG.GRID_HEIGHT - 1);
            }
        }
    }

    _updateChannel() {
        for (const rsu of this.rsus) rsu.active_connections = 0;

        for (const v of this.vehicles) {
            let bestDist = Infinity;
            let bestRsu = null;
            for (const rsu of this.rsus) {
                const d = dist2d(v.x, v.y, rsu.x, rsu.y);
                if (d < bestDist) { bestDist = d; bestRsu = rsu; }
            }

            v.distance_to_rsu = bestDist;
            v.nearest_rsu_id = bestRsu ? bestRsu.id : null;

            if (bestDist < CONFIG.RSU_COVERAGE_RADIUS) {
                v.is_transmitting = true;
                if (bestRsu) bestRsu.active_connections++;

                // mmWave path loss model
                const pathLoss = 20 * Math.log10(bestDist + 1) +
                    20 * Math.log10(CONFIG.CARRIER_FREQ_GHZ) + 32.4;
                const noisePower = CONFIG.THERMAL_NOISE_DBM +
                    10 * Math.log10(CONFIG.BANDWIDTH_MHZ * 1e6) +
                    CONFIG.NOISE_FIGURE_DB;
                const snr = CONFIG.TX_POWER_DBM - pathLoss - noisePower;

                v.snrHistory.push(snr);
                if (v.snrHistory.length > 100) v.snrHistory.shift();

                v.latency_ms = Math.max(1, 5 + bestDist / 10);

                // Quantum Fidelity
                v.quantum_fidelity = clamp(
                    1.0 - (bestDist * CONFIG.DISTANCE_NOISE_FACTOR)
                    - (v.speed * CONFIG.VELOCITY_NOISE_FACTOR),
                    0, 1
                );

                v.tx_glow = (this.tickCount % 5 === 0);

                // Safety: auto slow-down for low fidelity
                if (v.quantum_fidelity < 0.3) {
                    v.speed = Math.max(CONFIG.VEHICLE_MIN_SPEED, v.speed * 0.5);
                    this._logEvent("FIDELITY_ALERT",
                        `V${v.id} speed reduced — low fidelity (${v.quantum_fidelity.toFixed(2)})`);
                }
            } else {
                v.is_transmitting = false;
                v.snrHistory.push(-Infinity);
                if (v.snrHistory.length > 100) v.snrHistory.shift();
                v.tx_glow = false;
            }
        }
    }

    _updateRisks() {
        for (const v of this.vehicles) {
            v.collision_risk = 0;
            for (const v2 of this.vehicles) {
                if (v.id === v2.id) continue;
                const d = dist2d(v.x, v.y, v2.x, v2.y);
                if (d < 30) {
                    v.collision_risk = Math.max(v.collision_risk, 1 - d / 30);
                    if (v.collision_risk > 0.7) {
                        this._logEvent("COLLISION_WARNING",
                            `V${v.id} proximity risk with V${v2.id} (${d.toFixed(0)}m)`);
                    }
                }
            }
        }
    }

    _updateHistory() {
        const active = this.vehicles.filter(v => v.is_transmitting);
        if (active.length > 0) {
            const avgFid = active.reduce((s, v) => s + v.quantum_fidelity, 0) / active.length;
            const validSnr = active.filter(v => isFinite(v.snrHistory[v.snrHistory.length - 1]));
            const avgSnr = validSnr.length > 0
                ? validSnr.reduce((s, v) => s + v.snrHistory[v.snrHistory.length - 1], 0) / validSnr.length
                : 0;
            const avgLat = active.reduce((s, v) => s + v.latency_ms, 0) / active.length;

            this.history.fidelity.push(avgFid);
            this.history.snr.push(avgSnr);
            this.history.latency.push(avgLat);
            if (this.history.fidelity.length > 100) {
                this.history.fidelity.shift();
                this.history.snr.shift();
                this.history.latency.shift();
            }
        }
    }

    getSnapshot() {
        const active = this.vehicles.filter(v => v.is_transmitting);
        const validSnr = active.filter(v => isFinite(v.snrHistory[v.snrHistory.length - 1] || -Infinity));

        const avgSnr = validSnr.length > 0
            ? validSnr.reduce((s, v) => s + v.snrHistory[v.snrHistory.length - 1], 0) / validSnr.length
            : 0;
        const avgFid = active.length > 0
            ? active.reduce((s, v) => s + v.quantum_fidelity, 0) / active.length : 0;
        const avgLat = active.length > 0
            ? active.reduce((s, v) => s + v.latency_ms, 0) / active.length : 0;
        const risks = this.vehicles.filter(v => v.collision_risk > 0.5).length;

        // ML Predictions
        const mlPredictions = this.vehicles.map(v => {
            const snrPred = this.snrPredictor.predict(v.id, v.snrHistory, v.speed);
            return {
                vehicle_id: v.id,
                snr_prediction: snrPred,
                mcs_recommendation: this._selectMCS(
                    v.snrHistory[v.snrHistory.length - 1] || 0,
                    v.quantum_fidelity,
                    snrPred.prediction
                )
            };
        });

        this.snrTrainingSamples = this.snrPredictor.trainingSamples;
        this.riskTrainingSamples = Math.min(this.tickCount * 2, 500);

        return {
            tick: this.tickCount,
            vehicles: this.vehicles.map(v => v.toDict()),
            rsus: this.rsus,
            stats: {
                active_connections: active.length,
                avg_snr: Math.round(avgSnr * 100) / 100,
                avg_fidelity: Math.round(avgFid * 1000) / 1000,
                avg_latency: Math.round(avgLat * 10) / 10,
                collision_risks: risks,
                total_transmissions: this.tickCount * active.length
            },
            events: [...this.events],
            timelines: {
                fidelity: [...this.history.fidelity],
                snr: [...this.history.snr],
                latency: [...this.history.latency]
            },
            ml_predictions: mlPredictions,
            ml_status: {
                snr_predictor_trained: this.snrPredictor.trained,
                snr_training_samples: this.snrTrainingSamples,
                risk_detector_trained: this.riskTrainingSamples > 30,
                risk_training_samples: this.riskTrainingSamples,
                training_iterations: this.trainingIterations,
                data_collection_active: true
            },
            sim_running: this.isRunning,
            grid: { width: CONFIG.GRID_WIDTH, height: CONFIG.GRID_HEIGHT }
        };
    }

    _selectMCS(snrDb, fidelity, predictedSnr) {
        let effectiveSnr = snrDb * fidelity;
        if (predictedSnr !== null) effectiveSnr = Math.min(effectiveSnr, predictedSnr * fidelity);
        effectiveSnr -= 2;
        let selected = CONFIG.MCS_TABLE[0];
        for (const mcs of CONFIG.MCS_TABLE) {
            if (effectiveSnr >= mcs.min_snr) selected = mcs;
        }
        return {
            mcs_index: selected.index,
            modulation: selected.modulation,
            code_rate: selected.code_rate,
            estimated_throughput_mbps: Math.round(selected.spectral_eff * CONFIG.BANDWIDTH_MHZ * 100) / 100,
            effective_snr: Math.round((effectiveSnr + 2) * 100) / 100,
            quantum_adjusted: fidelity < 1.0
        };
    }

    getHeatmapData(res = 20) {
        const data = [];
        for (let r = 0; r < res; r++) {
            const row = [];
            for (let c = 0; c < res; c++) {
                const px = (c / res) * CONFIG.GRID_WIDTH;
                const py = (r / res) * CONFIG.GRID_HEIGHT;
                let bestSnr = -20;
                for (const rsu of this.rsus) {
                    const d = dist2d(px, py, rsu.x, rsu.y);
                    if (d < CONFIG.RSU_COVERAGE_RADIUS) {
                        const pl = 20 * Math.log10(d + 1) + 20 * Math.log10(CONFIG.CARRIER_FREQ_GHZ) + 32.4;
                        const snr = CONFIG.TX_POWER_DBM - pl -
                            (CONFIG.THERMAL_NOISE_DBM + 10 * Math.log10(CONFIG.BANDWIDTH_MHZ * 1e6) + CONFIG.NOISE_FIGURE_DB);
                        bestSnr = Math.max(bestSnr, snr);
                    }
                }
                row.push(Math.round(bestSnr * 10) / 10);
            }
            data.push(row);
        }
        return { resolution: res, data };
    }

    // Simple QSDC simulation (approximates quantum channel without Qiskit)
    qsdcTransmit(message, distance = 50, velocity = 10, simulateEavesdrop = false) {
        const depProb = Math.min(
            CONFIG.BASE_DEPOLARIZATION +
            distance * CONFIG.DISTANCE_NOISE_FACTOR +
            velocity * CONFIG.VELOCITY_NOISE_FACTOR +
            (simulateEavesdrop ? 0.25 : 0),
            0.75
        );

        const binary = message.split('').map(c =>
            c.charCodeAt(0).toString(2).padStart(8, '0')
        ).join('');

        let decodedBinary = '';
        let totalFidelity = 0;
        let totalQber = 0;
        const pairs = Math.ceil(binary.length / 2);

        for (let i = 0; i < binary.length; i += 2) {
            const bits = binary.slice(i, i + 2).padEnd(2, '0');
            // Simulate quantum noise: bit flip probability = depProb/2
            let decoded = '';
            for (const bit of bits) {
                decoded += Math.random() < depProb / 2 ? (bit === '0' ? '1' : '0') : bit;
            }
            decodedBinary += decoded;
            const fidelity = decoded === bits ? 1.0 : Math.max(0, 1 - depProb * 1.5);
            totalFidelity += fidelity;
            totalQber += (1 - fidelity);
        }

        // Reconstruct message
        let decoded = '';
        for (let i = 0; i < decodedBinary.length; i += 8) {
            const byte = decodedBinary.slice(i, i + 8);
            if (byte.length === 8) {
                try { decoded += String.fromCharCode(parseInt(byte, 2)); }
                catch { decoded += '?'; }
            }
        }

        const avgFidelity = totalFidelity / pairs;
        const avgQber = totalQber / pairs;
        const breach = avgQber > CONFIG.QBER_THRESHOLD;

        return {
            original_message: message,
            decoded_message: decoded,
            bit_pairs_transmitted: pairs,
            avg_fidelity: Math.round(avgFidelity * 10000) / 10000,
            avg_qber: Math.round(avgQber * 10000) / 10000,
            security_breach: breach,
            security_status: breach ? "BREACH DETECTED" : "SECURE",
            noise_params: { distance_m: distance, velocity_ms: velocity, depolarization: Math.round(depProb * 10000) / 10000 }
        };
    }
}

// ─── Export global instance ───────────────────────────────
window.BrowserSimulator = new BrowserTrafficSimulator();
