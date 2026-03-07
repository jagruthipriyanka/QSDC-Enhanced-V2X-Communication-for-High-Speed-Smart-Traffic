/**
 * Chart.js Telemetry Charts
 * =========================
 * Real-time scrolling charts for Quantum Fidelity, SNR, and Latency
 */

class TelemetryCharts {
    constructor() {
        this.maxDataPoints = 80;
        this.fidelityChart = null;
        this.snrChart = null;
        this._initCharts();
    }

    _chartDefaults() {
        return {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 150 },
            interaction: {
                intersect: false,
                mode: 'index',
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    align: 'end',
                    labels: {
                        color: '#94a3b8',
                        font: { family: "'Inter', sans-serif", size: 10 },
                        boxWidth: 12,
                        boxHeight: 2,
                        padding: 8,
                        usePointStyle: true,
                        pointStyle: 'line',
                    },
                },
                tooltip: {
                    backgroundColor: 'rgba(10, 14, 26, 0.9)',
                    borderColor: 'rgba(0, 212, 255, 0.2)',
                    borderWidth: 1,
                    titleFont: { family: "'JetBrains Mono', monospace", size: 10 },
                    bodyFont: { family: "'JetBrains Mono', monospace", size: 10 },
                    titleColor: '#94a3b8',
                    bodyColor: '#f1f5f9',
                    padding: 10,
                    cornerRadius: 8,
                },
            },
            scales: {
                x: {
                    display: false,
                },
                y: {
                    grid: {
                        color: 'rgba(148, 163, 184, 0.06)',
                        drawBorder: false,
                    },
                    ticks: {
                        color: '#64748b',
                        font: { family: "'JetBrains Mono', monospace", size: 9 },
                        padding: 8,
                    },
                    border: { display: false },
                },
            },
        };
    }

    _initCharts() {
        // Fidelity Chart
        const fidCtx = document.getElementById('fidelity-chart');
        if (fidCtx) {
            this.fidelityChart = new Chart(fidCtx, {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [{
                        label: 'Quantum Fidelity',
                        data: [],
                        borderColor: '#00d4ff',
                        backgroundColor: 'rgba(0, 212, 255, 0.08)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        pointHoverBackgroundColor: '#00d4ff',
                    }],
                },
                options: {
                    ...this._chartDefaults(),
                    scales: {
                        ...this._chartDefaults().scales,
                        y: {
                            ...this._chartDefaults().scales.y,
                            min: 0,
                            max: 1,
                            ticks: {
                                ...this._chartDefaults().scales.y.ticks,
                                callback: v => v.toFixed(1),
                            },
                        },
                    },
                },
            });
        }

        // SNR + Latency Chart (dual axis)
        const snrCtx = document.getElementById('snr-chart');
        if (snrCtx) {
            this.snrChart = new Chart(snrCtx, {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [
                        {
                            label: 'SNR (dB)',
                            data: [],
                            borderColor: '#a855f7',
                            backgroundColor: 'rgba(168, 85, 247, 0.08)',
                            borderWidth: 2,
                            fill: true,
                            tension: 0.4,
                            pointRadius: 0,
                            yAxisID: 'y',
                        },
                        {
                            label: 'Latency (ms)',
                            data: [],
                            borderColor: '#f59e0b',
                            backgroundColor: 'rgba(245, 158, 11, 0.05)',
                            borderWidth: 1.5,
                            fill: false,
                            tension: 0.4,
                            pointRadius: 0,
                            borderDash: [4, 3],
                            yAxisID: 'y1',
                        },
                    ],
                },
                options: {
                    ...this._chartDefaults(),
                    scales: {
                        x: { display: false },
                        y: {
                            ...this._chartDefaults().scales.y,
                            position: 'left',
                            title: {
                                display: true,
                                text: 'SNR (dB)',
                                color: '#a855f7',
                                font: { size: 9, family: "'Inter', sans-serif" },
                            },
                        },
                        y1: {
                            position: 'right',
                            grid: { drawOnChartArea: false },
                            ticks: {
                                color: '#f59e0b',
                                font: { family: "'JetBrains Mono', monospace", size: 9 },
                            },
                            border: { display: false },
                            title: {
                                display: true,
                                text: 'Latency (ms)',
                                color: '#f59e0b',
                                font: { size: 9, family: "'Inter', sans-serif" },
                            },
                        },
                    },
                },
            });
        }
    }

    update(timelines) {
        if (!timelines) return;

        const labels = Array.from({ length: timelines.fidelity?.length || 0 }, (_, i) => i);

        // Update Fidelity chart
        if (this.fidelityChart && timelines.fidelity) {
            this.fidelityChart.data.labels = labels;
            this.fidelityChart.data.datasets[0].data = timelines.fidelity;
            this.fidelityChart.update('none');
        }

        // Update SNR + Latency chart
        if (this.snrChart && timelines.snr) {
            const snrLabels = Array.from({ length: timelines.snr.length }, (_, i) => i);
            this.snrChart.data.labels = snrLabels;
            this.snrChart.data.datasets[0].data = timelines.snr;
            this.snrChart.data.datasets[1].data = timelines.latency || [];
            this.snrChart.update('none');
        }
    }
}


/**
 * Heatmap Renderer
 */
class HeatmapRenderer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    }

    render(heatmapData) {
        if (!this.ctx || !heatmapData || !heatmapData.data) return;

        const data = heatmapData.data;
        const rows = data.length;
        const cols = data[0]?.length || 0;
        if (rows === 0 || cols === 0) return;

        const rect = this.canvas.parentElement.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.canvas.style.width = rect.width + 'px';
        this.canvas.style.height = rect.height + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const cellW = rect.width / cols;
        const cellH = rect.height / rows;

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const snr = data[r][c];
                this.ctx.fillStyle = this._snrToColor(snr);
                this.ctx.fillRect(c * cellW, r * cellH, cellW + 1, cellH + 1);
            }
        }
    }

    _snrToColor(snr) {
        // Map SNR to a color gradient: low (red) -> mid (amber) -> high (cyan)
        const clamped = Math.max(-10, Math.min(40, snr));
        const t = (clamped + 10) / 50; // normalize to 0-1

        if (t < 0.3) {
            // Red to amber
            const lt = t / 0.3;
            const r = Math.floor(150 + 105 * lt);
            const g = Math.floor(30 + 128 * lt);
            const b = Math.floor(30 - 19 * lt);
            return `rgba(${r}, ${g}, ${b}, 0.7)`;
        } else if (t < 0.6) {
            // Amber to green
            const lt = (t - 0.3) / 0.3;
            const r = Math.floor(255 - 221 * lt);
            const g = Math.floor(158 + 39 * lt);
            const b = Math.floor(11 + 83 * lt);
            return `rgba(${r}, ${g}, ${b}, 0.7)`;
        } else {
            // Green to cyan
            const lt = (t - 0.6) / 0.4;
            const r = Math.floor(34 - 34 * lt);
            const g = Math.floor(197 + 15 * lt);
            const b = Math.floor(94 + 161 * lt);
            return `rgba(${r}, ${g}, ${b}, 0.7)`;
        }
    }
}
