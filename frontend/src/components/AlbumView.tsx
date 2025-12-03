import React, { useState } from 'react';
import { Disc, Loader2, Album } from 'lucide-react';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import { SongList } from './SongList';
import { getAlbum } from '../api';
import type { Song } from '../types';

interface AlbumViewProps {
    onPlaySong: (song: Song) => void;
    onDownloadSong: (song: Song) => void;
}

export const AlbumView: React.FC<AlbumViewProps> = ({ onPlaySong, onDownloadSong }) => {
    const [id, setId] = useState('');
    const [loading, setLoading] = useState(false);
    const [album, setAlbum] = useState<any>(null);

    const handleFetch = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!id.trim()) return;

        let aid = id.trim();
        const idMatch = aid.match(/album\?id=(\d+)/);
        if (idMatch) aid = idMatch[1];

        setLoading(true);
        try {
            const data = await getAlbum(aid);
            if (data.status === 200) {
                setAlbum(data.album);
            } else {
                alert(data.msg || 'Failed to fetch album');
            }
        } catch (error) {
            console.error("Fetch failed", error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-[70vh] flex flex-col items-center justify-center px-6">
            {!album ? (
                <div className="w-full max-w-2xl mx-auto text-center">
                    {/* Icon and Title */}
                    <div className="mb-12 animate-float">
                        <div className="inline-flex items-center justify-center w-24 h-24 rounded-full glass-dark border border-white/10 mb-6">
                            <Disc size={40} className="text-pink-400" />
                        </div>
                        <h2 className="text-4xl font-bold gradient-text mb-3">
                            Browse Albums
                        </h2>
                        <p className="text-gray-400 text-lg">
                            Enter an album ID or URL to explore complete discographies
                        </p>
                    </div>

                    {/* Input Form */}
                    <form onSubmit={handleFetch} className="space-y-4">
                        <div className="relative">
                            <Album className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400" size={22} />
                            <Input
                                value={id}
                                onChange={(e) => setId(e.target.value)}
                                placeholder="Album ID or URL..."
                                className="pl-14 h-16 text-lg"
                                autoFocus
                            />
                        </div>

                        <Button
                            type="submit"
                            size="lg"
                            disabled={loading || !id.trim()}
                            className="px-12"
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="animate-spin mr-2" size={20} />
                                    Loading Album
                                </>
                            ) : (
                                'Load Album'
                            )}
                        </Button>
                    </form>
                </div>
            ) : (
                <div className="w-full max-w-6xl mx-auto animate-scale-in">
                    {/* Back button */}
                    <div className="mb-6">
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                                setAlbum(null);
                                setId('');
                            }}
                        >
                            ← Back
                        </Button>
                    </div>

                    {/* Album Header */}
                    <div className="glass-dark rounded-3xl p-8 shadow-2xl border border-white/10 mb-6">
                        <div className="flex items-start gap-8">
                            <div className="relative group flex-shrink-0">
                                <div className="absolute -inset-4 bg-gradient-to-br from-pink-500/40 via-purple-500/40 to-blue-500/40 rounded-3xl blur-2xl opacity-60 group-hover:opacity-80 transition-opacity" />
                                <img
                                    src={album.coverImgUrl}
                                    alt={album.name}
                                    className="relative w-56 h-56 rounded-2xl shadow-2xl object-cover transform group-hover:scale-105 transition-transform duration-500"
                                />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="text-sm text-pink-400 font-medium mb-2">ALBUM</div>
                                <h1 className="text-5xl font-bold text-white mb-4 leading-tight">{album.name}</h1>
                                {album.description && (
                                    <p className="text-gray-400 text-base mb-6 line-clamp-3 leading-relaxed">{album.description}</p>
                                )}
                                <div className="flex items-center gap-6 text-sm">
                                    <div>
                                        <span className="text-white font-medium">{album.artist}</span>
                                    </div>
                                    <div className="w-1 h-1 rounded-full bg-gray-600"></div>
                                    <div>
                                        <span className="text-white font-medium">{album.songs.length}</span>
                                        <span className="text-gray-400"> tracks</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Tracks List */}
                    <div className="glass-dark rounded-3xl p-6 shadow-2xl border border-white/10">
                        <SongList songs={album.songs} onPlay={onPlaySong} onDownload={onDownloadSong} />
                    </div>
                </div>
            )}
        </div>
    );
};
