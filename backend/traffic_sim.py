"""
V2X Traffic Simulation Engine
=============================
2D urban grid simulator with autonomous vehicles (AVs),
roadside units (RSUs), 5G/6G mmWave channel modeling,
and real-time V2X communication.
"""

import math
import time
import random
import threading
import numpy as np
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

from config import (
    GRID_WIDTH, GRID_HEIGHT, SIM_TICK_RATE,
    NUM_VEHICLES, VEHICLE_MIN_SPEED, VEHICLE_MAX_SPEED, VEHICLE_TURN_PROB,
    RSU_POSITIONS, RSU_COVERAGE_RADIUS,
    CARRIER_FREQ_GHZ, BANDWIDTH_MHZ, TX_POWER_DBM,
    NOISE_FIGURE_DB, THERMAL_NOISE_DBM, MIN_SNR_DB,
)


# ─── Data Classes ────────────────────────────────────────────

@dataclass
class RSU:
    """Roadside Unit"""
    id: int
    x: float
    y: float
    coverage_radius: float = RSU_COVERAGE_RADIUS
    active_connections: int = 0
    total_transmissions: int = 0

    def to_dict(self):
        return {
            "id": self.id,
            "x": self.x,
            "y": self.y,
            "coverage_radius": self.coverage_radius,
            "active_connections": self.active_connections,
            "total_transmissions": self.total_transmissions,
        }


@dataclass
class Vehicle:
    """Autonomous Vehicle"""
    id: int
    x: float
    y: float
    speed: float          # m/s
    heading: float        # radians
    vtype: str = "AV"     # vehicle type
    is_transmitting: bool = False
    nearest_rsu_id: Optional[int] = None
    snr_db: float = 0.0
    latency_ms: float = 0.0
    path_loss_db: float = 0.0
    distance_to_rsu: float = float("inf")
    quantum_fidelity: float = 1.0
    mcs_index: int = 0
    collision_risk: float = 0.0
    emergency: bool = False
    snr_history: list = field(default_factory=list)
    tx_glow_timer: float = 0.0  # seconds of glow remaining

    def to_dict(self):
        return {
            "id": self.id,
            "x": round(self.x, 2),
            "y": round(self.y, 2),
            "speed": round(self.speed, 2),
            "heading": round(self.heading, 4),
            "type": self.vtype,
            "is_transmitting": self.is_transmitting,
            "nearest_rsu_id": self.nearest_rsu_id,
            "snr_db": round(self.snr_db, 2),
            "latency_ms": round(self.latency_ms, 2),
            "path_loss_db": round(self.path_loss_db, 2),
            "distance_to_rsu": round(self.distance_to_rsu, 2),
            "quantum_fidelity": round(self.quantum_fidelity, 4),
            "mcs_index": self.mcs_index,
            "collision_risk": round(self.collision_risk, 4),
            "emergency": self.emergency,
            "tx_glow": self.tx_glow_timer > 0,
        }


# ─── Channel Model ──────────────────────────────────────────

class MmWaveChannel:
    """5G/6G mmWave propagation model (28-60 GHz)."""

    def __init__(
        self,
        freq_ghz: float = CARRIER_FREQ_GHZ,
        bw_mhz: float = BANDWIDTH_MHZ,
        tx_power_dbm: float = TX_POWER_DBM,
        noise_figure_db: float = NOISE_FIGURE_DB,
    ):
        self.freq_ghz = freq_ghz
        self.bw_mhz = bw_mhz
        self.tx_power_dbm = tx_power_dbm
        self.noise_figure_db = noise_figure_db
        # Thermal noise power
        self.noise_power_dbm = (
            THERMAL_NOISE_DBM + 10 * math.log10(bw_mhz * 1e6) + noise_figure_db
        )

    def path_loss(self, distance_m: float) -> float:
        """Free-space path loss (Friis formula) for mmWave.
        
        PL(dB) = 32.4 + 20*log10(f_GHz) + 20*log10(d_m) + atmospheric_attenuation
        """
        if distance_m <= 0:
            distance_m = 0.1
        fspl = (
            32.4
            + 20 * math.log10(self.freq_ghz)
            + 20 * math.log10(distance_m)
        )
        # Add atmospheric/rain attenuation factor (simplified)
        atmospheric = 0.01 * distance_m  # ~10 dB/km
        # Shadow fading (log-normal, simplified as random component)
        shadow = random.gauss(0, 4.0)  # 4 dB standard deviation
        return fspl + atmospheric + shadow

    def calculate_snr(self, distance_m: float) -> Tuple[float, float, float]:
        """Calculate SNR, path loss, and latency.

        Returns: (snr_db, path_loss_db, latency_ms)
        """
        pl = self.path_loss(distance_m)
        rx_power_dbm = self.tx_power_dbm - pl
        snr_db = rx_power_dbm - self.noise_power_dbm

        # Latency model: propagation delay + processing
        prop_delay_ms = (distance_m / 3e8) * 1000  # speed of light
        processing_ms = random.uniform(0.5, 2.0)   # processing jitter
        # Queue delay increases with distance (more retransmissions)
        queue_ms = max(0.0, (30.0 - snr_db) * 0.1) if snr_db < 30 else 0.0
        latency_ms = prop_delay_ms + processing_ms + queue_ms

        return float(snr_db), float(pl), float(latency_ms)


