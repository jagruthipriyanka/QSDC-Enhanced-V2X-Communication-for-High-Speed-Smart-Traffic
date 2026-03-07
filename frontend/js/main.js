// ─── Shared Configuration ────────────────────────────────
if (!window.CONFIG) {
    window.CONFIG = {
        GRID_WIDTH: 1000,
        GRID_HEIGHT: 800,
        NUM_VEHICLES: 8,
        RSU_POSITIONS: [[200, 200], [500, 200], [800, 200], [200, 500], [500, 500], [800, 500]],
        RSU_COVERAGE_RADIUS: 300
    };
}
const CFG = window.CONFIG;

// ─── Globals ─────────────────────────────────────────────
let canvasRenderer = null;
let telemetryCharts = null;
let heatmapRenderer = null;
let securityConsole = null;
let updateInterval = null;
let heatmapInterval = null;
let isRunning = false;
let notifiedFidelity = new Set();
let notifiedDrop = new Map(); // vehicle_id -> timestamp
const NOTIFICATION_COOLDOWN = 8000; // 8 seconds before alerting same vehicle again
const MAX_TOASTS = 3;


// ─── Initialize ──────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    console.log("🛠️ Initializing Autonomous-Flow Dash...");
    try {
        canvasRenderer = new CanvasRenderer('sim-canvas');
        securityConsole = new SecurityConsole('security-console');

        // Optional components (wrapped to prevent total crash)
        try { telemetryCharts = new TelemetryCharts(); } catch (e) { console.warn("Charts skipped:", e); }
        try { heatmapRenderer = new HeatmapRenderer('heatmap-canvas'); } catch (e) { console.warn("Heatmap skipped:", e); }

        renderIdleState();
        showToast('info', '✅ Dashboard Ready');
    } catch (e) {
        console.error("CRITICAL INIT ERROR:", e);
        alert("Dashboard Init Error: " + e.message);
    }
});

// ─── Idle Animation ───────────────────────────────────────

function renderIdleState() {
    if (isRunning) return;
    try {
        const fakeSnapshot = {
            grid: { width: 1000, height: 800 },
            vehicles: [],
            rsus: (window.CONFIG?.RSU_POSITIONS || []).map((pos, i) => ({
                id: i, x: pos[0], y: pos[1], coverage_radius: 300, active_connections: 0
            })),
        };
        canvasRenderer.render(fakeSnapshot);
    } catch (e) {
        console.error("Idle render failed:", e);
    }
    if (!isRunning) requestAnimationFrame(renderIdleState);
}

console.log("🚀 Autonomous-Flow: Browser Engine v1.0.1 Loaded");

// ─── Simulation Control ──────────────────────────────────

function startSim() {
    if (!window.BrowserSimulator) {
        showToast('danger', '❌ Engine not ready. Please refresh.');
        return;
    }
    window.BrowserSimulator.start();
    isRunning = true;
    startPolling();
    updateUIState(true);
    securityConsole.addLine('SECURE', 'Simulation started. Quantum channels active.');
    showToast('success', '⚡ Simulation started successfully');
}

function stopSim() {
    if (!window.BrowserSimulator) {
        console.error("Simulation engine missing!");
        return;
    }
    window.BrowserSimulator.stop();
    isRunning = false;
    stopPolling();
    updateUIState(false);
    securityConsole?.addLine('SECURE', 'Simulation stopped.');
    showToast('warning', '⏹ Simulation stopped');
    setTimeout(renderIdleState, 100);
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

    // Tick + render every 100ms
    updateInterval = setInterval(() => {
        const snapshot = window.BrowserSimulator.tick();
        updateDashboard(snapshot);
    }, 100);

    // Heatmap every 3s
    heatmapInterval = setInterval(() => {
        const heatmapData = window.BrowserSimulator.getHeatmapData(25);
        heatmapRenderer.render(heatmapData);
    }, 3000);

    // Initial heatmap
    const heatmapData = window.BrowserSimulator.getHeatmapData(25);
    heatmapRenderer.render(heatmapData);
}

function stopPolling() {
    if (updateInterval) { clearInterval(updateInterval); updateInterval = null; }
    if (heatmapInterval) { clearInterval(heatmapInterval); heatmapInterval = null; }
}

// ─── Dashboard Update ────────────────────────────────────

