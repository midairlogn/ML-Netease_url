import os
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover
    load_dotenv = None

ROOT_DIR = Path(__file__).resolve().parent

if load_dotenv is not None:
    load_dotenv(ROOT_DIR / '.env')


def _get_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None or value == '':
        return default
    try:
        return int(value)
    except ValueError:
        return default


def _get_list(name: str) -> list[str]:
    value = os.getenv(name, '')
    if not value:
        return []
    return [item.strip() for item in value.split(',') if item.strip()]


class AppConfig:
    APP_HOST = os.getenv('APP_HOST', '0.0.0.0')
    APP_PORT = _get_int('APP_PORT', 6969)
    MUSIC_U = os.getenv('MUSIC_U', '').strip()
    ALLOWED_ORIGIN = os.getenv('ALLOWED_ORIGIN', '').strip()
    ALLOWED_ORIGINS = _get_list('ALLOWED_ORIGINS')
    LOG_LEVEL = os.getenv('LOG_LEVEL', 'INFO').upper()
    MODE = os.getenv('MODE', 'api')
    LEVEL = os.getenv('LEVEL', 'lossless')
    URL = os.getenv('URL')

    @property
    def cors_origins(self) -> list[str]:
        if self.ALLOWED_ORIGINS:
            return self.ALLOWED_ORIGINS
        if self.ALLOWED_ORIGIN:
            return [self.ALLOWED_ORIGIN]
        return []


settings = AppConfig()
