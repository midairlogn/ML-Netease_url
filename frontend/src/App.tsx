import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings as SettingsIcon } from 'lucide-react';
import { Search } from './components/Search';
import { PlaylistView } from './components/PlaylistView';
import { AlbumView } from './components/AlbumView';
import { Player } from './components/Player';
import type { Song } from './types';
import { LyricsView } from './components/LyricsView';
import { MiniLyrics } from './components/MiniLyrics';
import { AnimatedBackground } from './components/AnimatedBackground';
import { Logo } from './components/Logo';
import { Queue } from './components/Queue';
import { Settings } from './components/Settings';
import { ToastContainer, type ToastMessage, type ToastType } from './components/ui/Toast';
import { getSongDetail } from './api';
import { downloadMusic, lrctran } from './utils/musicUtils';

function App() {
  const [activeTab, setActiveTab] = useState<'search' | 'playlist' | 'album'>('search');
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playlist, setPlaylist] = useState<Song[]>([]);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = (message: string, type: ToastType = 'info') => {
    const id = Math.random().toString(36).substring(7);
    setToasts((prev) => [...prev, { id, message, type }]);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const handlePlaySong = async (song: Song) => {
    try {
      const details = await getSongDetail(String(song.id));
      if (details.status === 200) {
        const fullSong: Song = {
          ...song,
          url: details.url,
          lyric: details.lyric,
          tlyric: details.tlyric,
          picUrl: details.pic || song.picUrl,
          name: details.name || song.name,
          artists: details.ar_name || song.artists,
          album: details.al_name || song.album,
        };
        setCurrentSong(fullSong);
        setIsPlaying(true);

        setPlaylist((prev) => {
          if (!prev.find(s => s.id === fullSong.id)) {
            return [...prev, fullSong];
          }
          return prev;
        });
      } else {
        addToast(details.msg || 'Failed to get song details', 'error');
      }
    } catch (error) {
      console.error("Failed to play song", error);
      addToast('Failed to play song', 'error');
    }
  };

  const handleDownloadSong = async (song: Song) => {
    try {
      addToast(`Starting download: ${song.name}`, 'info');

      let fullSong = song;
      if (!song.url || !song.lyric) {
        const details = await getSongDetail(String(song.id));
        if (details.status === 200) {
          fullSong = {
            ...song,
            url: details.url,
            lyric: details.lyric,
            tlyric: details.tlyric,
            picUrl: details.pic || song.picUrl,
            name: details.name || song.name,
            artists: details.ar_name || song.artists,
            album: details.al_name || song.album,
          };
        } else {
          addToast(details.msg || 'Failed to get song details for download', 'error');
          return;
        }
      }

      let processedLyrics = fullSong.lyric || '';
      if (fullSong.tlyric) {
        processedLyrics = lrctran(fullSong.lyric || '', fullSong.tlyric);
      }

      await downloadMusic(
        fullSong.album,
        fullSong.artists,
        processedLyrics,
        fullSong.name,
        fullSong.picUrl,
        fullSong.url!
      );

      addToast(`Downloaded: ${fullSong.name}`, 'success');
    } catch (error) {
      console.error("Download failed", error);
      addToast('Download failed', 'error');
    }
  };

  const handleNext = useCallback(() => {
    if (!currentSong || playlist.length === 0) return;
    const currentIndex = playlist.findIndex(s => s.id === currentSong.id);
    const nextIndex = (currentIndex + 1) % playlist.length;
    handlePlaySong(playlist[nextIndex]);
  }, [currentSong, playlist]);

  const handlePrev = useCallback(() => {
    if (!currentSong || playlist.length === 0) return;
    const currentIndex = playlist.findIndex(s => s.id === currentSong.id);
    const prevIndex = (currentIndex - 1 + playlist.length) % playlist.length;
    handlePlaySong(playlist[prevIndex]);
  }, [currentSong, playlist]);

  const handleRemoveFromQueue = (songId: string | number) => {
    setPlaylist(prev => prev.filter(s => s.id !== songId));
    if (currentSong?.id === songId) {
      if (playlist.length > 1) {
        handleNext();
      } else {
        setCurrentSong(null);
        setIsPlaying(false);
      }
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          setIsPlaying(prev => !prev);
          break;
        case 'ArrowLeft':
          if (e.metaKey || e.ctrlKey) {
            handlePrev();
          }
          break;
        case 'ArrowRight':
          if (e.metaKey || e.ctrlKey) {
            handleNext();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleNext, handlePrev]);

  return (
    <div className="min-h-screen bg-black text-white font-sans pb-32 relative overflow-x-hidden">
      <AnimatedBackground />
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      <header className="sticky top-0 z-40 glass-dark">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Logo />

          <nav className="flex gap-2 glass-dark p-1.5 rounded-full border border-white/10 absolute left-1/2 -translate-x-1/2">
            {(['search', 'playlist', 'album'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`relative px-6 py-2 rounded-full text-sm font-medium transition-all duration-300 ${activeTab === tab ? 'text-white' : 'text-gray-400 hover:text-gray-200'
                  }`}
              >
                {activeTab === tab && (
                  <motion.div
                    layoutId="activeTab"
                    className="absolute inset-0 bg-white/10 backdrop-blur-md rounded-full"
                    transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
                  />
                )}
                <span className="relative z-10 capitalize">{tab}</span>
              </button>
            ))}
          </nav>

          <button
            onClick={() => setShowSettings(true)}
            className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-full transition-colors"
          >
            <SettingsIcon size={20} />
          </button>
        </div>
      </header>

      <main className="pt-12 relative z-10">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.4 }}
          >
            {activeTab === 'search' && (
              <Search onPlaySong={handlePlaySong} onDownloadSong={handleDownloadSong} />
            )}
            {activeTab === 'playlist' && (
              <PlaylistView onPlaySong={handlePlaySong} onDownloadSong={handleDownloadSong} />
            )}
            {activeTab === 'album' && (
              <AlbumView onPlaySong={handlePlaySong} onDownloadSong={handleDownloadSong} />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      <MiniLyrics
        song={currentSong}
        currentTime={currentTime}
        onExpand={() => setShowLyrics(true)}
      />

      <Player
        currentSong={currentSong}
        isPlaying={isPlaying}
        onPlayPause={() => setIsPlaying(!isPlaying)}
        onNext={handleNext}
        onPrev={handlePrev}
        onDownload={() => currentSong && handleDownloadSong(currentSong)}
        onShowLyrics={() => setShowLyrics(true)}
        onToggleQueue={() => setShowQueue(!showQueue)}
        onTimeUpdate={setCurrentTime}
      />

      <Queue
        isOpen={showQueue}
        onClose={() => setShowQueue(false)}
        playlist={playlist}
        currentSong={currentSong}
        onPlay={handlePlaySong}
        onRemove={handleRemoveFromQueue}
        onClear={() => setPlaylist([])}
      />

      <Settings
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />

      <AnimatePresence>
        {showLyrics && currentSong && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-[60]"
          >
            <LyricsView
              song={currentSong}
              onClose={() => setShowLyrics(false)}
              currentTime={currentTime}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
