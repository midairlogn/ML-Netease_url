import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Play, Trash2 } from 'lucide-react';
import type { Song } from '../types';

interface QueueProps {
    isOpen: boolean;
    onClose: () => void;
    playlist: Song[];
    currentSong: Song | null;
    onPlay: (song: Song) => void;
    onRemove: (songId: string | number) => void;
    onClear: () => void;
}

export const Queue: React.FC<QueueProps> = ({
    isOpen,
    onClose,
    playlist,
    currentSong,
    onPlay,
    onRemove,
    onClear,
}) => {
    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[70]"
                    />

                    {/* Sidebar */}
                    <motion.div
                        initial={{ x: '100%' }}
                        animate={{ x: 0 }}
                        exit={{ x: '100%' }}
                        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                        className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-black/90 backdrop-blur-xl border-l border-white/10 z-[80] flex flex-col shadow-2xl"
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between p-6 border-b border-white/10">
                            <h2 className="text-xl font-bold text-white">Play Queue</h2>
                            <div className="flex items-center gap-4">
                                <button
                                    onClick={onClear}
                                    className="text-sm text-gray-400 hover:text-red-400 transition-colors"
                                >
                                    Clear All
                                </button>
                                <button
                                    onClick={onClose}
                                    className="p-2 hover:bg-white/10 rounded-full transition-colors"
                                >
                                    <X size={20} className="text-white" />
                                </button>
                            </div>
                        </div>

                        {/* List */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-2 no-scrollbar">
                            {playlist.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full text-gray-500">
                                    <p>Queue is empty</p>
                                </div>
                            ) : (
                                playlist.map((song, index) => {
                                    const isCurrent = currentSong?.id === song.id;
                                    return (
                                        <div
                                            key={`${song.id}-${index}`}
                                            className={`group flex items-center gap-3 p-3 rounded-xl transition-all ${isCurrent
                                                    ? 'bg-white/10 border border-purple-500/30'
                                                    : 'hover:bg-white/5 border border-transparent'
                                                }`}
                                        >
                                            {/* Playing Indicator / Number */}
                                            <div className="w-6 text-center text-xs text-gray-500">
                                                {isCurrent ? (
                                                    <div className="w-2 h-2 bg-purple-500 rounded-full mx-auto animate-pulse" />
                                                ) : (
                                                    <span className="group-hover:hidden">{index + 1}</span>
                                                )}
                                                <button
                                                    onClick={() => onPlay(song)}
                                                    className={`hidden ${!isCurrent ? 'group-hover:inline-block' : ''}`}
                                                >
                                                    <Play size={12} fill="currentColor" className="text-white" />
                                                </button>
                                            </div>

                                            {/* Info */}
                                            <div className="flex-1 min-w-0">
                                                <h4
                                                    className={`text-sm font-medium truncate ${isCurrent ? 'text-purple-400' : 'text-white'
                                                        }`}
                                                >
                                                    {song.name}
                                                </h4>
                                                <p className="text-xs text-gray-400 truncate">{song.artists}</p>
                                            </div>

                                            {/* Remove */}
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onRemove(song.id);
                                                }}
                                                className="opacity-0 group-hover:opacity-100 p-2 hover:text-red-400 transition-all"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
};
