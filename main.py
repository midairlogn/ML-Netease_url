import argparse
import logging

from flask import Flask, jsonify, redirect, render_template, request

from config import settings
from cookie_manager import CookieManager
from music_api import album_detail, lyric_v1, name_v1, playlist_detail, search_music, url_v1

logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL, logging.INFO),
    format='%(asctime)s %(levelname)s [%(name)s] %(message)s',
)
logger = logging.getLogger(__name__)

# ================= 工具函数 =================
cookie_manager = CookieManager()


def ids(ids: str) -> str:
    if '163cn.tv' in ids:
        import requests

        response = requests.get(ids, allow_redirects=False, timeout=10)
        ids = response.headers.get('Location')
    if 'music.163.com' in ids:
        index = ids.find('id=') + 3
        ids = ids[index:].split('&')[0]
    return ids


def size(value: float) -> str:
    units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
    size = 1024.0
    for i in range(len(units)):
        if (value / size) < 1:
            return '%.2f%s' % (value, units[i])
        value = value / size
    return str(value)


def music_level1(value: str) -> str:
    levels = {
        'standard': '标准音质',
        'exhigh': '极高音质',
        'lossless': '无损音质',
        'hires': 'Hires音质',
        'sky': '沉浸环绕声',
        'jyeffect': '高清环绕声',
        'jymaster': '超清母带',
    }
    return levels.get(value, '未知音质')


# ================= Flask 应用 =================
app = Flask(__name__)


def _apply_cors_headers(response):
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')

    origins = settings.cors_origins
    if not origins:
        return response

    request_origin = request.headers.get('Origin', '').strip()
    if len(origins) == 1 and origins[0] == '*':
        response.headers.add('Access-Control-Allow-Origin', '*')
        return response

    if request_origin and request_origin in origins:
        response.headers.add('Access-Control-Allow-Origin', request_origin)
        response.headers.add('Vary', 'Origin')

    return response


@app.after_request
def after_request(response):
    return _apply_cors_headers(response)


@app.route('/', methods=['GET', 'POST'])
def index():
    logger.debug('Rendering index page')
    return render_template('ml-index.html')


@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok'}), 200


@app.route('/Song_V1', methods=['GET', 'POST'])
def Song_v1():
    if request.method == 'GET':
        song_ids = request.args.get('ids')
        url = request.args.get('url')
        level = request.args.get('level')
        type_ = request.args.get('type')
    else:
        song_ids = request.form.get('ids')
        url = request.form.get('url')
        level = request.form.get('level')
        type_ = request.form.get('type')

    if not song_ids and not url:
        logger.warning('Song_V1 missing ids/url parameter')
        return jsonify({'error': '必须提供 ids 或 url 参数'}), 400
    if not level:
        logger.warning('Song_V1 missing level parameter')
        return jsonify({'error': 'level参数为空'}), 400
    if not type_:
        logger.warning('Song_V1 missing type parameter')
        return jsonify({'error': 'type参数为空'}), 400

    jsondata = song_ids if song_ids else url
    try:
        cookies = cookie_manager.parse_cookie(cookie_manager.read_cookie())
        song_id = ids(jsondata)
        urlv1 = url_v1(song_id, level, cookies)
        if not urlv1['data'] or urlv1['data'][0]['url'] is None:
            logger.warning('Song_V1 incomplete url_v1 response for song_id=%s', song_id)
            return jsonify({'status': 400, 'msg': '信息获取不完整！'}), 400
        namev1 = name_v1(urlv1['data'][0]['id'])
        lyricv1 = lyric_v1(urlv1['data'][0]['id'], cookies)
        song_data = urlv1['data'][0]
        song_info = namev1['songs'][0] if namev1['songs'] else {}
        song_url = song_data['url']
        song_name = song_info.get('name', '')
        song_picUrl = song_info.get('al', {}).get('picUrl', '')
        song_alname = song_info.get('al', {}).get('name', '')
        if not song_name and not song_picUrl and not song_alname:
            logger.warning('Song_V1 incomplete song metadata for song_id=%s', song_id)
            return jsonify({'status': 400, 'msg': '信息获取不完整！'}), 400
        artist_names = []
        for song in namev1['songs']:
            ar_list = song.get('ar', [])
            if ar_list:
                artist_names.append('/'.join(ar['name'] for ar in ar_list))
        song_arname = ', '.join(artist_names)
        lyric = lyricv1.get('lrc', {}).get('lyric', '')
        tlyric = lyricv1.get('tlyric', {}).get('lyric', None)
    except Exception:
        logger.exception('Song_V1 failed')
        return jsonify({'status': 500, 'msg': '服务异常，请查看服务日志'}), 500

    if type_ == 'text':
        data = (
            f'歌曲名称：{song_name}<br>歌曲图片：{song_picUrl}<br>歌手：{song_arname}<br>'
            f'歌曲专辑：{song_alname}<br>歌曲音质：{music_level1(song_data["level"])}<br>'
            f'歌曲大小：{size(song_data["size"])}<br>音乐地址：{song_url}'
        )
    elif type_ == 'down':
        data = redirect(song_url)
    elif type_ == 'json':
        data = jsonify(
            {
                'status': 200,
                'name': song_name,
                'pic': song_picUrl,
                'ar_name': song_arname,
                'al_name': song_alname,
                'level': music_level1(song_data['level']),
                'size': size(song_data['size']),
                'url': song_url.replace('http://', 'https://', 1),
                'lyric': lyric,
                'tlyric': tlyric,
                'id': song_data['id'],
            }
        )
    else:
        logger.warning('Song_V1 invalid type parameter: %s', type_)
        data = jsonify({'status': 400, 'msg': '解析失败！请检查参数是否完整！'}), 400
    return data


