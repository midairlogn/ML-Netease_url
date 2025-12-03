import React, { useState } from 'react';
import { Search as SearchIcon, Loader2, Music } from 'lucide-react';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import { SongList } from './SongList';
import { searchSongs } from '../api';
import type { Song } from '../types';

interface SearchProps {
    onPlaySong: (song: Song) => void;
    onDownloadSong: (song: Song) => void;
}

export const Search: React.FC<SearchProps> = ({ onPlaySong, onDownloadSong }) => {
    const [keywords, setKeywords] = useState('');
    const [limit, setLimit] = useState(10);
    const [loading, setLoading] = useState(false);
    const [results, setResults] = useState<Song[]>([]);
    const [searched, setSearched] = useState(false);

    const handleSearch = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!keywords.trim()) return;

        setLoading(true);
        setSearched(true);
        try {
            const data = await searchSongs(keywords, limit);
            if (data.status === 200 && data.result) {
                setResults(data.result);
            } else {
                setResults([]);
            }
        } catch (error) {
            console.error("Search failed", error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-[70vh] flex flex-col items-center justify-center px-6">
            {!searched || results.length === 0 ? (
                <div className="w-full max-w-2xl mx-auto text-center">
                    {/* Icon and Title */}
                    <div className="mb-12 animate-float">
                        <div className="inline-flex items-center justify-center w-24 h-24 rounded-full glass-dark border border-white/10 mb-6">
                            <Music size={40} className="text-purple-400" />
                        </div>
                        <h2 className="text-4xl font-bold gradient-text mb-3">
                            Discover Music
                        </h2>
                        <p className="text-gray-400 text-lg">
                            Search for your favorite songs, artists, and albums
                        </p>
                    </div>

                    {/* Search Form */}
                    <form onSubmit={handleSearch} className="space-y-4">
                        <div className="relative">
                            <SearchIcon className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400" size={22} />
                            <Input
                                value={keywords}
                                onChange={(e) => setKeywords(e.target.value)}
                                placeholder="Type to search..."
                                className="pl-14 h-16 text-lg"
                                autoFocus
                            />
                        </div>

                        <div className="flex gap-4 items-center justify-center">
                            <div className="flex items-center gap-2">
                                <label className="text-sm text-gray-400">Results:</label>
                                <select
                                    value={limit}
                                    onChange={(e) => setLimit(Number(e.target.value))}
                                    className="glass-dark border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                                >
                                    <option value={5}>5</option>
                                    <option value={10}>10</option>
                                    <option value={20}>20</option>
                                    <option value={30}>30</option>
                                    <option value={50}>50</option>
                                </select>
                            </div>

                            <Button
                                type="submit"
                                size="lg"
                                disabled={loading || !keywords.trim()}
                                className="px-12"
                            >
                                {loading ? (
                                    <>
                                        <Loader2 className="animate-spin mr-2" size={20} />
                                        Searching
                                    </>
                                ) : (
                                    'Search'
                                )}
                            </Button>
                        </div>
                    </form>
                </div>
            ) : (
                <div className="w-full max-w-5xl mx-auto">
                    {/* Back to search */}
                    <div className="mb-6 flex items-center justify-between">
                        <h2 className="text-2xl font-bold text-white">
                            Found {results.length} {results.length === 1 ? 'result' : 'results'}
                        </h2>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                                setSearched(false);
                                setResults([]);
                                setKeywords('');
                            }}
                        >
                            New Search
                        </Button>
                    </div>

                    {/* Results */}
                    <div className="glass-dark rounded-3xl p-6 shadow-2xl border border-white/10">
                        <SongList songs={results} onPlay={onPlaySong} onDownload={onDownloadSong} />
                    </div>
                </div>
            )}
        </div>
    );
};
