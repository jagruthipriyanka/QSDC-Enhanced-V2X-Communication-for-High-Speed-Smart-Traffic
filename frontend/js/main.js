/**
 * Main Application Orchestrator
 * =============================
 * Connects all dashboard components and manages the update loop.
 */

// ─── Globals ─────────────────────────────────────────────
let canvasRenderer;
let telemetryCharts;
let heatmapRenderer;
let securityConsole;
let updateInterval = null;
let heatmapInterval = null;
let isRunning = false;
const API_BASE = '';
let notifiedFidelity = new Set(); // Track vehicles already warned about low fidelity

// ─── Initialize ──────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    canvasRenderer = new CanvasRenderer('sim-canvas');
    telemetryCharts = new TelemetryCharts();
    heatmapRenderer = new HeatmapRenderer('heatmap-canvas');
    securityConsole = new SecurityConsole('security-console');

    // Initial idle animation
    renderIdleState();

    // Check if simulation was already running
    fetch(`${API_BASE}/api/sim/status`)
        .then(r => r.json())
        .then(data => {
            if (data.running) {
                isRunning = true;
                startPolling();
                updateUIState(true);
            }
        })
        .catch(() => { });
});

// ─── Idle State Animation ─────────────────────────────────

function renderIdleState() {
    if (isRunning) return;

    const fakeSnapshot = {
        grid: { width: 1000, height: 800 },
        vehicles: [],
        rsus: [
            { id: 0, x: 200, y: 200, coverage_radius: 300, active_connections: 0 },
            { id: 1, x: 500, y: 200, coverage_radius: 300, active_connections: 0 },
            { id: 2, x: 800, y: 200, coverage_radius: 300, active_connections: 0 },
            { id: 3, x: 200, y: 500, coverage_radius: 300, active_connections: 0 },
            { id: 4, x: 500, y: 500, coverage_radius: 300, active_connections: 0 },
            { id: 5, x: 800, y: 500, coverage_radius: 300, active_connections: 0 },
        ],
    };
    canvasRenderer.render(fakeSnapshot);

    // Keep animating in idle
    if (!isRunning) {
        requestAnimationFrame(renderIdleState);
    }
}

// ─── Simulation Control ──────────────────────────────────

async function startSim() {
    try {
        const res = await fetch(`${API_BASE}/api/sim/start`, { method: 'POST' });
        const data = await res.json();
        if (data.status === 'started' || data.status === 'already_running') {
            isRunning = true;
            startPolling();
            updateUIState(true);
            securityConsole.addLine('SECURE', 'Simulation started. Quantum channels active.');
            showToast('success', '⚡ Simulation started successfully');
        }
    } catch (err) {
        showToast('danger', `Failed to start simulation: ${err.message}`);
    }
}

async function stopSim() {
    try {
        await fetch(`${API_BASE}/api/sim/stop`, { method: 'POST' });
        isRunning = false;
        stopPolling();
        updateUIState(false);
        securityConsole.addLine('SECURE', 'Simulation stopped. All channels closed.');
        showToast('warning', '⏹ Simulation stopped');
        setTimeout(renderIdleState, 100);
    } catch (err) {
        showToast('danger', `Failed to stop simulation: ${err.message}`);
    }
}

function updateUIState(running) {
    document.getElementById('btn-start').style.display = running ? 'none' : 'inline-flex';
    document.getElementById('btn-stop').style.display = running ? 'inline-flex' : 'none';
    document.getElementById('status-dot').className = `status-dot ${running ? 'active' : 'inactive'}`;
    document.getElementById('status-text').textContent = running ? 'LIVE' : 'OFFLINE';
    document.getElementById('chip-label').textContent = running ? 'LIVE SIMULATION' : 'SIMULATION';

    const chipDot = document.getElementById('chip-dot');
    chipDot.className = `dot ${running ? 'dot-green' : 'dot-blue'}`;
}

// ─── Polling Loop ────────────────────────────────────────

function startPolling() {
    if (updateInterval) clearInterval(updateInterval);
    if (heatmapInterval) clearInterval(heatmapInterval);

    // Main snapshot polling (200ms)
    updateInterval = setInterval(fetchSnapshot, 200);

    // Heatmap polling (every 3 seconds - heavyweight)
    heatmapInterval = setInterval(fetchHeatmap, 3000);
    fetchHeatmap(); // Initial fetch
}

function stopPolling() {
    if (updateInterval) { clearInterval(updateInterval); updateInterval = null; }
    if (heatmapInterval) { clearInterval(heatmapInterval); heatmapInterval = null; }
}

// ─── Data Fetching ───────────────────────────────────────

async function fetchSnapshot() {
    try {
        const res = await fetch(`${API_BASE}/api/sim/snapshot`);
        const snapshot = await res.json();
        updateDashboard(snapshot);
    } catch (err) {
        // Silently handle fetch errors during rapid polling
    }
}

