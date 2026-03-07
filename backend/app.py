"""
Autonomous-Flow: Flask API Server
==================================
REST API for the Quantum-Secure Autonomous Traffic Ecosystem.
Orchestrates the simulation engine, quantum protocol, and ML pipeline.
"""

import os
import sys
import time
import json
import threading
import math
from flask import Flask, jsonify, request, send_from_directory

# Add backend dir to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from traffic_sim import TrafficSimulator
from qsdc_protocol import QSDCEngine
from ml_pipeline import MLPipeline
from db_connector import SupabaseConnector
from config import SIM_TICK_RATE

# ─── Flask App ───────────────────────────────────────────────

app = Flask(
    __name__,
    static_folder=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend"),
)

# ─── Global State ────────────────────────────────────────────

simulator = TrafficSimulator()
quantum_engine = QSDCEngine()
ml_pipeline = MLPipeline()

sim_running = False
sim_thread = None
ml_train_counter = 0
db_sync_counter = 0
ML_TRAIN_INTERVAL = 100  # ticks between ML training
DB_SYNC_INTERVAL = 20    # sync to Supabase every 20 ticks (2 seconds)

db = SupabaseConnector()


# ─── Simulation Thread ──────────────────────────────────────

def simulation_loop():
    """Background thread running the simulation."""
    global sim_running, ml_train_counter, db_sync_counter
    while sim_running:
        simulator.tick()
        ml_train_counter += 1
        db_sync_counter += 1

        # Collect ML data every tick
        snapshot = simulator.get_snapshot()

        # Build vehicle data with snr_history for ML
        vehicle_data_list = []
        histories = simulator.get_vehicle_snr_histories()
        for v in snapshot["vehicles"]:
            v_data = dict(v)
            if v["id"] in histories:
                v_data["snr_history"] = histories[v["id"]]["snr_history"]
            vehicle_data_list.append(v_data)

        ml_snapshot = dict(snapshot)
        ml_snapshot["vehicles"] = vehicle_data_list
        ml_pipeline.collect_from_snapshot(ml_snapshot)

        # Periodic ML training
        if ml_train_counter >= ML_TRAIN_INTERVAL:
            ml_train_counter = 0
            try:
                ml_pipeline.train_all()
            except Exception as e:
                print(f"ML Training error: {e}")

        # Periodic Supabase Sync
        if db_sync_counter >= DB_SYNC_INTERVAL:
            db_sync_counter = 0
            try:
                db.insert_snapshot(snapshot)
                db.insert_telemetry(snapshot["vehicles"])
            except Exception as e:
                print(f"DB Sync error: {e}")

        time.sleep(SIM_TICK_RATE)


# ─── Static File Serving ────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.route("/<path:path>")
def static_files(path):
    return send_from_directory(app.static_folder, path)


# ─── Simulation Control API ─────────────────────────────────

@app.route("/api/sim/start", methods=["POST"])
def start_simulation():
    global sim_running, sim_thread
    if sim_running:
        return jsonify({"status": "already_running"})

    sim_running = True
    sim_thread = threading.Thread(target=simulation_loop, daemon=True)
    sim_thread.start()
    return jsonify({"status": "started"})


@app.route("/api/sim/stop", methods=["POST"])
def stop_simulation():
    global sim_running
    sim_running = False
    return jsonify({"status": "stopped"})


@app.route("/api/sim/status")
def sim_status():
    return jsonify({"running": sim_running, "tick": simulator.tick_count})


@app.route("/api/sim/snapshot")
def get_snapshot():
    """Get current simulation state for dashboard rendering."""
    snapshot = simulator.get_snapshot()

    # Enrich with ML predictions
    histories = simulator.get_vehicle_snr_histories()
    ml_predictions = []
    for v_id, v_data in histories.items():
        try:
            pred = ml_pipeline.predict_for_vehicle(v_data)
            ml_predictions.append(pred)
        except Exception:
            pass

    snapshot["ml_predictions"] = ml_predictions
    snapshot["ml_status"] = ml_pipeline.get_status()
    snapshot["sim_running"] = sim_running

    return jsonify(snapshot)


@app.route("/api/sim/heatmap")
def get_heatmap():
    """Get signal coverage heatmap."""
    resolution = request.args.get("resolution", 20, type=int)
    return jsonify(simulator.get_heatmap_data(resolution))


# ─── Quantum Communication API ──────────────────────────────

@app.route("/api/qsdc/transmit", methods=["POST"])
def qsdc_transmit():
    """Transmit a message using Quantum Superdense Coding."""
    data = request.get_json() or {}
    message = data.get("message", "Hi")
    distance = data.get("distance", 50.0)
    velocity = data.get("velocity", 10.0)
    eavesdrop = data.get("eavesdrop", False)

    try:
        result = quantum_engine.encode_message(
            message=message,
            distance=distance,
            velocity=velocity,
            simulate_eavesdrop=eavesdrop,
        )
        # Log to Supabase
        db.insert_transmission(result)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/qsdc/transmit_bits", methods=["POST"])
def qsdc_transmit_bits():
    """Transmit 2 classical bits using QSDC."""
    data = request.get_json() or {}
    bits = data.get("bits", "00")
    distance = data.get("distance", 50.0)
    velocity = data.get("velocity", 10.0)
    eavesdrop = data.get("eavesdrop", False)

    try:
        result = quantum_engine.transmit_bits(
            bits=bits,
            distance=distance,
            velocity=velocity,
            simulate_eavesdrop=eavesdrop,
        )
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/qsdc/security")
def qsdc_security():
    """Get quantum security report."""
    return jsonify(quantum_engine.get_security_report())


# ─── ML API ─────────────────────────────────────────────────

@app.route("/api/ml/predict/<int:vehicle_id>")
def ml_predict(vehicle_id):
    """Get ML predictions for a specific vehicle."""
    histories = simulator.get_vehicle_snr_histories()
    if vehicle_id not in histories:
        return jsonify({"error": "Vehicle not found"}), 404

    result = ml_pipeline.predict_for_vehicle(histories[vehicle_id])
    return jsonify(result)


@app.route("/api/ml/train", methods=["POST"])
def ml_train():
    """Manually trigger ML training."""
    result = ml_pipeline.train_all()
    return jsonify(result)


@app.route("/api/ml/status")
def ml_status():
    return jsonify(ml_pipeline.get_status())


# ─── Main ────────────────────────────────────────────────────

if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("  Autonomous-Flow: Quantum-Secure Traffic Ecosystem")
    print("  Dashboard: http://localhost:5000")
    print("=" * 60 + "\n")
    app.run(debug=False, host="0.0.0.0", port=5000, threaded=True)