@app.route('/Search', methods=['GET', 'POST'])
def search():
    if request.method == 'GET':
        keywords = request.args.get('keywords')
        limit = request.args.get('limit', default=10, type=int)
    else:
        keywords = request.form.get('keywords')
        limit = int(request.form.get('limit', 10))
    if not keywords:
        logger.warning('Search missing keywords parameter')
        return jsonify({'error': '必须提供 keywords 参数'}), 400
    try:
        cookies = cookie_manager.parse_cookie(cookie_manager.read_cookie())
        songs = search_music(keywords, cookies, limit=limit)
        return jsonify({'status': 200, 'result': songs})
    except Exception:
        logger.exception('Search failed for keywords=%s', keywords)
        return jsonify({'status': 500, 'msg': '搜索异常，请查看服务日志'}), 500


@app.route('/Playlist', methods=['GET', 'POST'])
def playlist():
    if request.method == 'GET':
        playlist_id = request.args.get('id')
    else:
        playlist_id = request.form.get('id')
    if not playlist_id:
        logger.warning('Playlist missing id parameter')
        return jsonify({'error': '必须提供歌单id参数'}), 400
    try:
        cookies = cookie_manager.parse_cookie(cookie_manager.read_cookie())
        info = playlist_detail(playlist_id, cookies)
        return jsonify({'status': 200, 'playlist': info})
    except Exception:
        logger.exception('Playlist failed for id=%s', playlist_id)
        return jsonify({'status': 500, 'msg': '歌单解析异常，请查看服务日志'}), 500


@app.route('/Album', methods=['GET', 'POST'])
def album():
    if request.method == 'GET':
        album_id = request.args.get('id')
    else:
        album_id = request.form.get('id')
    if not album_id:
        logger.warning('Album missing id parameter')
        return jsonify({'error': '必须提供专辑id参数'}), 400
    try:
        cookies = cookie_manager.parse_cookie(cookie_manager.read_cookie())
        info = album_detail(album_id, cookies)
        return jsonify({'status': 200, 'album': info})
    except Exception:
        logger.exception('Album failed for id=%s', album_id)
        return jsonify({'status': 500, 'msg': '专辑解析异常，请查看服务日志'}), 500


# ================= 命令行启动 =================
def start_gui(url: str = None, level: str = 'lossless'):
    target_url = url or settings.URL
    target_level = level or settings.LEVEL
    if target_url:
        logger.info('Processing GUI request for URL: %s, level: %s', target_url, target_level)
        try:
            cookies = cookie_manager.parse_cookie(cookie_manager.read_cookie())
            song_ids = ids(target_url)
            urlv1 = url_v1(song_ids, target_level, cookies)
            namev1 = name_v1(urlv1['data'][0]['id'])
            lyricv1 = lyric_v1(urlv1['data'][0]['id'], cookies)
            song_info = namev1['songs'][0]
            song_name = song_info['name']
            song_pic = song_info['al']['picUrl']
            artist_names = ', '.join(artist['name'] for artist in song_info['ar'])
            album_name = song_info['al']['name']
            music_quality = music_level1(urlv1['data'][0]['level'])
            file_size = size(urlv1['data'][0]['size'])
            music_url = urlv1['data'][0]['url']
            lyrics = lyricv1.get('lrc', {}).get('lyric', '')
            translated_lyrics = lyricv1.get('tlyric', {}).get('lyric', None)
            output_text = f"""
            歌曲名称: {song_name}
            歌曲图片: {song_pic}
            歌手: {artist_names}
            专辑名称: {album_name}
            音质: {music_quality}
            大小: {file_size}
            音乐链接: {music_url}
            歌词: {lyrics}
            翻译歌词: {translated_lyrics if translated_lyrics else '没有翻译歌词'}
            """
            print(output_text)
        except Exception:
            logger.exception('GUI mode failed')
            print('发生错误，请查看服务日志')
    else:
        print('没有提供 URL 参数')


def start_api():
    logger.info('Starting Flask development server on %s:%s', settings.APP_HOST, settings.APP_PORT)
    app.run(host=settings.APP_HOST, port=settings.APP_PORT, debug=False)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='启动 API 或 GUI')
    parser.add_argument('--mode', choices=['api', 'gui'], default=settings.MODE, help='选择启动模式：api 或 gui')
    parser.add_argument('--url', default=settings.URL, help='提供 URL 参数供 GUI 模式使用')
    parser.add_argument(
        '--level',
        default=settings.LEVEL,
        choices=['standard', 'exhigh', 'lossless', 'hires', 'sky', 'jyeffect', 'jymaster'],
        help='选择音质等级，默认是 lossless',
    )
    args = parser.parse_args()

    if args.mode == 'api':
        start_api()
    elif args.mode == 'gui':
        start_gui(args.url, args.level)