async function fetchHeatmap() {
    try {
        const res = await fetch(`${API_BASE}/api/sim/heatmap?resolution=25`);
        const data = await res.json();
        heatmapRenderer.render(data);
    } catch (err) {
        // Silently handle
    }
}

// ─── Dashboard Update ────────────────────────────────────

function updateDashboard(snapshot) {
    if (!snapshot) return;

    // Render canvas
    canvasRenderer.render(snapshot);

    // Update header stats
    document.getElementById('stat-tick').textContent = snapshot.tick || 0;
    document.getElementById('stat-links').textContent = snapshot.stats?.active_connections || 0;
    document.getElementById('stat-snr').textContent =
        snapshot.stats?.avg_snr !== undefined ? `${snapshot.stats.avg_snr} dB` : '—';
    document.getElementById('stat-tx').textContent = snapshot.stats?.total_transmissions || 0;

    // Update KPIs
    document.getElementById('kpi-fidelity').textContent =
        snapshot.stats?.avg_fidelity !== undefined ? snapshot.stats.avg_fidelity.toFixed(3) : '—';
    document.getElementById('kpi-latency').textContent =
        snapshot.stats?.avg_latency !== undefined ? snapshot.stats.avg_latency.toFixed(1) : '—';

    const snrEl = document.getElementById('kpi-snr');
    const snrVal = snapshot.stats?.avg_snr;
    snrEl.textContent = snrVal !== undefined ? snrVal.toFixed(1) : '—';
    snrEl.className = `kpi-value ${snrVal > 15 ? 'green' : snrVal > 5 ? 'amber' : 'red'}`;

    const risksEl = document.getElementById('kpi-risks');
    const risks = snapshot.stats?.collision_risks || 0;
    risksEl.textContent = risks;
    risksEl.className = `kpi-value ${risks > 0 ? 'red' : 'green'}`;

    // Update overlay chips
    document.getElementById('vehicle-count').textContent = (snapshot.vehicles || []).length;
    document.getElementById('rsu-count').textContent = (snapshot.rsus || []).length;

    // Update charts
    telemetryCharts.update(snapshot.timelines);

    // Update console
    securityConsole.updateFromEvents(snapshot.events);

    // Update ML status
    updateMLStatus(snapshot.ml_status);

    // Check for low fidelity per vehicle
    (snapshot.vehicles || []).forEach(v => {
        if (v.quantum_fidelity < 0.3 && v.is_transmitting) {
            if (!notifiedFidelity.has(v.id)) {
                showToast('warning', `V${v.id}: Quantum fidelity is decreasing. Slow down the vehicle to increase the quantum fidelity.`);
                notifiedFidelity.add(v.id);
            }
        } else if (v.quantum_fidelity > 0.5) {
            notifiedFidelity.delete(v.id);
        }
    });

    // Check for dropped connection prediction
    if (snapshot.ml_predictions) {
        snapshot.ml_predictions.forEach(pred => {
            if (pred.snr_prediction?.drop_warning) {
                const dropIn = pred.snr_prediction.predicted_drop_in;
                if (dropIn && dropIn < 20) {
                    const alertKey = `drop-${pred.vehicle_id}-${snapshot.tick - (snapshot.tick % 50)}`; // Rate limit alerts
                    if (!this.notifiedDrop) this.notifiedDrop = new Set();

                    if (!this.notifiedDrop.has(alertKey)) {
                        securityConsole.addLine(
                            'ML_EVENT',
                            `⚠ Predicted connection drop for V${pred.vehicle_id} in ~${dropIn} ticks`
                        );
                        showToast('danger', `Critical Signal Alert: V${pred.vehicle_id} connection predicted to drop in ${dropIn} ticks!`);
                        this.notifiedDrop.add(alertKey);

                        // Clear old keys periodically
                        if (this.notifiedDrop.size > 50) this.notifiedDrop.clear();
                    }
                }
            }
        });
    }
}

function updateMLStatus(mlStatus) {
    if (!mlStatus) return;

    document.getElementById('ml-snr-status').textContent =
        mlStatus.snr_predictor_trained ? '✅ Active' : '⏳ Training';
    document.getElementById('ml-risk-status').textContent =
        mlStatus.risk_detector_trained ? '✅ Active' : '⏳ Training';
    document.getElementById('ml-samples').textContent =
        mlStatus.snr_training_samples || 0;
    document.getElementById('ml-iterations').textContent =
        mlStatus.training_iterations || 0;

    const badge = document.getElementById('ml-badge');
    if (mlStatus.snr_predictor_trained && mlStatus.risk_detector_trained) {
        badge.textContent = 'ACTIVE';
        badge.className = 'card-badge badge-green';
    } else {
        badge.textContent = 'COLLECTING';
        badge.className = 'card-badge badge-purple';
    }
}

