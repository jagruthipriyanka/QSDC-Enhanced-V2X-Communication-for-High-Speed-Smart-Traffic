"""
Quantum Superdense Coding (QSDC) Protocol Engine
================================================
Implements Bell-state entanglement, Pauli encoding/decoding,
QBER monitoring, and distance/velocity-based noise modeling.
"""

import numpy as np
from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
from qiskit_aer.noise import NoiseModel, depolarizing_error
from config import (
    QBER_THRESHOLD,
    BASE_DEPOLARIZATION,
    DISTANCE_NOISE_FACTOR,
    VELOCITY_NOISE_FACTOR,
)


class QSDCEngine:
    """Quantum Superdense Coding engine using Qiskit."""

    # Pauli encoding map: 2 classical bits -> gate operations
    ENCODING_MAP = {
        "00": "I",   # Identity (no gate)
        "01": "X",   # Pauli-X (bit flip)
        "10": "Z",   # Pauli-Z (phase flip)
        "11": "XZ",  # Pauli-X then Z (both flips)
    }

    def __init__(self):
        self.simulator = AerSimulator()
        self.transmission_log = []
        self.qber_history = []
        self.fidelity_history = []

    # ─── Noise Model ────────────────────────────────────────

    def _build_noise_model(self, distance: float, velocity: float) -> NoiseModel:
        """Build a noise model based on channel conditions.

        Depolarization increases with distance and velocity,
        simulating real-world quantum channel decoherence.
        """
        # Calculate depolarization probability
        dep_prob = min(
            BASE_DEPOLARIZATION
            + distance * DISTANCE_NOISE_FACTOR
            + velocity * VELOCITY_NOISE_FACTOR,
            0.75,  # cap at maximum mixed state
        )

        noise_model = NoiseModel()
        # Single-qubit gate errors
        error_1q = depolarizing_error(dep_prob, 1)
        # Two-qubit gate errors (higher for entangling gates)
        error_2q = depolarizing_error(min(dep_prob * 1.5, 0.75), 2)

        noise_model.add_all_qubit_quantum_error(error_1q, ["x", "z", "h"])
        noise_model.add_all_qubit_quantum_error(error_2q, ["cx"])

        return noise_model

    # ─── Core Protocol ──────────────────────────────────────

    def prepare_bell_pair(self) -> QuantumCircuit:
        """Create a Bell pair |Φ+⟩ = (|00⟩ + |11⟩)/√2."""
        qc = QuantumCircuit(2, 2)
        qc.h(0)       # Hadamard on qubit 0
        qc.cx(0, 1)   # CNOT: entangle qubits
        qc.barrier()
        return qc

    def encode_bits(self, qc: QuantumCircuit, bits: str) -> QuantumCircuit:
        """Apply Pauli gates to Alice's qubit (qubit 0) to encode 2 classical bits."""
        encoding = self.ENCODING_MAP.get(bits, "I")
        if "X" in encoding:
            qc.x(0)
        if "Z" in encoding:
            qc.z(0)
        qc.barrier()
        return qc

    def decode_bell_measurement(self, qc: QuantumCircuit) -> QuantumCircuit:
        """Bob performs Bell measurement to decode the 2 classical bits."""
        qc.cx(0, 1)   # CNOT
        qc.h(0)       # Hadamard
        qc.measure(0, 0)
        qc.measure(1, 1)
        return qc

    def transmit_bits(
        self,
        bits: str,
        distance: float = 0.0,
        velocity: float = 0.0,
        shots: int = 1024,
        simulate_eavesdrop: bool = False,
    ) -> dict:
        """Full QSDC transmission pipeline.

        Args:
            bits: 2-bit string to encode ("00", "01", "10", "11")
            distance: Distance between sender/receiver in meters
            velocity: Relative velocity in m/s
            shots: Number of simulation shots
            simulate_eavesdrop: If True, inject extra noise to simulate Eve

        Returns:
            dict with decoded bits, fidelity, QBER, circuit info, security status
        """
        if bits not in self.ENCODING_MAP:
            raise ValueError(f"Invalid bits: {bits}. Must be one of {list(self.ENCODING_MAP.keys())}")

        # 1. Prepare Bell pair
        qc = self.prepare_bell_pair()

        # 2. Encode bits
        qc = self.encode_bits(qc, bits)

        # 3. Eavesdropping simulation: Eve measures and re-prepares (intercept-resend)
        if simulate_eavesdrop:
            qc.h(0)
            qc.barrier()

        # 4. Bell measurement
        qc = self.decode_bell_measurement(qc)

        # 5. Build noise model
        noise_model = self._build_noise_model(distance, velocity)

        # Extra noise for eavesdropping
        if simulate_eavesdrop:
            eve_error = depolarizing_error(0.25, 1)
            noise_model.add_all_qubit_quantum_error(eve_error, ["h", "x", "z"])

        # 6. Execute circuit
        result = self.simulator.run(
            qc,
            noise_model=noise_model,
            shots=shots,
        ).result()

        counts = result.get_counts(qc)

        # 7. Analyze results
        # In superdense coding, the measurement result maps:
        # "00" -> sent "00", "01" -> sent "01", "10" -> sent "10", "11" -> sent "11"
        # (Qiskit bit ordering is reversed)
        total = sum(counts.values())
        # Qiskit reverses bit order, so we reverse the keys
        reversed_counts = {}
        for key, val in counts.items():
            reversed_counts[key[::-1]] = val

        correct_count = reversed_counts.get(bits, 0)
        fidelity = correct_count / total
        qber = 1.0 - fidelity

        # Determine decoded bits (most frequent outcome)
        decoded = max(reversed_counts, key=reversed_counts.get)

        # Security assessment
        security_breach = qber > QBER_THRESHOLD
        if security_breach:
            security_status = "⚠️ BREACH DETECTED"
            threat_level = "CRITICAL" if qber > 0.25 else "HIGH"
        else:
            security_status = "✅ SECURE"
            threat_level = "NONE"

        # Build result
        transmission = {
            "sent_bits": bits,
            "decoded_bits": decoded,
            "success": decoded == bits,
            "fidelity": round(fidelity, 4),
            "qber": round(qber, 4),
            "security_status": security_status,
            "threat_level": threat_level,
            "security_breach": security_breach,
            "eavesdrop_simulated": simulate_eavesdrop,
            "circuit_depth": qc.depth(),
            "circuit_gates": dict(qc.count_ops()),
            "shot_distribution": dict(sorted(reversed_counts.items())),
            "total_shots": total,
            "noise_params": {
                "distance_m": distance,
                "velocity_ms": velocity,
                "depolarization": round(
                    BASE_DEPOLARIZATION
                    + distance * DISTANCE_NOISE_FACTOR
                    + velocity * VELOCITY_NOISE_FACTOR,
                    4,
                ),
            },
        }

        # Update histories
        self.transmission_log.append(transmission)
        self.qber_history.append(qber)
        self.fidelity_history.append(fidelity)

        return transmission

    def encode_message(
        self,
        message: str,
        distance: float = 0.0,
        velocity: float = 0.0,
        simulate_eavesdrop: bool = False,
    ) -> dict:
        """Encode a full text message using QSDC.

        Each character is converted to 8-bit ASCII, then transmitted
        as 4 pairs of 2-bit superdense coded qubits.
        """
        binary = "".join(format(ord(c), "08b") for c in message)

        # Pad to multiple of 2
        if len(binary) % 2 != 0:
            binary += "0"

        bit_pairs = [binary[i : i + 2] for i in range(0, len(binary), 2)]
        transmissions = []
        decoded_binary = ""

        for pair in bit_pairs:
            result = self.transmit_bits(
                pair,
                distance=distance,
                velocity=velocity,
                shots=512,
                simulate_eavesdrop=simulate_eavesdrop,
            )
            transmissions.append(result)
            decoded_binary += result["decoded_bits"]

        # Reconstruct message from decoded bits
        decoded_chars = []
        for i in range(0, len(decoded_binary), 8):
            byte = decoded_binary[i : i + 8]
            if len(byte) == 8:
                try:
                    decoded_chars.append(chr(int(byte, 2)))
                except ValueError:
                    decoded_chars.append("?")

        decoded_message = "".join(decoded_chars)
        avg_fidelity = np.mean([t["fidelity"] for t in transmissions])
        avg_qber = np.mean([t["qber"] for t in transmissions])
        any_breach = any(t["security_breach"] for t in transmissions)

        return {
            "original_message": message,
            "decoded_message": decoded_message,
            "bit_pairs_transmitted": len(bit_pairs),
            "avg_fidelity": round(float(avg_fidelity), 4),
            "avg_qber": round(float(avg_qber), 4),
            "security_breach": any_breach,
            "transmissions": transmissions,
        }

    def get_security_report(self) -> dict:
        """Generate a security status report."""
        if not self.qber_history:
            return {"status": "NO DATA", "total_transmissions": 0}

        recent_qber = self.qber_history[-10:] if len(self.qber_history) >= 10 else self.qber_history
        avg_recent_qber = float(np.mean(recent_qber))
        breach_count = sum(1 for q in self.qber_history if q > QBER_THRESHOLD)

        return {
            "total_transmissions": len(self.transmission_log),
            "avg_qber": round(float(np.mean(self.qber_history)), 4),
            "avg_fidelity": round(float(np.mean(self.fidelity_history)), 4),
            "recent_avg_qber": round(avg_recent_qber, 4),
            "breach_count": breach_count,
            "breach_rate": round(breach_count / len(self.qber_history), 4),
            "current_threat": "HIGH" if avg_recent_qber > QBER_THRESHOLD else "NONE",
            "qber_threshold": QBER_THRESHOLD,
        }
