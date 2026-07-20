const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');

function createJQueryStub() {
    return function jqueryStub() {
        return {
            ready() {},
            on() {},
            off() {},
            each() {},
            val() { return ''; },
            text() {},
            data() {},
            prop() {},
            addClass() {},
            removeClass() {}
        };
    };
}

function loadScripts(relativePaths, overrides = {}) {
    const context = vm.createContext({
        console,
        document: {},
        window: { addEventListener() {}, removeEventListener() {} },
        Blob,
        DOMException,
        setTimeout,
        clearTimeout,
        $: createJQueryStub(),
        ...overrides
    });
    for (const relativePath of relativePaths) {
        const source = fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
        vm.runInContext(source, context, { filename: relativePath });
    }
    return context;
}

function loadScript(relativePath, overrides = {}) {
    return loadScripts([relativePath], overrides);
}

test('blob download URL remains valid until the browser handoff timer runs', async () => {
    const timers = [];
    const revokedUrls = [];
    const listeners = {};
    let clicked = false;
    let appended = false;
    let removed = false;
    const anchor = {
        click() { clicked = true; }
    };
    const context = loadScript('static/ml-func-plugins.js', {
        URL: {
            createObjectURL() { return 'blob:test-download'; },
            revokeObjectURL(url) { revokedUrls.push(url); }
        },
        document: {
            createElement(tagName) {
                assert.equal(tagName, 'a');
                return anchor;
            },
            body: {
                appendChild(element) {
                    assert.equal(element, anchor);
                    appended = true;
                },
                removeChild(element) {
                    assert.equal(element, anchor);
                    removed = true;
                }
            }
        },
        window: {
            addEventListener(type, listener) { listeners[type] = listener; },
            removeEventListener(type, listener) {
                if (listeners[type] === listener) delete listeners[type];
            }
        },
        setTimeout(callback, delay) {
            timers.push({ callback, delay });
            return timers.length;
        },
        clearTimeout() {}
    });

    const downloadPromise = context.ml_trigger_blob_download({ size: 1024 }, 'song.flac');

    assert.equal(anchor.href, 'blob:test-download');
    assert.equal(anchor.download, 'song.flac');
    assert.equal(clicked, true);
    assert.equal(appended, true);
    assert.equal(removed, true);
    assert.deepEqual(revokedUrls, []);
    assert.equal(timers.length, 1);
    assert.equal(timers[0].delay, 10000);

    timers[0].callback();
    await downloadPromise;
    assert.deepEqual(revokedUrls, ['blob:test-download']);
});

test('Save As handoff waits for window focus before revoking the Blob URL', async () => {
    const listeners = {};
    const timers = [];
    const revokedUrls = [];
    const context = loadScript('static/ml-func-plugins.js', {
        URL: {
            createObjectURL() { return 'blob:save-as'; },
            revokeObjectURL(url) { revokedUrls.push(url); }
        },
        document: {
            createElement() { return { click() {} }; },
            body: { appendChild() {}, removeChild() {} }
        },
        window: {
            addEventListener(type, listener) { listeners[type] = listener; },
            removeEventListener(type, listener) {
                if (listeners[type] === listener) delete listeners[type];
            }
        },
        setTimeout(callback, delay) {
            const timer = { callback, delay, cancelled: false };
            timers.push(timer);
            return timer;
        },
        clearTimeout(timer) {
            if (timer) timer.cancelled = true;
        }
    });

    const downloadPromise = context.ml_trigger_blob_download({ size: 1024 }, 'song.flac');
    listeners.blur();

    assert.equal(timers[0].cancelled, true);
    assert.deepEqual(revokedUrls, []);

    listeners.focus();
    assert.equal(timers[1].delay, 1000);
    timers[1].callback();
    await downloadPromise;

    assert.deepEqual(revokedUrls, ['blob:save-as']);
});

