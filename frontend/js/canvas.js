/**
 * Canvas Visualization Engine
 * ===========================
 * Renders vehicles, RSUs, connections, and effects on HTML5 Canvas
 */

class CanvasRenderer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.gridWidth = 1000;
        this.gridHeight = 800;
        this.animFrame = null;
        this.particles = [];
        this.time = 0;

        this._resize();
        window.addEventListener('resize', () => this._resize());
    }

    _resize() {
        const container = this.canvas.parentElement;
        const rect = container.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.canvas.style.width = rect.width + 'px';
        this.canvas.style.height = rect.height + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.displayWidth = rect.width;
        this.displayHeight = rect.height;
        this.scaleX = rect.width / this.gridWidth;
        this.scaleY = rect.height / this.gridHeight;
    }

    _toScreen(x, y) {
        return [x * this.scaleX, y * this.scaleY];
    }

    // ─── Background ──────────────────────────────────────

    _drawBackground() {
        const ctx = this.ctx;
        // Dark gradient background
        const grad = ctx.createLinearGradient(0, 0, 0, this.displayHeight);
        grad.addColorStop(0, '#080c18');
        grad.addColorStop(1, '#0d1224');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, this.displayWidth, this.displayHeight);

        // Grid lines
        ctx.strokeStyle = 'rgba(0, 212, 255, 0.04)';
        ctx.lineWidth = 0.5;
        const gridStep = 40;
        for (let x = 0; x < this.displayWidth; x += gridStep * this.scaleX) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, this.displayHeight);
            ctx.stroke();
        }
        for (let y = 0; y < this.displayHeight; y += gridStep * this.scaleY) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(this.displayWidth, y);
            ctx.stroke();
        }
    }

    // ─── RSU Rendering ───────────────────────────────────

    _drawRSU(rsu) {
        const ctx = this.ctx;
        const [x, y] = this._toScreen(rsu.x, rsu.y);
        const radius = rsu.coverage_radius * Math.min(this.scaleX, this.scaleY);

        // Pulsing coverage ring
        const pulse = 0.85 + 0.15 * Math.sin(this.time * 2 + rsu.id);
        const coverageGrad = ctx.createRadialGradient(x, y, 0, x, y, radius * pulse);
        coverageGrad.addColorStop(0, 'rgba(0, 212, 255, 0.06)');
        coverageGrad.addColorStop(0.7, 'rgba(0, 212, 255, 0.02)');
        coverageGrad.addColorStop(1, 'rgba(0, 212, 255, 0)');
        ctx.fillStyle = coverageGrad;
        ctx.beginPath();
        ctx.arc(x, y, radius * pulse, 0, Math.PI * 2);
        ctx.fill();

        // Coverage ring outline
        ctx.strokeStyle = `rgba(0, 212, 255, ${0.12 + 0.08 * Math.sin(this.time * 3 + rsu.id)})`;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // Inner pulse animation
        const innerPulse = (this.time * 0.5 + rsu.id * 0.3) % 1;
        ctx.strokeStyle = `rgba(0, 212, 255, ${0.3 * (1 - innerPulse)})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, 15 + innerPulse * 30, 0, Math.PI * 2);
        ctx.stroke();

        // RSU tower icon
        const towerSize = 8;
        ctx.fillStyle = 'rgba(0, 212, 255, 0.9)';
        ctx.shadowColor = 'rgba(0, 212, 255, 0.6)';
        ctx.shadowBlur = 12;
        // Tower body
        ctx.fillRect(x - 2, y - towerSize, 4, towerSize * 2);
        ctx.fillRect(x - towerSize, y - 2, towerSize * 2, 4);
        // Center dot
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // RSU label
        ctx.fillStyle = 'rgba(0, 212, 255, 0.6)';
        ctx.font = '600 9px "Inter", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`RSU-${rsu.id}`, x, y + towerSize + 14);

        // Active connections count
        if (rsu.active_connections > 0) {
            ctx.fillStyle = 'rgba(34, 197, 94, 0.8)';
            ctx.font = '700 8px "JetBrains Mono", monospace';
            ctx.fillText(`${rsu.active_connections} linked`, x, y + towerSize + 24);
        }
    }

    // ─── Vehicle Rendering ───────────────────────────────

    _drawVehicle(vehicle) {
        const ctx = this.ctx;
        const [x, y] = this._toScreen(vehicle.x, vehicle.y);
        const heading = vehicle.heading;
        const isGlowing = vehicle.tx_glow;

        // Quantum transmission glow
        if (isGlowing) {
            const glowGrad = ctx.createRadialGradient(x, y, 0, x, y, 35);
            glowGrad.addColorStop(0, 'rgba(168, 85, 247, 0.4)');
            glowGrad.addColorStop(0.5, 'rgba(168, 85, 247, 0.15)');
            glowGrad.addColorStop(1, 'rgba(168, 85, 247, 0)');
            ctx.fillStyle = glowGrad;
            ctx.beginPath();
            ctx.arc(x, y, 35, 0, Math.PI * 2);
            ctx.fill();

            // Orbiting particles
            for (let i = 0; i < 3; i++) {
                const angle = this.time * 3 + (i * Math.PI * 2 / 3);
                const px = x + Math.cos(angle) * 18;
                const py = y + Math.sin(angle) * 18;
                ctx.fillStyle = 'rgba(168, 85, 247, 0.7)';
                ctx.beginPath();
                ctx.arc(px, py, 2, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Collision risk indicator
        if (vehicle.collision_risk > 0.5) {
            const riskPulse = 0.3 + 0.7 * Math.abs(Math.sin(this.time * 5));
            ctx.strokeStyle = `rgba(239, 68, 68, ${riskPulse})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(x, y, 20, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Vehicle body - arrow shape
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(heading);

        // Shadow
        ctx.shadowColor = isGlowing ? 'rgba(168, 85, 247, 0.6)' : 'rgba(0, 212, 255, 0.3)';
        ctx.shadowBlur = isGlowing ? 15 : 8;

        // Determine color based on state
        let bodyColor;
        if (vehicle.collision_risk > 0.7) {
            bodyColor = '#ef4444';
        } else if (isGlowing) {
            bodyColor = '#a855f7';
        } else if (vehicle.is_transmitting) {
            bodyColor = '#00d4ff';
        } else {
            bodyColor = '#64748b';
        }

        ctx.fillStyle = bodyColor;
        ctx.beginPath();
        ctx.moveTo(10, 0);       // nose
        ctx.lineTo(-6, -6);       // top-left
        ctx.lineTo(-3, 0);        // indent
        ctx.lineTo(-6, 6);        // bottom-left
        ctx.closePath();
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.restore();

        // Vehicle ID label
        ctx.fillStyle = 'rgba(241, 245, 249, 0.6)';
        ctx.font = '600 8px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`V${vehicle.id}`, x, y - 14);

        // Speed indicator
        if (vehicle.is_transmitting) {
            ctx.fillStyle = 'rgba(148, 163, 184, 0.4)';
            ctx.font = '400 7px "JetBrains Mono", monospace';
            ctx.fillText(`${vehicle.speed.toFixed(0)}m/s`, x, y + 18);
        }
    }

    // ─── Connection Lines ────────────────────────────────

    _drawConnections(vehicles, rsus) {
        const ctx = this.ctx;

        vehicles.forEach(v => {
            if (!v.is_transmitting || v.nearest_rsu_id === null) return;

            const rsu = rsus.find(r => r.id === v.nearest_rsu_id);
            if (!rsu) return;

            const [vx, vy] = this._toScreen(v.x, v.y);
            const [rx, ry] = this._toScreen(rsu.x, rsu.y);

            // Connection line with quantum-style dash
            const alpha = Math.min(1, Math.max(0.1, v.snr_db / 30));
            ctx.strokeStyle = v.tx_glow
                ? `rgba(168, 85, 247, ${alpha * 0.5})`
                : `rgba(0, 212, 255, ${alpha * 0.3})`;
            ctx.lineWidth = v.tx_glow ? 2 : 1;
            ctx.setLineDash([3, 6]);
            ctx.lineDashOffset = -this.time * 30; // animated dash
            ctx.beginPath();
            ctx.moveTo(vx, vy);
            ctx.lineTo(rx, ry);
            ctx.stroke();
            ctx.setLineDash([]);

            // Data packet animation (moving dot along line)
            if (v.tx_glow) {
                const t = (this.time * 2 + v.id * 0.3) % 1;
                const px = vx + (rx - vx) * t;
                const py = vy + (ry - vy) * t;
                ctx.fillStyle = 'rgba(168, 85, 247, 0.9)';
                ctx.shadowColor = 'rgba(168, 85, 247, 0.6)';
                ctx.shadowBlur = 8;
                ctx.beginPath();
                ctx.arc(px, py, 3, 0, Math.PI * 2);
                ctx.fill();
                ctx.shadowBlur = 0;
            }
        });
    }

    // ─── Main Render ─────────────────────────────────────

    render(snapshot) {
        if (!snapshot) return;

        this.time = performance.now() / 1000;
        this.gridWidth = snapshot.grid?.width || 1000;
        this.gridHeight = snapshot.grid?.height || 800;

        // Recalculate scale
        this.scaleX = this.displayWidth / this.gridWidth;
        this.scaleY = this.displayHeight / this.gridHeight;

        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.displayWidth, this.displayHeight);

        // Draw layers
        this._drawBackground();

        // Draw RSUs first (behind vehicles)
        (snapshot.rsus || []).forEach(rsu => this._drawRSU(rsu));

        // Draw connections
        this._drawConnections(snapshot.vehicles || [], snapshot.rsus || []);

        // Draw vehicles
        (snapshot.vehicles || []).forEach(v => this._drawVehicle(v));
    }
}
