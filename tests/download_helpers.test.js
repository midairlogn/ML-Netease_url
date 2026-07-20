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

function loadScript(relativePath, overrides = {}) {
    const context = vm.createContext({
        console,
        document: {},
        window: { addEventListener() {} },
        DOMException,
        setTimeout,
        clearTimeout,
        $: createJQueryStub(),
        ...overrides
    });
    const source = fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
    vm.runInContext(source, context, { filename: relativePath });
    return context;
}

test('blob download URL remains valid until the cleanup timer runs', () => {
    const timers = [];
    const revokedUrls = [];
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
        setTimeout(callback, delay) {
            timers.push({ callback, delay });
            return timers.length;
        }
    });

    context.ml_trigger_blob_download({ size: 1024 }, 'song.flac');

    assert.equal(anchor.href, 'blob:test-download');
    assert.equal(anchor.download, 'song.flac');
    assert.equal(clicked, true);
    assert.equal(appended, true);
    assert.equal(removed, true);
    assert.deepEqual(revokedUrls, []);
    assert.equal(timers.length, 1);
    assert.equal(timers[0].delay, 10000);

    timers[0].callback();
    assert.deepEqual(revokedUrls, ['blob:test-download']);
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
        context.ml_write_blob_to_folder(folderHandle, 'song.flac', { size: 1024 }),
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
        context.ml_write_blob_to_folder(folderHandle, 'song.flac', { size: 1024 }),
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
