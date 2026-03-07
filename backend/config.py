"""
Autonomous-Flow Configuration Constants
Quantum-Secure Autonomous Traffic Ecosystem
"""

# ─── Simulation Grid ────────────────────────────────────────
GRID_WIDTH = 1000        # meters
GRID_HEIGHT = 800        # meters
SIM_TICK_RATE = 0.1      # seconds per tick (100ms)

# ─── Vehicle Parameters ─────────────────────────────────────
NUM_VEHICLES = 8
VEHICLE_MIN_SPEED = 5.0   # m/s (~18 km/h)
VEHICLE_MAX_SPEED = 25.0  # m/s (~90 km/h)
VEHICLE_TURN_PROB = 0.02  # probability of random turn per tick

# ─── RSU (Roadside Unit) Positions ──────────────────────────
RSU_POSITIONS = [
    (200, 200),
    (500, 200),
    (800, 200),
    (200, 500),
    (500, 500),
    (800, 500),
]
RSU_COVERAGE_RADIUS = 300  # meters

# ─── 5G/6G mmWave Channel Model ────────────────────────────
CARRIER_FREQ_GHZ = 28.0    # GHz (mmWave)
BANDWIDTH_MHZ = 400.0      # MHz
TX_POWER_DBM = 30.0        # dBm
NOISE_FIGURE_DB = 7.0      # dB
THERMAL_NOISE_DBM = -174.0 # dBm/Hz at 290K
MIN_SNR_DB = 5.0           # minimum usable SNR

# ─── Quantum Parameters ────────────────────────────────────
QBER_THRESHOLD = 0.11      # 11% - eavesdropping threshold
BASE_DEPOLARIZATION = 0.01 # base depolarization rate
DISTANCE_NOISE_FACTOR = 0.01  # Increased for testing (originally 0.002)
VELOCITY_NOISE_FACTOR = 0.001  # noise increase per m/s

# ─── ML Parameters ─────────────────────────────────────────
SNR_HISTORY_LENGTH = 50    # number of past SNR values for prediction
RISK_PROXIMITY_THRESHOLD = 50.0  # meters - collision risk distance
RISK_LATENCY_THRESHOLD = 10.0    # ms - dangerous latency

# ─── MCS Table (Modulation & Coding Schemes) ───────────────
MCS_TABLE = [
    {"index": 0, "modulation": "QPSK",   "code_rate": 0.33, "min_snr": 0,  "spectral_eff": 0.66},
    {"index": 1, "modulation": "QPSK",   "code_rate": 0.50, "min_snr": 3,  "spectral_eff": 1.00},
    {"index": 2, "modulation": "QPSK",   "code_rate": 0.75, "min_snr": 6,  "spectral_eff": 1.50},
    {"index": 3, "modulation": "16-QAM", "code_rate": 0.50, "min_snr": 10, "spectral_eff": 2.00},
    {"index": 4, "modulation": "16-QAM", "code_rate": 0.75, "min_snr": 14, "spectral_eff": 3.00},
    {"index": 5, "modulation": "64-QAM", "code_rate": 0.66, "min_snr": 18, "spectral_eff": 4.00},
    {"index": 6, "modulation": "64-QAM", "code_rate": 0.85, "min_snr": 22, "spectral_eff": 5.10},
    {"index": 7, "modulation": "256-QAM","code_rate": 0.75, "min_snr": 26, "spectral_eff": 6.00},
]
