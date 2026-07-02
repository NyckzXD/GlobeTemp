import http.server
import socketserver
import json
import math
import random
import time
from urllib.parse import urlparse, parse_qs

PORT = 5005

class ThermalSimulation:
    def __init__(self):
        self.interval = 5  # minutes
        self.current_tick = 0
        self.last_update = time.time()
        self.anomalies = self._generate_anomalies(6)
        
    def _generate_anomalies(self, count):
        anomalies = []
        for _ in range(count):
            anomalies.append({
                'lat': random.uniform(-60, 60),
                'lng': random.uniform(-180, 180),
                'intensity': random.uniform(-20, 20),
                'radius': random.uniform(10, 30),
                'drift_speed': random.uniform(0.5, 2.0)
            })
        return anomalies
        
    def tick(self):
        self.current_tick += 1
        self.last_update = time.time()
        # Drift anomalies eastwards
        for a in self.anomalies:
            a['lng'] += a['drift_speed']
            if a['lng'] > 180:
                a['lng'] -= 360
                
    def get_data(self):
        # Generate grid
        points = []
        min_temp = float('inf')
        max_temp = float('-inf')
        sum_temp = 0
        
        # Grid steps of 4 degrees
        for lat in range(-90, 91, 4):
            for lng in range(-180, 181, 4):
                # Base temp based on latitude (-30C at poles, 35C at equator)
                lat_rad = math.radians(lat)
                base_temp = 35 * math.cos(lat_rad) - 30 * (1 - math.cos(lat_rad))
                
                # Diurnal cycle (time of day based on longitude and tick)
                # Let's say tick simulates hours if we want, or just a continuous offset
                time_offset = (self.current_tick * 15) % 360 # 15 degrees per tick
                diurnal = 5 * math.cos(math.radians(lng - time_offset))
                
                temp = base_temp + diurnal
                
                # Add anomalies
                for a in self.anomalies:
                    dist = math.sqrt((lat - a['lat'])**2 + (lng - a['lng'])**2)
                    if dist < a['radius']:
                        # Gaussian decay
                        temp += a['intensity'] * math.exp(-0.5 * (dist / (a['radius'] / 3))**2)
                        
                points.append({
                    'lat': lat,
                    'lng': lng,
                    'temp': round(temp, 2)
                })
                
                if temp < min_temp: min_temp = temp
                if temp > max_temp: max_temp = temp
                sum_temp += temp
                
        avg_temp = sum_temp / len(points)
        
        return {
            'points': points,
            'stats': {
                'min': round(min_temp, 1),
                'max': round(max_temp, 1),
                'avg': round(avg_temp, 1)
            },
            'tick': self.current_tick,
            'interval': self.interval,
            'last_update': self.last_update
        }

sim = ThermalSimulation()

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory="static", **kwargs)

    def do_GET(self):
        parsed_path = urlparse(self.path)
        if parsed_path.path == '/api/data':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            data = sim.get_data()
            self.wfile.write(json.dumps(data).encode('utf-8'))
        else:
            if self.path == '/':
                self.path = '/index.html'
            super().do_GET()
            
    def do_POST(self):
        parsed_path = urlparse(self.path)
        if parsed_path.path == '/api/settings':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            try:
                payload = json.loads(post_data.decode('utf-8'))
                if 'action' in payload and payload['action'] == 'force_update':
                    sim.tick()
                if 'interval' in payload:
                    sim.interval = int(payload['interval'])
                    
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "ok"}).encode('utf-8'))
            except Exception as e:
                self.send_response(400)
                self.end_headers()
        else:
            self.send_response(404)
            self.end_headers()

if __name__ == "__main__":
    with socketserver.TCPServer(("", PORT), CustomHandler) as httpd:
        print(f"Serving at http://localhost:{PORT}")
        httpd.serve_forever()
