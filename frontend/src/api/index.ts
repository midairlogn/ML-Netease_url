import axios from 'axios';

// In development, Vite proxy handles the base URL. In production, it's relative.
const api = axios.create({
    baseURL: '/',
    headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
    },
});

export const searchSongs = async (keywords: string, limit: number = 10) => {
    const response = await api.get('/Search', { params: { keywords, limit } });
    return response.data;
};

export const getSongDetail = async (ids: string, level: string = 'lossless') => {
    // The backend expects form data for POST requests usually, but let's check main.py
    // main.py handles both GET and POST. POST uses form.get, GET uses args.get.
    // Using POST with form data is safer for long IDs/URLs.
    const params = new URLSearchParams();
    params.append('ids', ids);
    params.append('level', level);
    params.append('type', 'json');

    const response = await api.post('/Song_V1', params);
    return response.data;
};

export const getPlaylist = async (id: string) => {
    const response = await api.get('/Playlist', { params: { id } });
    return response.data;
};

export const getAlbum = async (id: string) => {
    const response = await api.get('/Album', { params: { id } });
    return response.data;
};