// ─── Quantum Transmission ────────────────────────────────

async function transmitQSDC() {
    const message = document.getElementById('tx-message').value.trim() || 'Hi';
    const distance = parseFloat(document.getElementById('tx-distance').value) || 50;
    const velocity = parseFloat(document.getElementById('tx-velocity').value) || 10;
    const eavesdrop = document.getElementById('tx-eavesdrop').checked;

    const btn = document.getElementById('btn-transmit');
    btn.disabled = true;
    btn.textContent = '⏳ Transmitting...';

    try {
        const res = await fetch(`${API_BASE}/api/qsdc/transmit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, distance, velocity, eavesdrop }),
        });
        const result = await res.json();
        displayTxResult(result);

        // Log to console
        if (result.security_breach) {
            securityConsole.addLine(
                'SECURITY_BREACH',
                `QBER=${result.avg_qber.toFixed(3)} > 0.11 THRESHOLD! Eavesdropping detected on "${message}"`
            );
            document.getElementById('security-badge').textContent = '⚠️ BREACH';
            document.getElementById('security-badge').className = 'card-badge badge-red';
            showToast('danger', '🚨 Eavesdropping detected! QBER threshold exceeded!');
        } else {
            securityConsole.addLine(
                'QSDC_RESULT',
                `"${message}" → "${result.decoded_message}" | Fidelity=${result.avg_fidelity.toFixed(3)} | QBER=${result.avg_qber.toFixed(3)}`
            );
            document.getElementById('security-badge').textContent = 'SECURE';
            document.getElementById('security-badge').className = 'card-badge badge-green';
        }
    } catch (err) {
        showToast('danger', `Transmission failed: ${err.message}`);
    }

    btn.disabled = false;
    btn.textContent = '⚡ Transmit via QSDC';
}

function displayTxResult(result) {
    const container = document.getElementById('tx-result');
    container.style.display = 'block';

    const fidelityColor = result.avg_fidelity > 0.9 ? 'var(--cyber-green)'
        : result.avg_fidelity > 0.7 ? 'var(--warning-amber)' : 'var(--danger-red)';

    const securityIcon = result.security_breach ? '🔴 BREACH' : '🟢 SECURE';
    const securityColor = result.security_breach ? 'var(--danger-red)' : 'var(--cyber-green)';

    container.innerHTML = `
        <div class="tx-result-row">
            <span class="tx-result-label">Original</span>
            <span class="tx-result-value" style="color: var(--quantum-blue)">"${result.original_message}"</span>
        </div>
        <div class="tx-result-row">
            <span class="tx-result-label">Decoded</span>
            <span class="tx-result-value" style="color: var(--neon-purple)">"${result.decoded_message}"</span>
        </div>
        <div class="tx-result-row">
            <span class="tx-result-label">Fidelity</span>
            <span class="tx-result-value" style="color: ${fidelityColor}">${result.avg_fidelity.toFixed(4)}</span>
        </div>
        <div class="tx-result-row">
            <span class="tx-result-label">QBER</span>
            <span class="tx-result-value" style="color: ${result.avg_qber > 0.11 ? 'var(--danger-red)' : 'var(--cyber-green)'}">
                ${result.avg_qber.toFixed(4)}
            </span>
        </div>
        <div class="tx-result-row">
            <span class="tx-result-label">Bit Pairs</span>
            <span class="tx-result-value" style="color: var(--text-secondary)">${result.bit_pairs_transmitted}</span>
        </div>
        <div class="tx-result-row">
            <span class="tx-result-label">Security</span>
            <span class="tx-result-value" style="color: ${securityColor}">${securityIcon}</span>
        </div>
    `;
}

// ─── ML Training ─────────────────────────────────────────

async function trainML() {
    try {
        const res = await fetch(`${API_BASE}/api/ml/train`, { method: 'POST' });
        const result = await res.json();

        const snrStatus = result.snr_predictor?.status || 'UNKNOWN';
        const riskStatus = result.risk_detector?.status || 'UNKNOWN';

        securityConsole.addLine(
            'ML_EVENT',
            `Training complete: SNR=${snrStatus} (R²=${result.snr_predictor?.r2_score?.toFixed(3) || 'N/A'}), Risk=${riskStatus}`
        );
        showToast('success', '🧠 ML models retrained successfully');
    } catch (err) {
        showToast('danger', `ML training failed: ${err.message}`);
    }
}

// ─── Toast Notifications ─────────────────────────────────

function showToast(type, message, duration = 4000) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = { success: '✅', warning: '⚠️', danger: '🚨', info: 'ℹ️' };
    toast.innerHTML = `
        <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
        <span class="toast-text">${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        toast.style.transition = 'all 0.3s ease-out';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}
