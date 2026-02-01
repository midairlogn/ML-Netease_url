/**
 * SearchHistoryManager - A sophisticated search history and local cache manager.
 * Uses localStorage for persistence and Fuse.js for fuzzy searching.
 */
class SearchHistoryManager {
    /**
     * @param {Object} options - Configuration options
     * @param {string} options.storageKey - localStorage key (default: 'ml_search_history')
     * @param {number} options.limit - Max items to store (default: 200)
     */
    constructor(options = {}) {
        this.storageKey = options.storageKey || 'ml_search_history';
        this.limit = options.limit || 200;
        this.history = this._load();
        this.fuse = null;
        this._initFuse();
    }

    /**
     * Load history from localStorage
     * @private
     */
    _load() {
        try {
            const data = localStorage.getItem(this.storageKey);
            return data ? JSON.parse(data) : [];
        } catch (e) {
            console.error('Failed to load search history:', e);
            return [];
        }
    }

    /**
     * Save history to localStorage
     * @private
     */
    _save() {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this.history));
        } catch (e) {
            console.error('Failed to save search history:', e);
        }
    }

    /**
     * Initialize or re-initialize Fuse.js instance
     * @private
     */
    _initFuse() {
        if (typeof Fuse === 'undefined') {
            console.warn('Fuse.js is not loaded. Fuzzy search will not work.');
            return;
        }

        const options = {
            keys: [
                { name: 'id', weight: 0.4 },
                { name: 'name', weight: 0.3 },
                { name: 'artist', weight: 0.2 },
                { name: 'album', weight: 0.1 }
            ],
            threshold: 0.4,
            includeScore: true,
            useExtendedSearch: true
        };
        this.fuse = new Fuse(this.history, options);
    }

    /**
     * Save or update an item in history
     * @param {Object} item - Item to save {id, type, name, artist, album}
     */
    saveItem(item) {
        if (!item || !item.id || !item.type) return;

        const index = this.history.findIndex(h => h.id === item.id && h.type === item.type);
        const now = Date.now();

        if (index > -1) {
            // Update existing record
            const existing = this.history[index];
            existing.count = (existing.count || 0) + 1;
            existing.lastUpdated = now;
            // Update metadata
            existing.name = item.name || existing.name;
            existing.artist = item.artist || existing.artist;
            existing.album = item.album || existing.album;
        } else {
            // Add new record
            this.history.push({
                id: String(item.id),
                type: item.type,
                name: item.name || '',
                artist: item.artist || '',
                album: item.album || '',
                count: 1,
                lastUpdated: now
            });
        }

        // Sort by lastUpdated to keep recent items
        this.history.sort((a, b) => b.lastUpdated - a.lastUpdated);

        // Limit storage
        if (this.history.length > this.limit) {
            this.history = this.history.slice(0, this.limit);
        }

        this._save();
        this._initFuse();
    }

    /**
     * Search history
     * @param {string} query - Search keyword
     * @param {string|Array} type - Filter by type(s).
     *                              If 'general', includes both 'general' and 'song' (as they are both searchable).
     * @returns {Array} - Matching history items
     */
    search(query, type = null) {
        let results = [];

        if (!query || query.trim() === '') {
            // Scenario A: Empty Query - return top items sorted by count
            results = [...this.history];

            // Apply type filtering
            if (type) {
                if (type === 'general') {
                    // For general search, allow 'general' (keywords) and 'song' (specific tracks)
                    results = results.filter(item => item.type === 'general' || item.type === 'song');
                } else if (Array.isArray(type)) {
                    results = results.filter(item => type.includes(item.type));
                } else if (type !== 'all') {
                    results = results.filter(item => item.type === type);
                }
            }

            results = results.sort((a, b) => b.count - a.count).slice(0, 10);
        } else {
            // Scenario B: Fuzzy Search using Fuse.js
            if (this.fuse) {
                const fuseResults = this.fuse.search(query);
                results = fuseResults.map(r => r.item);
            } else {
                // Fallback to simple includes search
                const q = query.toLowerCase();
                results = this.history.filter(h =>
                    h.name.toLowerCase().includes(q) ||
                    h.artist.toLowerCase().includes(q) ||
                    h.album.toLowerCase().includes(q) ||
                    h.id.includes(q)
                );
            }

            // Filtering by type
            if (type) {
                if (type === 'general') {
                    results = results.filter(item => item.type === 'general' || item.type === 'song');
                } else if (Array.isArray(type)) {
                    results = results.filter(item => type.includes(item.type));
                } else if (type !== 'all') {
                    results = results.filter(item => item.type === type);
                }
            }
        }

        return results;
    }

    /**
     * Delete a specific item from history
     */
    deleteItem(id, type) {
        this.history = this.history.filter(h => !(h.id === id && h.type === type));
        this._save();
        this._initFuse();
    }

    /**
     * Clear all history
     */
    clearHistory() {
        this.history = [];
        this._save();
        this._initFuse();
    }
}

// Export for global use
window.SearchHistoryManager = SearchHistoryManager;
