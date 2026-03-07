"""
ML Intelligence Pipeline
========================
SNR prediction, collision risk classification,
and adaptive MCS selection for the V2X ecosystem.
"""

import numpy as np
from collections import deque
from typing import List, Tuple, Optional
from sklearn.ensemble import RandomForestRegressor, RandomForestClassifier
from sklearn.preprocessing import StandardScaler
import warnings

from config import (
    SNR_HISTORY_LENGTH,
    RISK_PROXIMITY_THRESHOLD,
    RISK_LATENCY_THRESHOLD,
    MCS_TABLE,
    QBER_THRESHOLD,
)

warnings.filterwarnings("ignore", category=UserWarning)


class SNRPredictor:
    """Predicts future SNR values using Random Forest regression.

    Uses a sliding window of past SNR values plus contextual features
    (speed, distance) to predict the next SNR value.
    """

    def __init__(self, window_size: int = 10):
        self.window_size = window_size
        self.model = RandomForestRegressor(
            n_estimators=50,
            max_depth=10,
            random_state=42,
            n_jobs=-1,
        )
        self.scaler = StandardScaler()
        self.is_trained = False
        self.training_data_X = []
        self.training_data_y = []
        self.min_train_samples = 50

    def _build_features(
        self,
        snr_history: List[float],
        speed: float = 0.0,
        distance: float = 0.0,
    ) -> Optional[np.ndarray]:
        """Build feature vector from SNR history and context."""
        if len(snr_history) < self.window_size:
            return None

        window = snr_history[-self.window_size:]
        features = list(window) + [
            np.mean(window),
            np.std(window),
            np.max(window) - np.min(window),  # range
            window[-1] - window[0],             # trend
            speed,
            distance,
        ]
        return np.array(features).reshape(1, -1)

    def collect_sample(
        self,
        snr_history: List[float],
        speed: float,
        distance: float,
        next_snr: float,
    ):
        """Collect a training sample."""
        features = self._build_features(snr_history[:-1], speed, distance)
        if features is not None:
            self.training_data_X.append(features.flatten())
            self.training_data_y.append(next_snr)

    def train(self) -> dict:
        """Train the model on collected data."""
        if len(self.training_data_X) < self.min_train_samples:
            return {
                "status": "INSUFFICIENT_DATA",
                "samples": len(self.training_data_X),
                "required": self.min_train_samples,
            }

        X = np.array(self.training_data_X)
        y = np.array(self.training_data_y)

        # Fit scaler and transform
        X_scaled = self.scaler.fit_transform(X)

        # Train model
        self.model.fit(X_scaled, y)
        self.is_trained = True

        # Calculate training score
        train_score = self.model.score(X_scaled, y)
        predictions = self.model.predict(X_scaled)
        mae = float(np.mean(np.abs(predictions - y)))

        return {
            "status": "TRAINED",
            "samples": len(X),
            "r2_score": round(train_score, 4),
            "mae": round(mae, 4),
            "feature_importance": {
                f"snr_t-{self.window_size - i}": round(imp, 4)
                for i, imp in enumerate(self.model.feature_importances_[:self.window_size])
            },
        }

    def predict(
        self,
        snr_history: List[float],
        speed: float = 0.0,
        distance: float = 0.0,
    ) -> dict:
        """Predict the next SNR value."""
        features = self._build_features(snr_history, speed, distance)

        if features is None:
            return {"prediction": None, "status": "INSUFFICIENT_HISTORY"}

        if not self.is_trained:
            # Fallback: simple moving average
            avg = float(np.mean(snr_history[-self.window_size:]))
            trend = snr_history[-1] - snr_history[-self.window_size] if len(snr_history) >= self.window_size else 0
            prediction = avg + trend * 0.1
            return {
                "prediction": round(prediction, 2),
                "confidence": 0.3,
                "method": "MOVING_AVERAGE_FALLBACK",
                "drop_warning": prediction < 5.0,
            }

        X_scaled = self.scaler.transform(features)
        prediction = float(self.model.predict(X_scaled)[0])

        # Confidence from tree variance
        tree_predictions = np.array(
            [tree.predict(X_scaled)[0] for tree in self.model.estimators_]
        )
        confidence = max(0.0, 1.0 - float(np.std(tree_predictions)) / 10.0)

        return {
            "prediction": round(prediction, 2),
            "confidence": round(confidence, 4),
            "method": "RANDOM_FOREST",
            "drop_warning": prediction < 5.0,
            "predicted_drop_in": self._estimate_drop_time(snr_history, prediction),
        }

    def _estimate_drop_time(
        self, snr_history: List[float], next_prediction: float
    ) -> Optional[int]:
        """Estimate ticks until connection drops (SNR < 5 dB)."""
        if not self.is_trained or next_prediction >= 10:
            return None

        # Simple linear extrapolation
        if len(snr_history) >= 5:
            recent = snr_history[-5:]
            slope = (recent[-1] - recent[0]) / 5
            if slope < 0:
                ticks_to_drop = max(1, int((5.0 - next_prediction) / abs(slope)))
                return ticks_to_drop
        return None


