import React from 'react';
import { Play } from 'lucide-react';
import type { Song } from './Player';

interface SongListProps {
    songs: Song[];
    onPlay: (song: Song) => void;
    onDownload: (song: Song) => void;
}

export const SongList: React.FC<SongListProps> = ({ songs, onPlay, onDownload }) => {
    if (songs.length === 0) {
        return (
            <div className="text-center py-20">
                <div className="text-6xl mb-4 opacity-20">🎵</div>
                <p className="text-gray-500 text-lg">No songs found</p>
            </div>
        );
    }

    return (
        <div className="space-y-1">
            {songs.map((song, index) => (
                <div
                    key={song.id}
                    className="group flex items-center gap-4 p-3 rounded-lg hover:bg-white/5 transition-all cursor-pointer"
                    onClick={() => onPlay(song)}
                >
                    {/* Index/Play Button */}
                    <div className="w-8 text-center flex-shrink-0">
                        <span className="text-gray-500 text-sm group-hover:hidden tabular-nums">
                            {index + 1}
                        </span>
                        <Play
                            size={16}
                            fill="currentColor"
                            className="text-white hidden group-hover:inline-block mx-auto"
                        />
                    </div>

                    {/* Album Art */}
                    <div className="relative w-12 h-12 rounded-md overflow-hidden flex-shrink-0 shadow-sm">
                        <img
                            src={song.picUrl}
                            alt={song.name}
                            className="w-full h-full object-cover"
                        />
                    </div>

                    {/* Song Info */}
                    <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-white truncate text-base group-hover:text-purple-300 transition-colors">
                            {song.name}
                        </h4>
                        <p className="text-sm text-gray-400 truncate">
                            {song.artists}
                        </p>
                    </div>

                    {/* Album */}
                    <div className="hidden md:block flex-1 min-w-0">
                        <p className="text-sm text-gray-400 truncate">
                            {song.album}
                        </p>
                    </div>

                    {/* Duration placeholder */}
                    <div className="w-12 text-right text-sm text-gray-500 tabular-nums">
                        --:--
                    </div>
                </div>
            ))}
        </div>
    );
};
