import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Maximize2 } from 'lucide-react';

export interface Song {
    id: string | number;
    name: string;
    artists: string;
    album: string;
    picUrl: string;
    url?: string;
    lyric?: string;
    tlyric?: string;
    duration?: number;
}

interface PlayerProps {
    currentSong: Song | null;
    isPlaying: boolean;
    onPlayPause: () => void;
    onNext: () => void;
    onPrev: () => void;
    onDownload: () => void;
    onShowLyrics: () => void;
    onTimeUpdate?: (time: number) => void;
}

export const Player: React.FC<PlayerProps> = ({
    currentSong,
    isPlaying,
    onPlayPause,
    onNext,
    onPrev,
    onDownload,
    onShowLyrics,
    onTimeUpdate,
}) => {
    const [progress, setProgress] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(0.7);
    const [isMuted, setIsMuted] = useState(false);
    const audioRef = useRef<HTMLAudioElement>(null);

    useEffect(() => {
        if (currentSong?.url && audioRef.current) {
            audioRef.current.src = currentSong.url;
            audioRef.current.volume = isMuted ? 0 : volume;
            if (isPlaying) {
                audioRef.current.play().catch(e => console.error("Play error:", e));
            }
        }
    }, [currentSong]);

    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.volume = isMuted ? 0 : volume;
        }
    }, [volume, isMuted]);

    useEffect(() => {
        if (audioRef.current) {
            if (isPlaying) {
                audioRef.current.play().catch(e => console.error("Play error:", e));
            } else {
                audioRef.current.pause();
            }
        }
    }, [isPlaying]);

    const handleTimeUpdate = () => {
        if (audioRef.current) {
            const currentTime = audioRef.current.currentTime;
            setProgress(currentTime);
            setDuration(audioRef.current.duration || 0);
            if (onTimeUpdate) onTimeUpdate(currentTime);
        }
    };

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newVolume = Number(e.target.value);
        setVolume(newVolume);
        if (newVolume > 0) setIsMuted(false);
    };

    const toggleMute = () => {
        setIsMuted(!isMuted);
    };

    const formatTime = (time: number) => {
        if (isNaN(time)) return '0:00';
        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60);
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };

    if (!currentSong) return null;

    const progressPercent = duration > 0 ? (progress / duration) * 100 : 0;

    return (
        <div className="fixed bottom-0 left-0 right-0 z-50">
            <audio
                ref={audioRef}
                onTimeUpdate={handleTimeUpdate}
                onEnded={onNext}
                onError={(e) => console.error("Audio error", e)}
            />

            {/* Progress bar - Apple Music style */}
            <div
                className="h-1.5 bg-white/5 relative group cursor-pointer hover:h-2 transition-all"
                onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const percent = x / rect.width;
                    const newTime = percent * duration;
                    if (audioRef.current) {
                        audioRef.current.currentTime = newTime;
                        setProgress(newTime);
                    }
                }}
            >
                <div
                    className="absolute h-full bg-white transition-all"
                    style={{ width: `${progressPercent}%` }}
                />
                <div
                    className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ left: `${progressPercent}%`, transform: `translate(-50%, -50%)` }}
                />
            </div>

            {/* Player controls - Apple Music inspired */}
            <div className="glass-dark border-t border-white/5">
                <div className="max-w-screen-2xl mx-auto px-6 py-3">
                    <div className="flex items-center justify-between gap-8">
                        {/* Left: Song Info */}
                        <div className="flex items-center gap-4 flex-1 min-w-0">
                            <div
                                className="relative w-16 h-16 rounded-lg overflow-hidden shadow-lg flex-shrink-0 cursor-pointer group"
                                onClick={onShowLyrics}
                            >
                                <img
                                    src={currentSong.picUrl}
                                    alt={currentSong.name}
                                    className="w-full h-full object-cover"
                                />
                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                    <Maximize2 size={20} className="text-white" />
                                </div>
                            </div>
                            <div className="min-w-0 flex-1">
                                <h3 className="font-semibold text-white truncate text-base">
                                    {currentSong.name}
                                </h3>
                                <p className="text-sm text-gray-400 truncate">{currentSong.artists}</p>
                            </div>
                        </div>

                        {/* Center: Playback Controls */}
                        <div className="flex flex-col items-center gap-2 flex-shrink-0">
                            <div className="flex items-center gap-6">
                                <button
                                    onClick={onPrev}
                                    className="text-gray-400 hover:text-white transition-colors"
                                    title="Previous"
                                >
                                    <SkipBack size={22} fill="currentColor" />
                                </button>

                                <button
                                    onClick={onPlayPause}
                                    className="w-10 h-10 flex items-center justify-center rounded-full bg-white text-black hover:scale-105 transition-transform shadow-lg"
                                    title={isPlaying ? 'Pause' : 'Play'}
                                >
                                    {isPlaying ? (
                                        <Pause size={20} fill="currentColor" />
                                    ) : (
                                        <Play size={20} fill="currentColor" className="ml-0.5" />
                                    )}
                                </button>

                                <button
                                    onClick={onNext}
                                    className="text-gray-400 hover:text-white transition-colors"
                                    title="Next"
                                >
                                    <SkipForward size={22} fill="currentColor" />
                                </button>
                            </div>

                            {/* Time display */}
                            <div className="flex items-center gap-2 text-xs text-gray-400 tabular-nums font-mono">
                                <span>{formatTime(progress)}</span>
                                <span className="text-gray-600">|</span>
                                <span>{formatTime(duration)}</span>
                            </div>
                        </div>

                        {/* Right: Volume Control */}
                        <div className="flex items-center gap-4 flex-1 justify-end">
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={toggleMute}
                                    className="text-gray-400 hover:text-white transition-colors"
                                    title={isMuted ? 'Unmute' : 'Mute'}
                                >
                                    {isMuted || volume === 0 ? (
                                        <VolumeX size={20} />
                                    ) : (
                                        <Volume2 size={20} />
                                    )}
                                </button>

                                <div className="relative w-24 h-1 bg-white/10 rounded-full overflow-hidden cursor-pointer group">
                                    <div
                                        className="absolute h-full bg-white transition-all"
                                        style={{ width: `${isMuted ? 0 : volume * 100}%` }}
                                    />
                                    <input
                                        type="range"
                                        min="0"
                                        max="1"
                                        step="0.01"
                                        value={volume}
                                        onChange={handleVolumeChange}
                                        className="absolute inset-0 w-full opacity-0 cursor-pointer"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