class RiskDetector:
    """Classifies collision risk based on vehicle proximity and network metrics."""

    def __init__(self):
        self.model = RandomForestClassifier(
            n_estimators=30,
            max_depth=8,
            random_state=42,
            class_weight="balanced",
        )
        self.scaler = StandardScaler()
        self.is_trained = False
        self.training_data_X = []
        self.training_data_y = []

    def collect_sample(
        self,
        distance: float,
        speed1: float,
        speed2: float,
        heading_diff: float,
        snr: float,
        latency: float,
        is_risky: bool,
    ):
        """Collect a risk classification sample."""
        features = [
            distance,
            speed1,
            speed2,
            speed1 + speed2,               # combined speed
            heading_diff,
            snr,
            latency,
            1 if latency > RISK_LATENCY_THRESHOLD else 0,
            1 if distance < RISK_PROXIMITY_THRESHOLD else 0,
        ]
        self.training_data_X.append(features)
        self.training_data_y.append(1 if is_risky else 0)

    def train(self) -> dict:
        """Train the risk classifier."""
        if len(self.training_data_X) < 30:
            return {
                "status": "INSUFFICIENT_DATA",
                "samples": len(self.training_data_X),
            }

        X = np.array(self.training_data_X)
        y = np.array(self.training_data_y)

        X_scaled = self.scaler.fit_transform(X)
        self.model.fit(X_scaled, y)
        self.is_trained = True

        score = self.model.score(X_scaled, y)
        return {
            "status": "TRAINED",
            "samples": len(X),
            "accuracy": round(score, 4),
        }

    def predict_risk(
        self,
        distance: float,
        speed1: float,
        speed2: float,
        heading_diff: float,
        snr: float,
        latency: float,
    ) -> dict:
        """Predict collision risk."""
        features = np.array([
            distance,
            speed1,
            speed2,
            speed1 + speed2,
            heading_diff,
            snr,
            latency,
            1 if latency > RISK_LATENCY_THRESHOLD else 0,
            1 if distance < RISK_PROXIMITY_THRESHOLD else 0,
        ]).reshape(1, -1)

        if not self.is_trained:
            # Heuristic fallback
            risk = 0.0
            if distance < RISK_PROXIMITY_THRESHOLD:
                risk += 0.4 * (1 - distance / RISK_PROXIMITY_THRESHOLD)
            if latency > RISK_LATENCY_THRESHOLD:
                risk += 0.3
            risk += 0.3 * ((speed1 + speed2) / 50.0)
            risk = min(risk, 1.0)
            return {
                "risk_level": round(risk, 4),
                "is_risky": risk > 0.5,
                "method": "HEURISTIC_FALLBACK",
            }

        X_scaled = self.scaler.transform(features)
        prob = self.model.predict_proba(X_scaled)[0]
        risk_prob = float(prob[1]) if len(prob) > 1 else 0.0

        return {
            "risk_level": round(risk_prob, 4),
            "is_risky": risk_prob > 0.5,
            "method": "RANDOM_FOREST",
        }


