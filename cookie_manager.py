from typing import Dict

from config import settings


class CookieManager:
    def __init__(self, music_u: str = None):
        if music_u is None:
            music_u = settings.MUSIC_U
        self.music_u = music_u.strip()

    def read_cookie(self) -> str:
        return f'MUSIC_U={self.music_u};os={settings.OS};appver={settings.APPVER};deviceId={settings.DEVICE_ID};'

    @staticmethod
    def parse_cookie(text: str) -> Dict[str, str]:
        cookie_ = [item.strip().split('=', 1) for item in text.strip().split(';') if item]
        cookie_ = {k.strip(): v.strip() for k, v in cookie_}
        return cookie_
