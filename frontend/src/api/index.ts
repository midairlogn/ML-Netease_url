import type { Song } from '../types';

const getBaseUrl = () => {
    // Check if we are in development mode (using Vite proxy)
    if (import.meta.env.DEV) {
        return '/api';
    }
    // In production/deployment, fallback to local storage or default
    let url = localStorage.getItem('apiBaseUrl') || 'https://music.163.com/api';
    return url.replace(/\/$/, '');
};

const getCookie = () => {
    return localStorage.getItem('musicu') || '';
};

// Helper to handle requests with cookie logic if needed
// Note: Direct browser requests to music.163.com will block 'Cookie' header.
// This code assumes the user has a way to handle CORS/Headers (e.g. extension, proxy, or electron)
const fetchWithConfig = async (url: string, options: RequestInit = {}) => {
    const musicu = getCookie();

    // If we are using a proxy that supports passing cookies via query or custom header, we could add it here.
    // For now, we'll try to add it to credentials if same-origin, or just rely on the API being open.
    // Standard Netease API checks the 'MUSIC_U' cookie.

    // Some CORS proxies might accept a custom header for cookies
    const headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...options.headers,
    } as Record<string, string>;

    if (musicu) {
        // Try to pass cookie. Warning: Browser may block this for cross-origin.
        // headers['Cookie'] = `MUSIC_U=${musicu};`;
    }

    const res = await fetch(url, {
        ...options,
        headers,
        // credentials: 'include' // Use this if the API is on the same domain or properly configured for CORS credentials
    });
    return res.json();
};

import { getPicUrl } from '../utils/musicUtils';

// Helper to normalize image URLs (add param and ensure https)
const normalizePicUrl = (url: string | null | undefined, picId?: number | string) => {
    if (url) {
        let newUrl = url.replace(/^http:\/\//, 'https://');
        if (!newUrl.includes('?param=')) {
            newUrl += '?param=300y300';
        }
        return newUrl;
    }
    if (picId) {
        return getPicUrl(picId, 300);
    }
    return '';
};

export const searchSongs = async (keywords: string, limit: number = 10) => {
    try {
        const baseUrl = getBaseUrl();
        // Using the old API endpoint which is easier to use without encryption
        const params = new URLSearchParams({
            s: keywords,
            type: '1',
            limit: limit.toString(),
            offset: '0',
            total: 'true'
        });

        const data = await fetchWithConfig(`${baseUrl}/search/get/web?${params}`);

        if (data.code === 200 && data.result && data.result.songs) {
            const songs: Song[] = data.result.songs.map((s: any) => ({
                id: s.id,
                name: s.name,
                artists: s.artists?.map((a: any) => a.name).join(', ') || 'Unknown',
                album: s.album?.name || 'Unknown',
                picUrl: normalizePicUrl(s.album?.picUrl, s.album?.picId),
                duration: s.duration / 1000
            }));
            return { status: 200, result: songs };
        }
        return { status: 200, result: [] };
    } catch (error) {
        console.error("Search API Error:", error);
        return { status: 500, msg: 'Search failed' };
    }
};

export const getPlaylist = async (id: string) => {
    try {
        const baseUrl = getBaseUrl();
        const data = await fetchWithConfig(`${baseUrl}/v3/playlist/detail?id=${id}&n=1000`);

        if (data.code === 200 && data.playlist) {
            const p = data.playlist;
            const tracks: Song[] = p.tracks.map((t: any) => ({
                id: t.id,
                name: t.name,
                artists: t.ar?.map((a: any) => a.name).join(', ') || 'Unknown',
                album: t.al?.name || 'Unknown',
                picUrl: normalizePicUrl(t.al?.picUrl),
                duration: (t.dt || 0) / 1000
            }));

            return {
                status: 200,
                playlist: {
                    name: p.name,
                    description: p.description,
                    coverImgUrl: normalizePicUrl(p.coverImgUrl),
                    creator: p.creator?.nickname || 'Unknown',
                    trackCount: p.trackCount,
                    tracks: tracks
                }
            };
        }
        return { status: 404, msg: 'Playlist not found' };
    } catch (error) {
        console.error("Playlist API Error:", error);
        return { status: 500, msg: 'Failed to fetch playlist' };
    }
};

export const getAlbum = async (id: string) => {
    try {
        const baseUrl = getBaseUrl();
        const data = await fetchWithConfig(`${baseUrl}/album/${id}`);

        if (data.code === 200 && data.album) {
            const a = data.album;
            const songs: Song[] = data.songs.map((s: any) => ({
                id: s.id,
                name: s.name,
                artists: s.artists?.map((art: any) => art.name).join(', ') || 'Unknown',
                album: a.name,
                picUrl: normalizePicUrl(a.picUrl),
                duration: (s.duration || 0) / 1000
            }));

            return {
                status: 200,
                album: {
                    name: a.name,
                    description: a.description,
                    coverImgUrl: normalizePicUrl(a.picUrl),
                    artist: a.artist?.name || 'Unknown',
                    songs: songs
                }
            };
        }
        return { status: 404, msg: 'Album not found' };
    } catch (error) {
        console.error("Album API Error:", error);
        return { status: 500, msg: 'Failed to fetch album' };
    }
};

export const getSongDetail = async (id: string) => {
    try {
        const baseUrl = getBaseUrl();

        // We need to fetch 3 things: Detail (for pic/info), URL, and Lyric
        const [detailData, urlData, lyricData] = await Promise.all([
            fetchWithConfig(`${baseUrl}/song/detail?ids=[${id}]`),
            fetchWithConfig(`${baseUrl}/song/enhance/player/url?ids=[${id}]&br=320000`),
            fetchWithConfig(`${baseUrl}/song/lyric?id=${id}&lv=-1&kv=-1&tv=-1`)
        ]);

        if (detailData.code === 200 && detailData.songs && detailData.songs.length > 0) {
            const songInfo = detailData.songs[0];
            const urlInfo = urlData.data?.[0];

            // Handle different artist field names (ar vs artists)
            const artists = songInfo.ar || songInfo.artists || [];
            const arName = artists.map((a: any) => a.name).join(', ') || 'Unknown';

            // Handle different album field names (al vs album)
            const album = songInfo.al || songInfo.album || {};
            const alName = album.name || 'Unknown';
            const alPicUrl = normalizePicUrl(album.picUrl, album.picId);

            // Construct the response expected by App.tsx
            return {
                status: 200,
                url: urlInfo?.url || null,
                lyric: lyricData.lrc?.lyric || '',
                tlyric: lyricData.tlyric?.lyric || '',
                pic: alPicUrl,
                name: songInfo.name,
                ar_name: arName,
                al_name: alName,
                msg: urlInfo?.url ? 'Success' : 'No URL found (VIP or Copyright restricted)'
            };
        }

        return { status: 404, msg: 'Song not found' };
    } catch (error) {
        console.error("Song Detail API Error:", error);
        return { status: 500, msg: 'Failed to fetch song details' };
    }
};
