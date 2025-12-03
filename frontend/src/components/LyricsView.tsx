import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { Song } from '../types';
import { lrctran } from '../utils/musicUtils';

interface LyricsViewProps {
    song: Song;
    onClose: () => void;
    currentTime: number;
}

export const LyricsView: React.FC<LyricsViewProps> = ({ song, onClose, currentTime }) => {
    const [parsedLyrics, setParsedLyrics] = useState<{ time: number; text: string }[]>([]);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (song.lyric) {
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
        }
    }, [song]);

    useEffect(() => {
        const activeIndex = parsedLyrics.findIndex((line, index) => {
            const nextLine = parsedLyrics[index + 1];
            return currentTime >= line.time && (!nextLine || currentTime < nextLine.time);
        });

        if (activeIndex !== -1 && scrollRef.current) {
            const container = scrollRef.current;
            const activeElement = container.children[activeIndex] as HTMLElement;
            if (activeElement) {
                const containerHeight = container.clientHeight;
                const elementTop = activeElement.offsetTop;
                const elementHeight = activeElement.clientHeight;
                const scrollTo = elementTop - (containerHeight / 2) + (elementHeight / 2);

                container.scrollTo({
                    top: scrollTo,
                    behavior: 'smooth'
                });
            }
        }
    }, [currentTime, parsedLyrics]);

    return (
        <div className="fixed inset-0 z-[60] bg-black flex flex-col">
            {/* Top Bar - Apple Music style */}
            <div className="flex items-center justify-between px-8 py-4 border-b border-white/5">
                <button
                    onClick={onClose}
                    className="flex items-center gap-2 text-purple-400 hover:text-purple-300 transition-colors"
                >
                    <ChevronDown size={24} />
                    <span className="text-sm font-medium">Back</span>
                </button>
                <div className="text-center flex-1">
                    <h3 className="text-sm font-medium text-white">{song.name}</h3>
                    <p className="text-xs text-gray-400 mt-0.5">{song.artists}</p>
                </div>
                <div className="w-24"></div> {/* Spacer for centering */}
            </div>

            {/* Content - Two Column Layout like Apple Music */}
            <div className="flex-1 flex items-center justify-center px-8 py-12 overflow-hidden">
                <div className="w-full max-w-7xl grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
                    {/* Left: Album Art */}
                    <div className="flex items-center justify-center">
                        <div className="relative w-full max-w-md aspect-square rounded-2xl shadow-2xl overflow-hidden bg-gray-800">
                            <div className="absolute -inset-8 bg-gradient-to-br from-purple-600/20 via-pink-600/20 to-orange-600/10 rounded-3xl blur-3xl z-[-1]" />
                             {song.picUrl ? (
                                <img
                                    src={song.picUrl}
                                    alt={song.name}
                                    className="relative w-full h-full object-cover"
                                    onError={(e) => {
                                        (e.target as HTMLImageElement).style.display = 'none';
                                    }}
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-gray-600">
                                    <div className="text-8xl">🎵</div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right: Lyrics */}
                    <div
                        ref={scrollRef}
                        className="h-[70vh] overflow-y-auto no-scrollbar pr-4"
                    >
                        <div className="space-y-6 py-8">
                            {parsedLyrics.map((line, index) => {
                                const isActive = currentTime >= line.time && (!parsedLyrics[index + 1] || currentTime < parsedLyrics[index + 1].time);
                                const isPast = parsedLyrics[index + 1] && currentTime >= parsedLyrics[index + 1].time;

                                return (
                                    <div
                                        key={index}
                                        className={`transition-all duration-300 ${isActive
                                                ? 'opacity-100'
                                                : isPast
                                                    ? 'opacity-30'
                                                    : 'opacity-50'
                                            }`}
                                    >
                                        <p
                                            className={`leading-relaxed transition-all duration-300 ${isActive
                                                    ? 'text-4xl font-bold text-white'
                                                    : 'text-2xl font-medium text-gray-400'
                                                }`}
                                        >
                                            {line.text}
                                        </p>
                                    </div>
                                );
                            })}
                            {parsedLyrics.length === 0 && (
                                <div className="flex flex-col items-center justify-center h-full text-center">
                                    <div className="text-gray-600 text-6xl mb-6">♪</div>
                                    <p className="text-gray-400 text-xl">No lyrics available</p>
                                    <p className="text-gray-500 text-sm mt-2">Enjoy the music</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