# ─── Simulation Engine ──────────────────────────────────────

class TrafficSimulator:
    """Main V2X traffic simulation engine."""

    def __init__(self):
        self.vehicles: List[Vehicle] = []
        self.rsus: List[RSU] = []
        self.channel = MmWaveChannel()
        self.tick_count = 0
        self.running = False
        self.lock = threading.Lock()
        self.events = []          # recent event log
        self.snr_timeline = []    # global SNR timeline
        self.fidelity_timeline = []
        self.latency_timeline = []
        self._initialize()

    def _initialize(self):
        """Set up RSUs and spawn vehicles."""
        # Create RSUs
        for i, (x, y) in enumerate(RSU_POSITIONS):
            self.rsus.append(RSU(id=i, x=x, y=y))

        # Spawn vehicles at random positions with random headings
        directions = [0, math.pi / 2, math.pi, 3 * math.pi / 2]  # cardinal directions
        for i in range(NUM_VEHICLES):
            self.vehicles.append(
                Vehicle(
                    id=i,
                    x=random.uniform(50, GRID_WIDTH - 50),
                    y=random.uniform(50, GRID_HEIGHT - 50),
                    speed=random.uniform(VEHICLE_MIN_SPEED, VEHICLE_MAX_SPEED),
                    heading=random.choice(directions),
                )
            )

    def _move_vehicle(self, v: Vehicle, dt: float):
        """Update vehicle position with grid-constrained urban movement."""
        # Random turns at intersections
        if random.random() < VEHICLE_TURN_PROB:
            turns = [0, math.pi / 2, -math.pi / 2, math.pi]
            v.heading += random.choice(turns)
            v.heading = v.heading % (2 * math.pi)

        # Speed variation
        v.speed += float(random.gauss(0, 0.5))
        v.speed = float(max(float(VEHICLE_MIN_SPEED), min(float(VEHICLE_MAX_SPEED), float(v.speed))))

        # Update position
        dx = v.speed * math.cos(v.heading) * dt
        dy = v.speed * math.sin(v.heading) * dt
        v.x += dx
        v.y += dy

        # Boundary bounce
        if v.x < 10.0 or v.x > float(GRID_WIDTH) - 10.0:
            v.heading = math.pi - v.heading
            v.x = float(max(10.0, min(float(GRID_WIDTH) - 10.0, float(v.x))))
        if v.y < 10.0 or v.y > float(GRID_HEIGHT) - 10.0:
            v.heading = -v.heading
            v.y = float(max(10.0, min(float(GRID_HEIGHT) - 10.0, float(v.y))))

        # Decay glow timer
        if v.tx_glow_timer > 0:
            v.tx_glow_timer = float(max(0.0, float(v.tx_glow_timer) - dt))

    def _update_channel(self, v: Vehicle):
        """Update channel metrics for a vehicle to its nearest RSU."""
        min_dist = float("inf")
        nearest_rsu = None

        for rsu in self.rsus:
            dist = math.sqrt((v.x - rsu.x) ** 2 + (v.y - rsu.y) ** 2)
            if dist < min_dist:
                min_dist = dist
                nearest_rsu = rsu

        v.distance_to_rsu = min_dist
        v.nearest_rsu_id = nearest_rsu.id if nearest_rsu else None

        if min_dist <= RSU_COVERAGE_RADIUS and nearest_rsu:
            snr, pl, lat = self.channel.calculate_snr(min_dist)
            v.snr_db = snr
            v.path_loss_db = pl
            v.latency_ms = lat
            v.is_transmitting = snr >= MIN_SNR_DB

            # Quantum fidelity estimation (decays with distance and noise)
            from config import BASE_DEPOLARIZATION, DISTANCE_NOISE_FACTOR, VELOCITY_NOISE_FACTOR
            dep_prob = min(BASE_DEPOLARIZATION + min_dist * DISTANCE_NOISE_FACTOR + v.speed * VELOCITY_NOISE_FACTOR, 0.75)
            v.quantum_fidelity = max(0.0, 1.0 - dep_prob)

            # Track SNR history for ML
            v.snr_history.append(v.snr_db)
            if len(v.snr_history) > 100:
                v.snr_history.pop(0)
        else:
            v.snr_db = -10.0
            v.path_loss_db = 999.0
            v.latency_ms = 999.0
            v.is_transmitting = False
            v.quantum_fidelity = 0.0

    def _check_collision_risks(self):
        """Calculate collision risk between all vehicle pairs."""
        for v in self.vehicles:
            v.collision_risk = 0.0

        for i, v1 in enumerate(self.vehicles):
            for j, v2 in enumerate(self.vehicles):
                if i >= j:
                    continue
                dist = math.sqrt((v1.x - v2.x) ** 2 + (v1.y - v2.y) ** 2)
                if dist < 100:  # within danger zone
                    # Risk increases with proximity and speed
                    speed_factor = (v1.speed + v2.speed) / (2.0 * VEHICLE_MAX_SPEED)
                    proximity_factor = max(0.0, 1.0 - dist / 100.0)
                    risk = proximity_factor * speed_factor

                    # Check if heading toward each other
                    dx = v2.x - v1.x
                    dy = v2.y - v1.y
                    angle_to = math.atan2(dy, dx)
                    heading_diff = abs(v1.heading - angle_to) % (2 * math.pi)
                    if heading_diff < math.pi / 3:  # converging
                        risk *= 2.0

                    v1.collision_risk = float(max(float(v1.collision_risk), min(float(risk), 1.0)))
                    v2.collision_risk = float(max(float(v2.collision_risk), min(float(risk), 1.0)))

                    if risk > 0.7:
                        self._log_event(
                            "COLLISION_WARNING",
                            f"Vehicles {v1.id} & {v2.id} at risk (dist={dist:.1f}m, risk={risk:.2f})"
                        )

    def _log_event(self, event_type: str, message: str):
        """Log a simulation event."""
        event = {
            "tick": self.tick_count,
            "timestamp": time.time(),
            "type": event_type,
            "message": message,
        }
        self.events.append(event)
        if len(self.events) > 200:
            self.events.pop(0)

    def tick(self):
        """Advance simulation by one tick."""
        with self.lock:
            dt = SIM_TICK_RATE
            self.tick_count += 1

            # Reset RSU connection counts
            for rsu in self.rsus:
                rsu.active_connections = 0

            # Update each vehicle
            for v in self.vehicles:
                self._move_vehicle(v, dt)
                self._update_channel(v)

                # Count RSU connections
                if v.is_transmitting and v.nearest_rsu_id is not None:
                    idx = int(v.nearest_rsu_id)
                    if 0 <= idx < len(self.rsus):
                        self.rsus[idx].active_connections += 1

                # Check for low quantum fidelity alerts
                if v.quantum_fidelity < 0.3 and v.is_transmitting:
                    self._log_event(
                        "FIDELITY_ALERT",
                        f"Vehicle {v.id}: Quantum fidelity is decreasing. Slow down the vehicle to increase the quantum fidelity."
                    )
                    # Force slowdown to stabilize link
                    v.speed = float(max(float(VEHICLE_MIN_SPEED), float(v.speed) * 0.5))

                # Random transmissions with quantum data
                if v.is_transmitting and random.random() < 0.1:
                    v.tx_glow_timer = 1.0  # glow for 1 second
                    idx = int(v.nearest_rsu_id) if v.nearest_rsu_id is not None else -1
                    if 0 <= idx < len(self.rsus):
                        self.rsus[idx].total_transmissions += 1
                    self._log_event(
                        "QUANTUM_TX",
                        f"Vehicle {v.id} → RSU {v.nearest_rsu_id} "
                        f"[SNR={v.snr_db:.1f}dB, Fid={v.quantum_fidelity:.3f}]"
                    )

            # Check collision risks
            self._check_collision_risks()

            # Record timeline data
            active_vehicles = [v for v in self.vehicles if v.is_transmitting]
            if active_vehicles:
                avg_snr = float(np.mean([v.snr_db for v in active_vehicles]))
                avg_fid = float(np.mean([v.quantum_fidelity for v in active_vehicles]))
                avg_lat = float(np.mean([v.latency_ms for v in active_vehicles]))
            else:
                avg_snr = avg_fid = avg_lat = 0.0

            self.snr_timeline.append(round(avg_snr, 2))
            self.fidelity_timeline.append(round(avg_fid, 4))
            self.latency_timeline.append(round(avg_lat, 2))

            # Keep timelines bounded
            max_len = 500
            if len(self.snr_timeline) > max_len:
                self.snr_timeline = self.snr_timeline[-max_len:]
            if len(self.fidelity_timeline) > max_len:
                self.fidelity_timeline = self.fidelity_timeline[-max_len:]
            if len(self.latency_timeline) > max_len:
                self.latency_timeline = self.latency_timeline[-max_len:]

    def get_snapshot(self) -> dict:
        """Get current simulation state."""
        with self.lock:
            return {
                "tick": self.tick_count,
                "timestamp": time.time(),
                "grid": {"width": GRID_WIDTH, "height": GRID_HEIGHT},
                "vehicles": [v.to_dict() for v in self.vehicles],
                "rsus": [r.to_dict() for r in self.rsus],
                "events": self.events[-20:],
                "timelines": {
                    "snr": self.snr_timeline[-100:],
                    "fidelity": self.fidelity_timeline[-100:],
                    "latency": self.latency_timeline[-100:],
                },
                "stats": {
                    "active_connections": sum(
                        1 for v in self.vehicles if v.is_transmitting
                    ),
                    "avg_snr": round(float(np.mean([float(v.snr_db) for v in self.vehicles if v.is_transmitting] or [0.0])), 2),
                    "avg_fidelity": round(float(np.mean([float(v.quantum_fidelity) for v in self.vehicles if v.is_transmitting] or [0.0])), 4),
                    "avg_latency": round(float(np.mean([float(v.latency_ms) for v in self.vehicles if v.is_transmitting] or [0.0])), 2),
                    "collision_risks": sum(
                        1 for v in self.vehicles if v.collision_risk > 0.5
                    ),
                    "total_transmissions": sum(r.total_transmissions for r in self.rsus),
                },
            }

    def get_vehicle_snr_histories(self) -> dict:
        """Get SNR histories for all vehicles (for ML training)."""
        with self.lock:
            return {
                v.id: {
                    "snr_history": list(v.snr_history),
                    "current_snr": v.snr_db,
                    "speed": v.speed,
                    "distance_to_rsu": v.distance_to_rsu,
                    "collision_risk": v.collision_risk,
                    "latency_ms": v.latency_ms,
                }
                for v in self.vehicles
            }

    def get_heatmap_data(self, resolution: int = 20) -> dict:
        """Generate signal coverage heatmap for the grid."""
        with self.lock:
            cell_w = GRID_WIDTH / resolution
            cell_h = GRID_HEIGHT / resolution
            heatmap = []

            for iy in range(resolution):
                row = []
                cy = (iy + 0.5) * cell_h
                for ix in range(resolution):
                    cx = (ix + 0.5) * cell_w
                    # Calculate signal from nearest RSU
                    best_snr = -20.0
                    for rsu in self.rsus:
                        dist = math.sqrt((cx - rsu.x) ** 2 + (cy - rsu.y) ** 2)
                        if dist < RSU_COVERAGE_RADIUS:
                            snr = self.channel.tx_power_dbm - self.channel.path_loss(dist) - self.channel.noise_power_dbm
                            best_snr = float(max(float(best_snr), float(snr)))
                    row.append(round(float(best_snr), 1))
                heatmap.append(row)

            return {
                "resolution": resolution,
                "cell_width": cell_w,
                "cell_height": cell_h,
                "data": heatmap,
            }
