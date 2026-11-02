import http.server
import json
import logging
from urllib.parse import urlparse

from . import config

log = logging.getLogger('globetemp')


class RequestHandler(http.server.SimpleHTTPRequestHandler):
    """Serve `static/` e a API. O serviço de temperatura fica em `self.server.service`."""

    # ES modules exigem MIME de JavaScript; no Windows o registro pode mapear .js errado
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(config.STATIC_DIR), **kwargs)

    @property
    def service(self):
        return self.server.service

    def end_headers(self):
        # A API nunca é cacheada; os arquivos estáticos são revalidados (If-Modified-Since)
        if urlparse(self.path).path.startswith('/api/'):
            self.send_header('Cache-Control', 'no-store')
        else:
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, format, *args):
        log.debug("%s - %s", self.address_string(), format % args)

    def _send_json(self, status, obj):
        body = json.dumps(obj).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if urlparse(self.path).path == '/api/data':
            self._send_json(200, self.service.get_data())
        else:
            super().do_GET()

    def do_POST(self):
        if urlparse(self.path).path != '/api/settings':
            self._send_json(404, {'error': 'not found'})
            return

        # Exigir JSON também impede que outras páginas abertas no navegador façam um
        # POST "simples" (form) para cá sem preflight de CORS.
        ctype = (self.headers.get('Content-Type') or '').split(';')[0].strip().lower()
        if ctype != 'application/json':
            self._send_json(415, {'error': 'Content-Type must be application/json'})
            return
        try:
            length = int(self.headers.get('Content-Length', ''))
        except ValueError:
            self._send_json(411, {'error': 'Content-Length required'})
            return
        if length < 0 or length > config.MAX_POST_BYTES:
            self._send_json(413, {'error': 'payload too large'})
            return

        try:
            payload = json.loads(self.rfile.read(length).decode('utf-8'))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._send_json(400, {'error': 'invalid JSON'})
            return
        if not isinstance(payload, dict):
            self._send_json(400, {'error': 'expected a JSON object'})
            return

        result = {'status': 'ok'}
        if 'interval' in payload:
            value = payload['interval']
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                self._send_json(400, {'error': 'interval must be a number of minutes'})
                return
            result['interval'] = self.service.set_interval(value)
        if payload.get('action') == 'force_update':
            accepted, seconds = self.service.request_refresh()
            result['refresh'] = 'queued' if accepted else 'cooldown'
            result['retry_after'] = seconds
        self._send_json(200, result)


def make_server(service, host=config.HOST, port=config.PORT):
    httpd = http.server.ThreadingHTTPServer((host, port), RequestHandler)
    httpd.service = service
    return httpd
