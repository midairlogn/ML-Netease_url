import React, { useState } from 'react';
import { ListMusic, Loader2, Music2 } from 'lucide-react';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import { SongList } from './SongList';
import { getPlaylist } from '../api';
import type { Song } from './Player';

interface PlaylistViewProps {
    onPlaySong: (song: Song) => void;
    onDownloadSong: (song: Song) => void;
}

export const PlaylistView: React.FC<PlaylistViewProps> = ({ onPlaySong, onDownloadSong }) => {
    const [id, setId] = useState('');
    const [loading, setLoading] = useState(false);
    const [playlist, setPlaylist] = useState<any>(null);

    const handleFetch = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!id.trim()) return;

        let pid = id.trim();
        const idMatch = pid.match(/playlist\?id=(\d+)/);
        if (idMatch) pid = idMatch[1];

        setLoading(true);
        try {
            const data = await getPlaylist(pid);
            if (data.status === 200) {
                setPlaylist(data.playlist);
            } else {
                alert(data.msg || 'Failed to fetch playlist');
            }
        } catch (error) {
            console.error("Fetch failed", error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-[70vh] flex flex-col items-center justify-center px-6">
            {!playlist ? (
                <div className="w-full max-w-2xl mx-auto text-center">
                    {/* Icon and Title */}
                    <div className="mb-12 animate-float">
                        <div className="inline-flex items-center justify-center w-24 h-24 rounded-full glass-dark border border-white/10 mb-6">
                            <ListMusic size={40} className="text-purple-400" />
                        </div>
                        <h2 className="text-4xl font-bold gradient-text mb-3">
                            Explore Playlists
                        </h2>
                        <p className="text-gray-400 text-lg">
                            Enter a playlist ID or URL to discover amazing music collections
                        </p>
                    </div>

                    {/* Input Form */}
                    <form onSubmit={handleFetch} className="space-y-4">
                        <div className="relative">
                            <Music2 className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400" size={22} />
                            <Input
                                value={id}
                                onChange={(e) => setId(e.target.value)}
                                placeholder="Playlist ID or URL..."
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
                                    Loading Playlist
                                </>
                            ) : (
                                'Load Playlist'
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
                                setPlaylist(null);
                                setId('');
                            }}
                        >
                            ← Back
                        </Button>
                    </div>

                    {/* Playlist Header */}
                    <div className="glass-dark rounded-3xl p-8 shadow-2xl border border-white/10 mb-6">
                        <div className="flex items-start gap-8">
                            <div className="relative group flex-shrink-0">
                                <div className="absolute -inset-4 bg-gradient-to-br from-purple-500/40 via-pink-500/40 to-orange-500/40 rounded-3xl blur-2xl opacity-60 group-hover:opacity-80 transition-opacity" />
                                <img
                                    src={playlist.coverImgUrl}
                                    alt={playlist.name}
                                    className="relative w-56 h-56 rounded-2xl shadow-2xl object-cover transform group-hover:scale-105 transition-transform duration-500"
                                />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="text-sm text-purple-400 font-medium mb-2">PLAYLIST</div>
                                <h1 className="text-5xl font-bold text-white mb-4 leading-tight">{playlist.name}</h1>
                                {playlist.description && (
                                    <p className="text-gray-400 text-base mb-6 line-clamp-3 leading-relaxed">{playlist.description}</p>
                                )}
                                <div className="flex items-center gap-6 text-sm">
                                    <div>
                                        <span className="text-gray-400">Created by </span>
                                        <span className="text-white font-medium">{playlist.creator}</span>
                                    </div>
                                    <div className="w-1 h-1 rounded-full bg-gray-600"></div>
                                    <div>
                                        <span className="text-white font-medium">{playlist.trackCount}</span>
                                        <span className="text-gray-400"> tracks</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Tracks List */}
                    <div className="glass-dark rounded-3xl p-6 shadow-2xl border border-white/10">
                        <SongList songs={playlist.tracks} onPlay={onPlaySong} onDownload={onDownloadSong} />
                    </div>
                </div>
            )}
        </div>
    );
};