test('individual downloads acquire the browser slot before building a Blob', async () => {
    const context = loadScript('static/ml-func-plugins.js');
    const order = [];
    let releaseFirstBuild;
    const firstBuildGate = new Promise(resolve => { releaseFirstBuild = resolve; });

    context.ml_build_music_file = async (_album, _artist, _lyrics, name) => {
        order.push(`${name}-build-start`);
        if (name === 'first') await firstBuildGate;
        order.push(`${name}-build-end`);
        return { data: new Uint8Array(1024), mimeType: 'audio/flac', fileName: `${name}.flac` };
    };
    context.ml_trigger_blob_download = async (blob, fileName) => {
        assert.equal(blob instanceof Blob, true);
        assert.equal(blob.size, 1024);
        order.push(`${fileName}-trigger`);
    };

    const first = context.ml_music_download('', '', '', 'first', '', '');
    const second = context.ml_music_download('', '', '', 'second', '', '');

    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(order, ['first-build-start']);

    releaseFirstBuild();
    await Promise.all([first, second]);
    assert.deepEqual(order, [
        'first-build-start',
        'first-build-end',
        'first.flac-trigger',
        'second-build-start',
        'second-build-end',
        'second.flac-trigger'
    ]);
});

test('FLAC building returns binary data without allocating a Blob', async () => {
    const audioData = new Uint8Array([0x66, 0x4c, 0x61, 0x43, 0, 0, 0, 0]).buffer;
    const taggedData = new Uint8Array([0x66, 0x4c, 0x61, 0x43, 1, 2, 3, 4]).buffer;
    class FakeFlacWriter {
        setFrame() { return this; }
        setPicture() { assert.fail('cover should not be written'); }
        addTag() { return this; }
        getArrayBuffer() { return taggedData; }
        getBlob() { assert.fail('folder/ZIP build must not create a Blob'); }
    }
    const context = loadScript('static/ml-func-plugins.js', {
        AbortController,
        Blob: class UnexpectedBlob {
            constructor() { assert.fail('FLAC build must not create a Blob'); }
        },
        FlacWriter: FakeFlacWriter,
        fetch: async () => ({
            ok: true,
            async arrayBuffer() { return audioData; }
        }),
        localStorage: { getItem() { return null; } }
    });

    const musicFile = await context.ml_build_music_file(
        'album',
        'artist',
        '',
        'song',
        '',
        'https://example.test/song.flac',
        'lossless'
    );

    assert.equal(musicFile.data, taggedData);
    assert.equal(musicFile.mimeType, 'audio/flac');
    assert.equal(musicFile.fileName, 'song_artist_album.flac');
});

test('MP3 building returns the ID3 writer buffer without allocating a Blob', async () => {
    const audioData = new Uint8Array([0x49, 0x44, 0x33, 0, 0, 0, 0, 0]).buffer;
    const taggedData = new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3, 4, 5]).buffer;
    class FakeID3Writer {
        setFrame() { return this; }
        addTag() { this.arrayBuffer = taggedData; }
        getBlob() { assert.fail('MP3 build must not create a Blob'); }
    }
    const context = loadScript('static/ml-func-plugins.js', {
        AbortController,
        Blob: class UnexpectedBlob {
            constructor() { assert.fail('MP3 build must not create a Blob'); }
        },
        ID3Writer: FakeID3Writer,
        fetch: async () => ({
            ok: true,
            async arrayBuffer() { return audioData; }
        }),
        localStorage: { getItem() { return null; } }
    });

    const musicFile = await context.ml_build_music_file(
        'album',
        'artist',
        '',
        'song',
        '',
        'https://example.test/song.mp3',
        'standard'
    );

    assert.equal(musicFile.data, taggedData);
    assert.equal(musicFile.mimeType, 'audio/mpeg');
    assert.equal(musicFile.fileName, 'song_artist_album.mp3');
});

