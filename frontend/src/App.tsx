import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search } from './components/Search';
import { PlaylistView } from './components/PlaylistView';
import { AlbumView } from './components/AlbumView';
import { Player, type Song } from './components/Player';
import { LyricsView } from './components/LyricsView';
import { MiniLyrics } from './components/MiniLyrics';
import { AnimatedBackground } from './components/AnimatedBackground';
import { getSongDetail } from './api';
import { downloadMusic, lrctran } from './utils/musicUtils';

function App() {
  const [activeTab, setActiveTab] = useState<'search' | 'playlist' | 'album'>('search');
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playlist, setPlaylist] = useState<Song[]>([]); // Current playing queue

  const handlePlaySong = async (song: Song) => {
    // If we already have the URL (and it's not expired?), just play.
    // But usually we need to fetch fresh URL.
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

        // Add to playlist if not present or just set as current?
        // For now, let's just set it as current. 
        // If we want a queue, we should manage `playlist` state better.
        // If coming from a list, we might want to set the whole list as queue.
        // But for now, simple single play.
        setPlaylist((prev) => {
          if (!prev.find(s => s.id === fullSong.id)) {
            return [...prev, fullSong];
          }
          return prev;
        });
      } else {
        alert(details.msg || 'Failed to get song details');
      }
    } catch (error) {
      console.error("Failed to play song", error);
    }
  };

  const handleDownloadSong = async (song: Song) => {
    try {
      // We need full details for download (lyrics, cover, url)
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
          alert(details.msg || 'Failed to get song details for download');
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
    } catch (error) {
      console.error("Download failed", error);
    }
  };

  const handleNext = () => {
    if (!currentSong || playlist.length === 0) return;
    const currentIndex = playlist.findIndex(s => s.id === currentSong.id);
    const nextIndex = (currentIndex + 1) % playlist.length;
    handlePlaySong(playlist[nextIndex]);
  };

  const handlePrev = () => {
    if (!currentSong || playlist.length === 0) return;
    const currentIndex = playlist.findIndex(s => s.id === currentSong.id);
    const prevIndex = (currentIndex - 1 + playlist.length) % playlist.length;
    handlePlaySong(playlist[prevIndex]);
  };

  return (
    <div className="min-h-screen bg-black text-white font-sans pb-32 relative overflow-x-hidden">
      <AnimatedBackground />

      <header className="sticky top-0 z-40 glass-dark">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <h1 className="text-2xl font-bold gradient-text tracking-tight">
            ML Netease
          </h1>
          <nav className="flex gap-2 glass-dark p-1.5 rounded-full border border-white/10">
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
        onTimeUpdate={setCurrentTime}
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
