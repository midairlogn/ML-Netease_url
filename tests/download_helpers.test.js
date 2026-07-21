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
        AbortController,
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
    assert.equal(timers.length, 2);
    assert.equal(timers[0].delay, 10000);
    assert.equal(timers[1].delay, 300000);

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
    assert.equal(timers[1].delay, 300000);
    assert.equal(timers[1].cancelled, false);
    assert.deepEqual(revokedUrls, []);

    listeners.focus();
    assert.equal(timers[2].delay, 1000);
    timers[2].callback();
    await downloadPromise;

    assert.deepEqual(revokedUrls, ['blob:save-as']);
});

test('blur without focus still releases the Blob URL at the maximum handoff timeout', async () => {
    const listeners = {};
    const timers = [];
    const revokedUrls = [];
    const context = loadScript('static/ml-func-plugins.js', {
        URL: {
            createObjectURL() { return 'blob:blurred'; },
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
    timers[1].callback();
    await downloadPromise;

    assert.equal(timers[0].cancelled, true);
    assert.deepEqual(revokedUrls, ['blob:blurred']);
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

test('failed folder write probes abort and remove the probe file', async () => {
    const context = loadScript('static/ml-task-manager.js', {
        console: { log() {}, warn() {}, error() {} }
    });
    let aborted = false;
    let removedName = null;
    const error = new DOMException('Could not write probe', 'NotReadableError');
    const folderHandle = {
        async getFileHandle(name, options) {
            assert.equal(options.create, true);
            return {
                async createWritable() {
                    return {
                        async write() { throw error; },
                        async abort() { aborted = true; },
                        async close() { assert.fail('probe close should not run'); }
                    };
                }
            };
        },
        async removeEntry(name) { removedName = name; }
    };

    assert.equal(await context.ml_verify_directory_writable(folderHandle), false);
    assert.equal(aborted, true);
    assert.match(removedName, /^\.ml-write-test-/);
});

test('folder permission loss after output starts fails instead of switching to a partial ZIP', async () => {
    const context = loadScript('static/ml-task-manager.js');
    const task = {
        outputMode: 'folder',
        folderHandle: {},
        folderWrittenCount: 1,
        usedFileNames: new Set(['song.flac']),
        folderFallbackNotified: false,
        status: 'active',
        isPaused: false,
        level: 'lossless',
        abortController: null
    };
    const permissionError = new DOMException('Permission denied', 'NotAllowedError');
    context.ml_build_music_file = async () => ({
        data: new Uint8Array([1, 2, 3]),
        mimeType: 'audio/flac',
        fileName: 'song.flac'
    });
    context.ml_get_unique_folder_file_name = async () => 'song.flac';
    context.ml_write_data_to_folder = async () => { throw permissionError; };

    await assert.rejects(
        context.ml_save_task_music_file(task, {}, '', {}),
        error => error.name === 'FolderOutputBlockedError' && error.mlPartialFolderOutput === true
    );
    assert.equal(task.outputMode, 'folder');
});

test('batch execution stops after partial folder output loses permission', async () => {
    const context = loadScripts(['static/ml-func-plugins.js', 'static/ml-task-manager.js'], {
        console: { log() {}, warn() {}, error() {} }
    });
    const blockedSong = { id: 2, name: 'Blocked' };
    const unstartedSong = { id: 3, name: 'Unstarted' };
    const savedSongs = [];
    const alerts = [];
    const error = new Error('Folder write permission was lost after files were written');
    error.name = 'FolderOutputBlockedError';
    error.mlPartialFolderOutput = true;

    context.ml_get_concurrent_count = () => 3;
    context.ml_update_task_item = () => {};
    context.ml_show_Alert = (...args) => alerts.push(args);
    context.ml_sanitize_lrc_timestamps = lyrics => lyrics;
    context.ml_resolve_lrc_timestamp_conflicts = lyrics => lyrics;
    context.ml_fetch_task_song_info = async songId => ({
        status: 200,
        lyric: '',
        tlyric: '',
        al_name: '',
        ar_name: '',
        name: String(songId),
        pic: '',
        url: ''
    });
    context.ml_save_task_music_file = async (_task, _response, _lyrics, song) => {
        savedSongs.push(song);
        throw error;
    };

    const task = {
        id: 11,
        songs: [blockedSong, unstartedSong],
        remainingSongs: null,
        totalCount: 3,
        completedCount: 1,
        successCount: 1,
        failedCount: 0,
        failedSongs: [],
        progress: 0,
        outputMode: 'folder',
        folderWrittenCount: 1,
        songFailureErrors: new Map(),
        fatalError: null,
        status: 'active',
        isPaused: false,
        abortController: null
    };

    await context.ml_execute_batch_task(task);

    assert.deepEqual(savedSongs, [blockedSong]);
    assert.deepEqual(Array.from(task.failedSongs, song => song.id), [2, 3]);
    assert.equal(task.failedCount, 2);
    assert.equal(task.outputMode, 'folder');
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0][0], '文件夹下载中断');
});

test('pausing during a blocked folder write preserves songs for resume', async () => {
    const context = loadScripts(['static/ml-func-plugins.js', 'static/ml-task-manager.js'], {
        console: { log() {}, warn() {}, error() {} }
    });
    const blockedSong = { id: 2, name: 'Blocked' };
    const unstartedSong = { id: 3, name: 'Unstarted' };
    const savedSongs = [];
    const alerts = [];
    const error = new Error('Folder write permission was lost after files were written');
    error.name = 'FolderOutputBlockedError';
    error.mlPartialFolderOutput = true;
    let shouldPause = true;

    context.ml_get_concurrent_count = () => 3;
    context.ml_update_task_item = () => {};
    context.ml_update_task_panel = () => {};
    context.ml_show_Alert = (...args) => alerts.push(args);
    context.ml_sanitize_lrc_timestamps = lyrics => lyrics;
    context.ml_resolve_lrc_timestamp_conflicts = lyrics => lyrics;
    context.ml_fetch_task_song_info = async songId => ({
        status: 200,
        lyric: '',
        tlyric: '',
        al_name: '',
        ar_name: '',
        name: String(songId),
        pic: '',
        url: ''
    });
    context.ml_save_task_music_file = async (task, _response, _lyrics, song) => {
        if (shouldPause) {
            shouldPause = false;
            task.status = 'paused';
            task.isPaused = true;
            throw error;
        }
        savedSongs.push(song);
    };

    const task = {
        id: 12,
        songs: [blockedSong, unstartedSong],
        remainingSongs: null,
        totalCount: 3,
        completedCount: 1,
        successCount: 1,
        failedCount: 0,
        failedSongs: [],
        progress: 0,
        outputMode: 'folder',
        folderWrittenCount: 1,
        songFailureErrors: new Map(),
        fatalError: null,
        status: 'active',
        isPaused: false,
        abortController: null
    };

    await context.ml_execute_batch_task(task);

    assert.equal(task.status, 'paused');
    assert.equal(task.fatalError, null);
    assert.deepEqual(Array.from(task.remainingSongs, song => song.id), [2, 3]);
    assert.equal(alerts.length, 0);

    task.status = 'active';
    task.isPaused = false;
    await context.ml_execute_batch_task(task);

    assert.deepEqual(savedSongs, [blockedSong, unstartedSong]);
    assert.equal(task.successCount, 3);
    assert.equal(task.failedCount, 0);
    assert.equal(task.failedSongs.length, 0);
    assert.equal(alerts.length, 0);
});

test('browser-managed and direct-write tasks use different completion semantics', () => {
    const context = loadScript('static/ml-task-manager.js');

    assert.equal(context.ml_task_uses_browser_download({ type: 'single', outputMode: 'individual' }), true);
    assert.equal(context.ml_task_uses_browser_download({ type: 'batch', outputMode: 'zip' }), false);
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

test('streaming ZIP writes each song directly and finalizes the selected file', async () => {
    const zippedFiles = [];
    let writerOptions = null;
    let closed = false;
    let writableAborted = false;
    class FakeReader {
        constructor(data) { this.data = data; }
    }
    class FakeZipWriter {
        constructor(writable, options) {
            this.writable = writable;
            writerOptions = options;
        }
        async add(name, reader, options) {
            zippedFiles.push({ name, data: reader.data, options });
        }
        async close() { closed = true; }
    }
    const context = loadScript('static/ml-task-manager.js', {
        zip: { ZipWriter: FakeZipWriter, Uint8ArrayReader: FakeReader },
        window: {
            addEventListener() {},
            removeEventListener() {},
            showSaveFilePicker() {}
        }
    });
    const writable = {
        async abort() { writableAborted = true; }
    };
    const task = {
        outputMode: 'zip',
        zipFileHandle: { async createWritable() { return writable; } },
        zipWritable: null,
        zipWriter: null,
        zipAbortController: null,
        zipEntryCount: 0,
        zipFinalized: false,
        zipAborted: false,
        usedFileNames: new Set(),
        status: 'active',
        isPaused: false
    };

    await context.ml_prepare_streaming_zip_task(task);
    await context.ml_add_music_file_to_zip(task, {
        fileName: 'one.flac',
        data: new Uint8Array(1024)
    });
    await context.ml_add_music_file_to_zip(task, {
        fileName: 'two.flac',
        data: new Uint8Array(2048)
    });
    await context.ml_finish_zip_task(task);

    assert.equal(writerOptions.level, 0);
    assert.equal(writerOptions.bufferedWrite, false);
    assert.equal(writerOptions.useWebWorkers, false);
    assert.deepEqual(zippedFiles.map(file => file.name), ['one.flac', 'two.flac']);
    assert.deepEqual(zippedFiles.map(file => file.data.byteLength), [1024, 2048]);
    assert.equal(zippedFiles.every(file => file.options.level === 0), true);
    assert.equal(task.zipEntryCount, 2);
    assert.equal(task.zipFinalized, true);
    assert.equal(task.zipWriter, null);
    assert.equal(closed, true);
    assert.equal(writableAborted, false);
});

test('cancelling a streaming ZIP aborts the selected file transaction', async () => {
    let abortCount = 0;
    class FakeZipWriter {}
    class FakeReader {}
    const context = loadScript('static/ml-task-manager.js', {
        zip: { ZipWriter: FakeZipWriter, Uint8ArrayReader: FakeReader },
        window: {
            addEventListener() {},
            removeEventListener() {},
            showSaveFilePicker() {}
        }
    });
    const task = {
        outputMode: 'zip',
        zipFileHandle: {
            async createWritable() {
                return { async abort() { abortCount++; } };
            }
        },
        zipWritable: null,
        zipWriter: null,
        zipAbortController: null,
        zipFinalized: false,
        zipAborted: false
    };

    await context.ml_prepare_streaming_zip_task(task);
    const signal = task.zipAbortController.signal;
    await context.ml_abort_streaming_zip_task(task);
    await context.ml_abort_streaming_zip_task(task);

    assert.equal(signal.aborted, true);
    assert.equal(abortCount, 1);
    assert.equal(task.zipAborted, true);
    assert.equal(task.zipWriter, null);
});

test('a streaming ZIP entry failure is fatal and releases its reserved name', async () => {
    class FakeReader {
        constructor(data) { this.data = data; }
    }
    const context = loadScript('static/ml-task-manager.js', {
        zip: { ZipWriter: class {}, Uint8ArrayReader: FakeReader },
        window: {
            addEventListener() {},
            removeEventListener() {},
            showSaveFilePicker() {}
        }
    });
    const task = {
        outputMode: 'zip',
        zipWriter: {
            async add() { throw new DOMException('Disk full', 'QuotaExceededError'); }
        },
        zipEntryCount: 0,
        usedFileNames: new Set()
    };

    await assert.rejects(
        context.ml_add_music_file_to_zip(task, {
            fileName: 'song.flac',
            data: new Uint8Array(1024)
        }),
        error => error.name === 'ZipWriteError' && error.mlZipWriteFatal === true
    );

    assert.equal(task.zipEntryCount, 0);
    assert.equal(task.usedFileNames.has('song.flac'), false);
});

test('streaming ZIP support requires both the picker and zip.js APIs', () => {
    const supported = loadScript('static/ml-task-manager.js', {
        zip: { ZipWriter: class {}, Uint8ArrayReader: class {} },
        window: {
            addEventListener() {},
            removeEventListener() {},
            showSaveFilePicker() {}
        }
    });
    const unsupported = loadScript('static/ml-task-manager.js');

    assert.equal(supported.ml_is_streaming_zip_supported(), true);
    assert.equal(unsupported.ml_is_streaming_zip_supported(), false);
});

test('ZIP task creation selects the destination before queueing the task', async () => {
    const selectedHandle = { name: 'Album.zip' };
    let pickerOptions = null;
    const context = loadScript('static/ml-task-manager.js', {
        zip: { ZipWriter: class {}, Uint8ArrayReader: class {} },
        window: {
            addEventListener() {},
            removeEventListener() {},
            async showSaveFilePicker(options) {
                pickerOptions = options;
                return selectedHandle;
            }
        }
    });
    context.ml_get_collection_download_mode = () => 'zip';
    context.ml_prompt_collection_download_name = async () => 'Album';
    context.ml_create_task = options => options;

    const taskOptions = await context.ml_add_batch_task(
        [{ id: 1 }, { id: 2 }],
        'Album',
        '',
        '',
        'lossless'
    );

    assert.equal(pickerOptions.suggestedName, 'Album.zip');
    assert.equal(pickerOptions.types[0].accept['application/zip'][0], '.zip');
    assert.equal(taskOptions.outputMode, 'zip');
    assert.equal(taskOptions.zipFileHandle, selectedHandle);
});

test('unsupported streaming ZIP falls back to individual downloads', async () => {
    const alerts = [];
    const context = loadScript('static/ml-task-manager.js');
    context.ml_get_collection_download_mode = () => 'zip';
    context.ml_prompt_collection_download_name = async () => 'Album';
    context.ml_show_Alert = (...args) => alerts.push(args);
    context.ml_create_task = options => options;

    const taskOptions = await context.ml_add_batch_task(
        [{ id: 1 }, { id: 2 }],
        'Album',
        '',
        '',
        'lossless'
    );

    assert.equal(taskOptions.outputMode, 'individual');
    assert.equal(taskOptions.zipFileHandle, null);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0][0], 'ZIP不可用');
});

test('ZIP picker errors fall back to individual downloads', async () => {
    const alerts = [];
    const context = loadScript('static/ml-task-manager.js', {
        zip: { ZipWriter: class {}, Uint8ArrayReader: class {} },
        window: {
            addEventListener() {},
            removeEventListener() {},
            async showSaveFilePicker() {
                throw new DOMException('Picker blocked', 'SecurityError');
            }
        },
        console: { log() {}, warn() {}, error() {} }
    });
    context.ml_get_collection_download_mode = () => 'zip';
    context.ml_prompt_collection_download_name = async () => 'Album';
    context.ml_show_Alert = (...args) => alerts.push(args);
    context.ml_create_task = options => options;

    const taskOptions = await context.ml_add_batch_task(
        [{ id: 1 }, { id: 2 }],
        'Album',
        '',
        '',
        'lossless'
    );

    assert.equal(taskOptions.outputMode, 'individual');
    assert.equal(taskOptions.zipFileHandle, null);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0][0], 'ZIP文件选择失败');
});

test('ZIP batch processing keeps only one song in flight', async () => {
    const context = loadScripts(['static/ml-func-plugins.js', 'static/ml-task-manager.js'], {
        console: { log() {}, warn() {}, error() {} }
    });
    let activeSaves = 0;
    let maxActiveSaves = 0;
    context.ml_get_concurrent_count = () => 3;
    context.ml_update_task_item = () => {};
    context.ml_sanitize_lrc_timestamps = lyrics => lyrics;
    context.ml_resolve_lrc_timestamp_conflicts = lyrics => lyrics;
    context.ml_fetch_task_song_info = async songId => ({
        status: 200,
        lyric: '',
        tlyric: '',
        name: String(songId)
    });
    context.ml_save_task_music_file = async () => {
        activeSaves++;
        maxActiveSaves = Math.max(maxActiveSaves, activeSaves);
        await new Promise(resolve => setImmediate(resolve));
        activeSaves--;
    };
    context.ml_finish_zip_task = async () => {};
    const songs = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const task = {
        id: 20,
        songs,
        remainingSongs: null,
        totalCount: songs.length,
        completedCount: 0,
        successCount: 0,
        failedCount: 0,
        failedSongs: [],
        progress: 0,
        outputMode: 'zip',
        zipEntryCount: 0,
        songFailureErrors: new Map(),
        fatalError: null,
        status: 'active',
        isPaused: false,
        abortController: null
    };

    await context.ml_execute_batch_task(task);

    assert.equal(maxActiveSaves, 1);
    assert.equal(task.successCount, 3);
});

test('pausing and resuming a ZIP batch preserves the open writer', async () => {
    const context = loadScripts(['static/ml-func-plugins.js', 'static/ml-task-manager.js'], {
        console: { log() {}, warn() {}, error() {} }
    });
    const songs = [{ id: 1 }, { id: 2 }];
    const savedSongIds = [];
    const writer = {};
    let shouldPause = true;
    let finalizedWriter = null;
    context.ml_get_concurrent_count = () => 3;
    context.ml_update_task_item = () => {};
    context.ml_update_task_panel = () => {};
    context.ml_sanitize_lrc_timestamps = lyrics => lyrics;
    context.ml_resolve_lrc_timestamp_conflicts = lyrics => lyrics;
    context.ml_fetch_task_song_info = async songId => ({
        status: 200,
        lyric: '',
        tlyric: '',
        name: String(songId)
    });
    context.ml_save_task_music_file = async (task, _response, _lyrics, song) => {
        savedSongIds.push(song.id);
        if (shouldPause) {
            shouldPause = false;
            task.status = 'paused';
            task.isPaused = true;
        }
    };
    context.ml_finish_zip_task = async task => {
        finalizedWriter = task.zipWriter;
    };
    const task = {
        id: 21,
        songs,
        remainingSongs: null,
        totalCount: songs.length,
        completedCount: 0,
        successCount: 0,
        failedCount: 0,
        failedSongs: [],
        progress: 0,
        outputMode: 'zip',
        zipWriter: writer,
        zipEntryCount: 1,
        songFailureErrors: new Map(),
        fatalError: null,
        status: 'active',
        isPaused: false,
        abortController: null
    };

    await context.ml_execute_batch_task(task);
    assert.equal(task.status, 'paused');
    assert.equal(task.zipWriter, writer);
    assert.deepEqual(Array.from(task.remainingSongs, song => song.id), [2]);

    task.status = 'active';
    task.isPaused = false;
    await context.ml_execute_batch_task(task);

    assert.deepEqual(savedSongIds, [1, 2]);
    assert.equal(task.successCount, 2);
    assert.equal(finalizedWriter, writer);
});

test('ZIP initialization failure marks the task failed and runs cleanup', async () => {
    const alerts = [];
    const failedToasts = [];
    const context = loadScript('static/ml-task-manager.js', {
        zip: { ZipWriter: class {}, Uint8ArrayReader: class {} },
        window: {
            addEventListener() {},
            removeEventListener() {},
            showSaveFilePicker() {}
        },
        console: { log() {}, warn() {}, error() {} }
    });
    context.ml_update_task_panel = () => {};
    context.ml_update_task_badge = () => {};
    context.ml_show_task_started_toast = () => {};
    context.ml_show_task_failed_toast = task => failedToasts.push(task.id);
    context.ml_show_Alert = (...args) => alerts.push(args);
    context.ml_process_task_queue = () => {};
    const songs = [{ id: 1 }, { id: 2 }];
    const task = {
        id: 22,
        type: 'batch',
        status: 'waiting',
        songs,
        totalCount: songs.length,
        successCount: 0,
        failedCount: 0,
        failedSongs: [],
        completedCount: 0,
        progress: 0,
        outputMode: 'zip',
        zipFileHandle: {
            async createWritable() {
                throw new DOMException('Permission denied', 'NotAllowedError');
            }
        },
        zipWritable: null,
        zipWriter: null,
        zipAbortController: null,
        zipEntryCount: 0,
        zipFinalized: false,
        zipAborted: false,
        zipFailureNotified: false,
        isPaused: false,
        abortController: null
    };

    await context.ml_start_task(task);

    assert.equal(task.status, 'failed');
    assert.equal(task.successCount, 0);
    assert.equal(task.failedCount, 2);
    assert.deepEqual(Array.from(task.failedSongs, song => song.id), [1, 2]);
    assert.equal(task.zipAborted, true);
    assert.deepEqual(failedToasts, [22]);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0][0], 'ZIP写入失败');
});