test('failed folder writes abort the writer, remove the partial file, and report the stage', async () => {
    const context = loadScript('static/ml-task-manager.js');
    let aborted = false;
    let removedName = null;
    const error = new DOMException(
        'The requested file could not be read, typically due to permission problems that have occurred after a reference to a file was acquired.',
        'NotReadableError'
    );
    const writable = {
        async write() { throw error; },
        async close() { assert.fail('close should not run after write fails'); },
        async abort() { aborted = true; }
    };
    const folderHandle = {
        async getFileHandle(name, options) {
            assert.equal(name, 'song.flac');
            assert.equal(options.create, true);
            return {
                async createWritable() { return writable; }
            };
        },
        async removeEntry(name) { removedName = name; }
    };

    await assert.rejects(
        context.ml_write_data_to_folder(folderHandle, 'song.flac', new Uint8Array(1024)),
        (caught) => caught === error && caught.mlFolderWriteStage === 'write'
    );
    assert.equal(aborted, true);
    assert.equal(removedName, 'song.flac');
    assert.equal(context.ml_is_storage_io_error(error), true);
    assert.equal(context.ml_is_folder_write_blocked_error(error), false);
});

test('folder handle acquisition failure does not delete an unrelated file', async () => {
    const context = loadScript('static/ml-task-manager.js');
    let removeCalled = false;
    const error = new DOMException('Permission denied', 'NotAllowedError');
    const folderHandle = {
        async getFileHandle() { throw error; },
        async removeEntry() { removeCalled = true; }
    };

    await assert.rejects(
        context.ml_write_data_to_folder(folderHandle, 'song.flac', new Uint8Array(1024)),
        (caught) => caught === error && caught.mlFolderWriteStage === 'get-file-handle'
    );
    assert.equal(removeCalled, false);
    assert.equal(context.ml_is_folder_write_blocked_error(error), true);
});

test('browser-managed and direct-folder tasks use different completion semantics', () => {
    const context = loadScript('static/ml-task-manager.js');

    assert.equal(context.ml_task_uses_browser_download({ type: 'single', outputMode: 'individual' }), true);
    assert.equal(context.ml_task_uses_browser_download({ type: 'batch', outputMode: 'zip' }), true);
    assert.equal(context.ml_task_uses_browser_download({ type: 'batch', outputMode: 'folder' }), false);
});

test('only final per-song storage errors affect the failure alert classification', () => {
    const context = loadScript('static/ml-task-manager.js');
    const recoveredSong = { id: 1 };
    const networkFailedSong = { id: 2 };
    const storageFailedSong = { id: 3 };
    const errors = new Map();

    errors.set(recoveredSong, new DOMException('Could not read file', 'NotReadableError'));
    errors.delete(recoveredSong);
    errors.set(networkFailedSong, new TypeError('Failed to fetch'));
    errors.set(storageFailedSong, new DOMException('Disk quota exceeded', 'QuotaExceededError'));

    const storageFailures = context.ml_get_storage_failed_songs({
        failedSongs: [networkFailedSong, storageFailedSong],
        songFailureErrors: errors
    });

    assert.equal(storageFailures.length, 1);
    assert.equal(storageFailures[0], storageFailedSong);
});

test('successful ZIP submission releases retained source buffers', async () => {
    const context = loadScripts(['static/ml-func-plugins.js', 'static/ml-task-manager.js']);
    let submittedName = null;
    const zippedFiles = [];
    context.JSZip = class FakeZip {
        file(name, data) { zippedFiles.push({ name, data }); }
        async generateAsync() { return { size: 2048 }; }
    };
    context.ml_with_browser_download_slot = operation => operation();
    context.ml_trigger_blob_download = async (_blob, fileName) => {
        submittedName = fileName;
    };
    const task = {
        outputMode: 'zip',
        generatedFiles: [
            { fileName: 'one.flac', data: new Uint8Array(1024) },
            { fileName: 'two.flac', data: new Uint8Array(1024) }
        ],
        status: 'active',
        isPaused: false,
        collectionName: 'Album'
    };

    await context.ml_finish_zip_task(task);

    assert.equal(submittedName, 'Album.zip');
    assert.deepEqual(zippedFiles.map(file => file.name), ['one.flac', 'two.flac']);
    assert.equal(zippedFiles.every(file => file.data instanceof Uint8Array), true);
    assert.equal(task.generatedFiles.length, 0);
});