function updateDashboard(snapshot) {
    if (!snapshot) return;

    canvasRenderer.render(snapshot);

    // Header stats
    document.getElementById('stat-tick').textContent = snapshot.tick || 0;
    document.getElementById('stat-links').textContent = snapshot.stats?.active_connections || 0;
    document.getElementById('stat-snr').textContent =
        snapshot.stats?.avg_snr !== undefined ? `${snapshot.stats.avg_snr.toFixed(1)} dB` : '—';
    document.getElementById('stat-tx').textContent = snapshot.stats?.total_transmissions || 0;

    // KPIs
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

    // Overlay chips
    document.getElementById('vehicle-count').textContent = (snapshot.vehicles || []).length;
    document.getElementById('rsu-count').textContent = (snapshot.rsus || []).length;

    // Charts
    telemetryCharts.update(snapshot.timelines);

    // Console
    securityConsole.updateFromEvents(snapshot.events);

    // ML status
    updateMLStatus(snapshot.ml_status);

    // Low fidelity alerts (per vehicle)
    (snapshot.vehicles || []).forEach(v => {
        if (v.quantum_fidelity < 0.3 && v.is_transmitting) {
            if (!notifiedFidelity.has(v.id)) {
                showToast('warning', `⚠️ V${v.id}: Low quantum fidelity (${v.quantum_fidelity.toFixed(2)}) — speed reduced!`);
                notifiedFidelity.add(v.id);
            }
        } else if (v.quantum_fidelity > 0.5) {
            notifiedFidelity.delete(v.id);
        }
    });

    // SNR drop prediction alerts (Quiet Mode)
    if (snapshot.ml_predictions) {
        const now = Date.now();
        snapshot.ml_predictions.forEach(pred => {
            if (pred.snr_prediction?.drop_warning) {
                const dropIn = pred.snr_prediction.predicted_drop_in;
                const lastNotified = notifiedDrop.get(pred.vehicle_id) || 0;

                if (dropIn && dropIn < 15 && (now - lastNotified) > NOTIFICATION_COOLDOWN) {
                    securityConsole.addLine('ML_EVENT',
                        `Predicted connection drop for V${pred.vehicle_id} in ~${dropIn} ticks`);

                    showToast('danger', `🚨 V${pred.vehicle_id} signal dropping soon`);
                    notifiedDrop.set(pred.vehicle_id, now);
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
    document.getElementById('ml-samples').textContent = mlStatus.snr_training_samples || 0;
    document.getElementById('ml-iterations').textContent = mlStatus.training_iterations || 0;

    const badge = document.getElementById('ml-badge');
    if (mlStatus.snr_predictor_trained && mlStatus.risk_detector_trained) {
        badge.textContent = 'ACTIVE';
        badge.className = 'card-badge badge-green';
    } else {
        badge.textContent = 'COLLECTING';
        badge.className = 'card-badge badge-purple';
    }
}

// ─── Quantum Transmission (Browser) ──────────────────────

async function transmitQSDC() {
    const message = document.getElementById('tx-message').value.trim() || 'Hi';
    const distance = parseFloat(document.getElementById('tx-distance').value) || 50;
    const velocity = parseFloat(document.getElementById('tx-velocity').value) || 10;
    const eavesdrop = document.getElementById('tx-eavesdrop').checked;

    const btn = document.getElementById('btn-transmit');
    btn.disabled = true;
    btn.textContent = '⏳ Transmitting...';

    // Simulate small delay for realism
    await new Promise(r => setTimeout(r, 400));

    const result = window.BrowserSimulator.qsdcTransmit(message, distance, velocity, eavesdrop);
    displayTxResult(result);

    if (result.security_breach) {
        securityConsole.addLine('SECURITY_BREACH',
            `QBER=${result.avg_qber.toFixed(3)} > 0.11 THRESHOLD! Eavesdrop on "${message}"`);
        document.getElementById('security-badge').textContent = '⚠️ BREACH';
        document.getElementById('security-badge').className = 'card-badge badge-red';
        showToast('danger', '🚨 Eavesdropping detected! QBER threshold exceeded!');
    } else {
        securityConsole.addLine('QSDC_RESULT',
            `"${message}" → "${result.decoded_message}" | Fidelity=${result.avg_fidelity.toFixed(3)} | QBER=${result.avg_qber.toFixed(3)}`);
        document.getElementById('security-badge').textContent = 'SECURE';
        document.getElementById('security-badge').className = 'card-badge badge-green';
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
            <span class="tx-result-value" style="color:var(--quantum-blue)">"${result.original_message}"</span>
        </div>
        <div class="tx-result-row">
            <span class="tx-result-label">Decoded</span>
            <span class="tx-result-value" style="color:var(--neon-purple)">"${result.decoded_message}"</span>
        </div>
        <div class="tx-result-row">
            <span class="tx-result-label">Fidelity</span>
            <span class="tx-result-value" style="color:${fidelityColor}">${result.avg_fidelity.toFixed(4)}</span>
        </div>
        <div class="tx-result-row">
            <span class="tx-result-label">QBER</span>
            <span class="tx-result-value" style="color:${result.avg_qber > 0.11 ? 'var(--danger-red)' : 'var(--cyber-green)'}">
                ${result.avg_qber.toFixed(4)}
            </span>
        </div>
        <div class="tx-result-row">
            <span class="tx-result-label">Bit Pairs</span>
            <span class="tx-result-value" style="color:var(--text-secondary)">${result.bit_pairs_transmitted}</span>
        </div>
        <div class="tx-result-row">
            <span class="tx-result-label">Security</span>
            <span class="tx-result-value" style="color:${securityColor}">${securityIcon}</span>
        </div>
    `;
}

// ─── Toast Notifications ─────────────────────────────────

function showToast(type, message, duration = 3000) {
    const container = document.getElementById('toast-container');

    // Limit total toasts on screen
    if (container.children.length >= MAX_TOASTS) {
        container.children[0].remove();
    }

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