test('folder fallback before the first write submits the built file individually', async () => {
    const alerts = [];
    const submittedFiles = [];
    const context = loadScripts(['static/ml-func-plugins.js', 'static/ml-task-manager.js']);
    context.ml_build_music_file = async () => ({
        data: new Uint8Array([1, 2, 3]),
        mimeType: 'audio/flac',
        fileName: 'song.flac'
    });
    context.ml_get_unique_folder_file_name = async (_handle, fileName, usedNames) => {
        usedNames.add(fileName);
        return fileName;
    };
    context.ml_write_data_to_folder = async () => {
        throw new DOMException('Permission denied', 'NotAllowedError');
    };
    context.ml_with_browser_download_slot = operation => operation();
    context.ml_trigger_built_music_file_download = async file => submittedFiles.push(file.fileName);
    context.ml_show_Alert = (...args) => alerts.push(args);
    const task = {
        outputMode: 'folder',
        folderHandle: {},
        folderWrittenCount: 0,
        usedFileNames: new Set(),
        folderFallbackNotified: false,
        status: 'active',
        isPaused: false,
        abortController: null
    };

    await context.ml_save_task_music_file(task, {}, '', {});

    assert.equal(task.outputMode, 'individual');
    assert.deepEqual(submittedFiles, ['song.flac']);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0][0], '已改单独下载');
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
