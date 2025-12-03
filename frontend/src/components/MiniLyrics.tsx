import React, { useEffect, useState } from 'react';
import { Maximize2, X } from 'lucide-react';
import type { Song } from '../types';
import { lrctran } from '../utils/musicUtils';

interface MiniLyricsProps {
    song: Song | null;
    currentTime: number;
    onExpand: () => void;
    onClose: () => void;
}

export const MiniLyrics: React.FC<MiniLyricsProps> = ({ song, currentTime, onExpand, onClose }) => {
    const [parsedLyrics, setParsedLyrics] = useState<{ time: number; text: string }[]>([]);

    useEffect(() => {
        if (song?.lyric) {
            let finalLyric = song.lyric;
            if (song.tlyric) {
                finalLyric = lrctran(song.lyric, song.tlyric);
            }

            const lines = finalLyric.split('\n').map(line => {
                const match = line.match(/\[(\d{2}):(\d{2}[\.:]?\d*)]/);
                if (match) {
                    const minutes = parseInt(match[1], 10);
                    const seconds = parseFloat(match[2].replace('.', ':'));
                    const time = minutes * 60 + seconds;
                    const text = line.replace(/\[\d{2}:\d{2}[\.:]?\d*\]/g, '').trim();
                    return { time, text };
                }
                return null;
            }).filter((item): item is { time: number; text: string } => item !== null && item.text.trim() !== '');

            setParsedLyrics(lines);
        } else {
            setParsedLyrics([]);
        }
    }, [song]);

    if (!song || parsedLyrics.length === 0) {
        return null;
    }

    // Find current and next lines
    const activeIndex = parsedLyrics.findIndex((line, index) => {
        const nextLine = parsedLyrics[index + 1];
        return currentTime >= line.time && (!nextLine || currentTime < nextLine.time);
    });

    const currentLine = activeIndex >= 0 ? parsedLyrics[activeIndex] : null;
    const nextLine = activeIndex >= 0 && activeIndex < parsedLyrics.length - 1 ? parsedLyrics[activeIndex + 1] : null;

    return (
        <div
            className="fixed right-8 bottom-32 z-40 w-96 glass-dark rounded-2xl p-6 border border-white/10 shadow-2xl cursor-pointer group hover:border-purple-500/30 transition-all duration-300"
            onClick={onExpand}
        >
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg shadow-md overflow-hidden bg-gray-800 flex-shrink-0">
                         {song.picUrl ? (
                            <img
                                src={song.picUrl}
                                alt={song.name}
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = 'none';
                                }}
                            />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-600">
                                🎵
                            </div>
                        )}
                    </div>
                    <div className="min-w-0">
                        <h4 className="text-sm font-semibold text-white truncate">{song.name}</h4>
                        <p className="text-xs text-gray-400 truncate">{song.artists}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onExpand();
                        }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-white p-1 hover:bg-white/10 rounded"
                        title="Expand"
                    >
                        <Maximize2 size={16} />
                    </button>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onClose();
                        }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-white p-1 hover:bg-white/10 rounded"
                        title="Close"
                    >
                        <X size={16} />
                    </button>
                </div>
            </div>

            {/* Lyrics */}
            <div className="space-y-3 overflow-hidden">
                {currentLine && (
                    <div className="transition-all duration-500">
                        <p className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400 leading-tight animate-fade-in-up">
                            {currentLine.text}
                        </p>
                    </div>
                )}
                {nextLine && (
                    <div className="transition-all duration-500">
                        <p className="text-base text-gray-500 leading-relaxed">
                            {nextLine.text}
                        </p>
                    </div>
                )}
                {!currentLine && parsedLyrics.length > 0 && (
                    <p className="text-gray-500 text-sm">♪ Music playing...</p>
                )}
            </div>

            {/* Hint */}
            <div className="mt-4 pt-4 border-t border-white/5">
                <p className="text-xs text-gray-500 text-center opacity-0 group-hover:opacity-100 transition-opacity">
                    Click to view full lyrics
                </p>
            </div>
        </div>
    );
};