class AdaptiveMCS:
    """Selects optimal Modulation and Coding Scheme based on channel conditions."""

    def __init__(self):
        self.mcs_table = MCS_TABLE

    def select_mcs(
        self,
        snr_db: float,
        quantum_fidelity: float = 1.0,
        predicted_snr: Optional[float] = None,
    ) -> dict:
        """Select the best MCS for current conditions.

        Uses a conservative approach: picks the highest MCS whose
        min_snr requirement is met with a margin, factoring in
        quantum fidelity and predicted future SNR.
        """
        # Effective SNR considers quantum fidelity
        effective_snr = snr_db * quantum_fidelity

        # If we predict a drop, use the worse of current and predicted
        if predicted_snr is not None:
            effective_snr = min(effective_snr, predicted_snr * quantum_fidelity)

        # Add a 2dB margin for safety
        effective_snr -= 2.0

        # Find the best MCS
        selected = self.mcs_table[0]
        for mcs in self.mcs_table:
            if effective_snr >= mcs["min_snr"]:
                selected = mcs

        throughput = selected["spectral_eff"] * (BANDWIDTH_MHZ if BANDWIDTH_MHZ else 400)

        return {
            "mcs_index": selected["index"],
            "modulation": selected["modulation"],
            "code_rate": selected["code_rate"],
            "spectral_efficiency": selected["spectral_eff"],
            "estimated_throughput_mbps": round(throughput, 2),
            "effective_snr": round(effective_snr + 2.0, 2),
            "quantum_adjusted": quantum_fidelity < 1.0,
        }


class MLPipeline:
    """Unified ML pipeline for the V2X ecosystem."""

    def __init__(self):
        self.snr_predictor = SNRPredictor(window_size=10)
        self.risk_detector = RiskDetector()
        self.adaptive_mcs = AdaptiveMCS()
        self.data_collection_active = True
        self.training_iterations = 0

    def collect_from_snapshot(self, snapshot: dict):
        """Collect ML training data from a simulation snapshot."""
        if not self.data_collection_active:
            return

        vehicles = snapshot.get("vehicles", [])

        for v in vehicles:
            snr_hist = v.get("snr_history", [])
            if len(snr_hist) >= 12:
                self.snr_predictor.collect_sample(
                    snr_history=snr_hist[:-1],
                    speed=v.get("speed", 0),
                    distance=v.get("distance_to_rsu", 0),
                    next_snr=snr_hist[-1],
                )

        # Collect pairwise risk data
        for i, v1 in enumerate(vehicles):
            for j, v2 in enumerate(vehicles):
                if i >= j:
                    continue
                import math
                dist = math.sqrt(
                    (v1["x"] - v2["x"]) ** 2 + (v1["y"] - v2["y"]) ** 2
                )
                if dist < 200:
                    heading_diff = abs(v1.get("heading", 0) - v2.get("heading", 0))
                    self.risk_detector.collect_sample(
                        distance=dist,
                        speed1=v1.get("speed", 0),
                        speed2=v2.get("speed", 0),
                        heading_diff=heading_diff,
                        snr=v1.get("snr_db", 0),
                        latency=v1.get("latency_ms", 0),
                        is_risky=v1.get("collision_risk", 0) > 0.5,
                    )

    def train_all(self) -> dict:
        """Train all ML models."""
        self.training_iterations += 1
        snr_result = self.snr_predictor.train()
        risk_result = self.risk_detector.train()

        return {
            "iteration": self.training_iterations,
            "snr_predictor": snr_result,
            "risk_detector": risk_result,
        }

    def predict_for_vehicle(self, vehicle_data: dict) -> dict:
        """Get all ML predictions for a single vehicle."""
        snr_hist = vehicle_data.get("snr_history", [])
        speed = vehicle_data.get("speed", 0)
        distance = vehicle_data.get("distance_to_rsu", 0)
        snr = vehicle_data.get("snr_db", 0)
        fidelity = vehicle_data.get("quantum_fidelity", 1.0)

        # SNR prediction
        snr_pred = self.snr_predictor.predict(snr_hist, speed, distance)

        # MCS selection
        predicted_snr = snr_pred.get("prediction")
        mcs = self.adaptive_mcs.select_mcs(snr, fidelity, predicted_snr)

        return {
            "vehicle_id": vehicle_data.get("id"),
            "snr_prediction": snr_pred,
            "mcs_recommendation": mcs,
        }

    def get_status(self) -> dict:
        """Get pipeline status."""
        return {
            "snr_predictor_trained": self.snr_predictor.is_trained,
            "snr_training_samples": len(self.snr_predictor.training_data_X),
            "risk_detector_trained": self.risk_detector.is_trained,
            "risk_training_samples": len(self.risk_detector.training_data_X),
            "training_iterations": self.training_iterations,
            "data_collection_active": self.data_collection_active,
        }
