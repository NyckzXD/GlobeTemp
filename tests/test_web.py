import http.client
import json
import threading

import pytest

from globetemp.web import make_server


@pytest.fixture
def client(make_service):
    httpd = make_server(make_service(), host='127.0.0.1', port=0)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()

    def request(method, path, body=None, headers=None):
        conn = http.client.HTTPConnection('127.0.0.1', httpd.server_address[1], timeout=5)
        conn.request(method, path, body=body, headers=headers or {})
        resp = conn.getresponse()
        data = resp.read()
        conn.close()
        return resp, data

    yield request
    httpd.shutdown()
    httpd.server_close()


def post_json(client, payload, content_type='application/json'):
    body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
    resp, data = client('POST', '/api/settings', body, {'Content-Type': content_type})
    return resp.status, json.loads(data or b'{}')


def test_get_data(client):
    resp, data = client('GET', '/api/data')
    assert resp.status == 200
    assert resp.getheader('Cache-Control') == 'no-store'
    assert len(json.loads(data)['grid']['values'][0]) == 1891


def test_static_files_and_js_mime_type(client):
    resp, body = client('GET', '/')
    assert resp.status == 200
    assert b'js/main.js' in body
    assert resp.getheader('Cache-Control') == 'no-cache'

    resp, _ = client('GET', '/js/main.js')
    assert resp.status == 200
    assert resp.getheader('Content-Type').startswith('text/javascript')


def test_interval_setting(client):
    assert post_json(client, {'interval': 15}) == (200, {'status': 'ok', 'interval': 360})


def test_force_update_then_cooldown(client):
    status, result = post_json(client, {'action': 'force_update'})
    assert (status, result['refresh']) == (200, 'queued')
    status, result = post_json(client, {'action': 'force_update'})
    assert (status, result['refresh']) == (200, 'cooldown')


@pytest.mark.parametrize(
    ('payload', 'content_type', 'status'),
    [
        ({'interval': 'x'}, 'application/json', 400),
        ({'interval': True}, 'application/json', 400),
        ([1, 2], 'application/json', 400),
        (b'{nope', 'application/json', 400),
        ({'action': 'force_update'}, 'application/x-www-form-urlencoded', 415),
        (b'{"a": "' + b'x' * 2000 + b'"}', 'application/json', 413),
    ],
)
def test_settings_validation(client, payload, content_type, status):
    got, result = post_json(client, payload, content_type)
    assert got == status
    assert 'error' in result


def test_unknown_post_route(client):
    resp, _ = client('POST', '/api/nope', b'{}', {'Content-Type': 'application/json'})
    assert resp.status == 404