test('folder mode writes the tagged buffer without creating an intermediate Blob', async () => {
    const context = loadScript('static/ml-task-manager.js');
    const taggedData = new Uint8Array([1, 2, 3, 4]);
    const writes = [];
    let closed = false;
    const folderHandle = {
        async getFileHandle(name, options) {
            assert.equal(name, 'song.flac');
            if (!options.create) {
                throw new DOMException('Missing', 'NotFoundError');
            }
            return {
                async createWritable() {
                    return {
                        async write(data) { writes.push(data); },
                        async close() { closed = true; },
                        async abort() {}
                    };
                }
            };
        },
        async removeEntry() {}
    };
    context.ml_build_music_file = async () => ({
        data: taggedData,
        mimeType: 'audio/flac',
        fileName: 'song.flac'
    });

    await context.ml_save_task_music_file({
        outputMode: 'folder',
        folderHandle,
        usedFileNames: new Set(),
        status: 'active',
        isPaused: false,
        level: 'lossless',
        abortController: null
    }, {
        al_name: '',
        ar_name: '',
        name: 'song',
        pic: '',
        url: ''
    }, '', {
        trackNumber: 1,
        totalTracks: 1
    });

    assert.equal(writes.length, 1);
    assert.equal(writes[0], taggedData);
    assert.equal(writes[0] instanceof Blob, false);
    assert.equal(closed, true);
});

test('a recovered storage retry does not classify another song network failure as storage', async () => {
    const context = loadScripts(['static/ml-func-plugins.js', 'static/ml-task-manager.js'], {
        console: { log() {}, warn() {}, error() {} }
    });
    const recoveredSong = { id: 1, name: 'Recovered' };
    const networkFailedSong = { id: 2, name: 'Network failure' };
    const attempts = new Map();
    const alerts = [];

    context.ml_get_concurrent_count = () => 1;
    context.ml_update_task_item = () => {};
    context.ml_show_Alert = (...args) => alerts.push(args);
    context.ml_sanitize_lrc_timestamps = lyrics => lyrics;
    context.ml_resolve_lrc_timestamp_conflicts = lyrics => lyrics;
    context.ml_fetch_task_song_info = async () => ({
        status: 200,
        lyric: '',
        tlyric: '',
        al_name: '',
        ar_name: '',
        name: '',
        pic: '',
        url: ''
    });
    context.ml_save_task_music_file = async (_task, _response, _lyrics, song) => {
        const attempt = (attempts.get(song) || 0) + 1;
        attempts.set(song, attempt);
        if (song === recoveredSong && attempt === 1) {
            throw new DOMException('Could not read file', 'NotReadableError');
        }
        if (song === networkFailedSong) {
            throw new TypeError('Failed to fetch');
        }
    };

    const task = {
        id: 10,
        songs: [recoveredSong, networkFailedSong],
        remainingSongs: null,
        totalCount: 2,
        completedCount: 0,
        successCount: 0,
        failedCount: 0,
        failedSongs: [],
        progress: 0,
        outputMode: 'individual',
        generatedFiles: [],
        songFailureErrors: new Map(),
        status: 'active',
        isPaused: false,
        abortController: null
    };

    await context.ml_execute_batch_task(task);

    assert.equal(task.successCount, 1);
    assert.equal(task.failedCount, 1);
    assert.equal(task.failedSongs[0], networkFailedSong);
    assert.equal(task.songFailureErrors.has(recoveredSong), false);
    assert.equal(task.songFailureErrors.get(networkFailedSong).name, 'TypeError');
    assert.equal(attempts.get(recoveredSong), 2);
    assert.equal(attempts.get(networkFailedSong), 5);
    assert.equal(alerts.length, 0);
});
