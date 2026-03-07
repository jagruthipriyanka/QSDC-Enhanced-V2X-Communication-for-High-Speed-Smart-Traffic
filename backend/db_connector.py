import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

class SupabaseConnector:
    def __init__(self):
        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_KEY")
        if not url or not key:
            print("Supabase credentials not found in environment.")
            self.client = None
        else:
            try:
                self.client: Client = create_client(url, key)
                print("Supabase connection initialized.")
            except Exception as e:
                print(f"Failed to connect to Supabase: {e}")
                self.client = None

    def insert_snapshot(self, snapshot_data):
        if not self.client: return
        try:
            self.client.table("sim_snapshots").insert({
                "tick": snapshot_data.get("tick"),
                "active_connections": snapshot_data["stats"].get("active_connections"),
                "avg_snr": snapshot_data["stats"].get("avg_snr"),
                "avg_fidelity": snapshot_data["stats"].get("avg_fidelity"),
                "avg_latency": snapshot_data["stats"].get("avg_latency"),
                "collision_risks": snapshot_data["stats"].get("collision_risks"),
                "total_transmissions": snapshot_data["stats"].get("total_transmissions")
            }).execute()
        except Exception as e:
            print(f"Error inserting snapshot: {e}")

    def insert_transmission(self, tx_data):
        if not self.client: return
        try:
            self.client.table("quantum_transmissions").insert({
                "sent_message": tx_data.get("original_message"),
                "decoded_message": tx_data.get("decoded_message"),
                "avg_fidelity": tx_data.get("avg_fidelity"),
                "avg_qber": tx_data.get("avg_qber"),
                "security_breach": tx_data.get("security_breach")
            }).execute()
        except Exception as e:
            print(f"Error inserting transmission: {e}")

    def insert_telemetry(self, vehicle_list):
        if not self.client: return
        try:
            # Multi-row insert for efficiency
            data = []
            for v in vehicle_list:
                data.append({
                    "vehicle_id": v.get("id"),
                    "x": v.get("x"),
                    "y": v.get("y"),
                    "speed": v.get("speed"),
                    "snr_db": v.get("snr_db"),
                    "quantum_fidelity": v.get("quantum_fidelity")
                })
            if data:
                self.client.table("vehicle_telemetry").insert(data).execute()
        except Exception as e:
            print(f"Error inserting telemetry: {e}")
