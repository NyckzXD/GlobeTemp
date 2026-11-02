import logging

from . import config
from .service import TemperatureService
from .web import make_server

log = logging.getLogger('globetemp')


def main():
    logging.basicConfig(
        level=config.LOG_LEVEL,
        format='%(asctime)s %(levelname)-7s %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S',
    )
    with make_server(TemperatureService()) as httpd:
        host = 'localhost' if config.HOST in ('127.0.0.1', '') else config.HOST
        log.info('Serving at http://%s:%s', host, config.PORT)
        httpd.serve_forever()


if __name__ == '__main__':
    main()
