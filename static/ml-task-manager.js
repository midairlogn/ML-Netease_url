// ml-task-manager.js - Download Task Manager

// ===== Task Manager State =====
var ml_task_manager = {
    tasks: [],           // All tasks
    taskIdCounter: 0,    // Unique ID counter
    isProcessing: false  // Whether task processor is running
};

// Task status enum
const ML_TASK_STATUS = {
    WAITING: 'waiting',
    ACTIVE: 'active',
    PAUSED: 'paused',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled'
};

// Task type enum
const ML_TASK_TYPE = {
    SINGLE: 'single',      // Single song download
    BATCH: 'batch'         // Playlist/Album batch download
};

const ML_COLLECTION_DOWNLOAD_MODE = {
    INDIVIDUAL: 'individual',
    ZIP: 'zip',
    FOLDER: 'folder'
};

// ===== Settings =====
// 最大同时进行的任务数固定为1
const MAX_ACTIVE_TASKS = 1;

// 下载按钮冷却时间（毫秒）
const DOWNLOAD_BUTTON_COOLDOWN = 1500;

/* 最大任务数设置已注释
const DEFAULT_MAX_TASKS = 3;

function ml_get_max_download_tasks() {
    const val = parseInt($('#max-download-tasks').val());
    if (isNaN(val) || val < 1) return DEFAULT_MAX_TASKS;
    if (val > 10) return 10;
    return val;
}
*/

// 下载按钮冷却 - 点击后禁用按钮一段时间
function ml_apply_download_cooldown(buttonElement) {
    if (!buttonElement) return;

    const $btn = $(buttonElement);
    $btn.addClass('btn-cooldown');
    $btn.prop('disabled', true);

    // 冷却结束后恢复按钮
    setTimeout(() => {
        $btn.removeClass('btn-cooldown');
        $btn.prop('disabled', false);
    }, DOWNLOAD_BUTTON_COOLDOWN);
}

// ===== Task Creation =====

/**
 * Create a new download task
 * @param {object} options - Task options
 * @returns {object} - Created task object
 */
function ml_create_task(options) {
    const taskId = ++ml_task_manager.taskIdCounter;

    const task = {
        id: taskId,
        type: options.type || ML_TASK_TYPE.SINGLE,
        status: ML_TASK_STATUS.WAITING,

        // Display info
        title: options.title || '',
        subtitle: options.subtitle || '',
        cover: options.cover || '',
        description: options.description || '',

        // For single song
        songData: options.songData || null,

        // For batch download
        songs: options.songs || [],
        totalCount: options.songs ? options.songs.length : 1,
        completedCount: 0,
        successCount: 0,
        failedCount: 0,
        failedSongs: [],

        // Progress
        progress: 0,

        // Download settings
        level: options.level || 'standard',
        outputMode: options.outputMode || ML_COLLECTION_DOWNLOAD_MODE.INDIVIDUAL,
        sourceType: options.sourceType || null,
        collectionName: options.collectionName || options.title || '',
        folderHandle: options.folderHandle || null,
        generatedFiles: [],
        usedFileNames: new Set(),
        folderFallbackNotified: false,
        folderWrittenCount: 0,
        fatalError: null,
        songFailureErrors: new Map(),

        // State management
        isPaused: false,
        abortController: null,
        startTime: null,
        remainingSongs: null,

        // ETA calculation
        emaSpeed: null,
        speedHistory: [],
        pauseStartTime: null
    };

    ml_task_manager.tasks.push(task);
    ml_update_task_panel();
    ml_update_task_badge();

    // 显示任务添加通知
    ml_show_task_added_toast(task);

    // Start task processor if not running
    ml_process_task_queue();

    return task;
}

/**
 * Add a single song download task
 */
function ml_add_single_song_task(songData, level) {
    return ml_create_task({
        type: ML_TASK_TYPE.SINGLE,
        title: songData.name || songData.title || 'Unknown',
        subtitle: songData.artists || songData.ar_name || 'Unknown Artist',
        cover: songData.picUrl || songData.pic || '',
        songData: songData,
        songs: [songData],
        level: level
    });
}

/**
 * Add a batch download task (playlist/album)
 */
async function ml_add_batch_task(songs, title, description, cover, level, options = {}) {
    // If only 1 song, treat as single song task
    if (songs.length === 1) {
        return ml_add_single_song_task(songs[0], level);
    }

    const outputMode = ml_get_collection_download_mode();
    const defaultName = title || options.collectionId || `${songs.length} songs`;
    const collectionName = await ml_prompt_collection_download_name(defaultName, outputMode);
    if (collectionName === null) {
        return null;
    }

    let finalOutputMode = outputMode;
    let folderHandle = null;

    if (finalOutputMode === ML_COLLECTION_DOWNLOAD_MODE.FOLDER) {
        if (!window.showDirectoryPicker) {
            ml_show_Alert('浏览器不支持', '当前浏览器不支持选择文件夹，将改为下载ZIP压缩包。', 'warning');
            finalOutputMode = ML_COLLECTION_DOWNLOAD_MODE.ZIP;
        } else {
            try {
                const parentHandle = await window.showDirectoryPicker({
                    id: 'ml-netease-download-folder',
                    mode: 'readwrite',
                    startIn: 'downloads'
                });

                if (!await ml_verify_directory_writable(parentHandle)) {
                    ml_show_Alert('没有文件夹写入权限', '浏览器没有授予所选文件夹的写入权限，将改为下载ZIP压缩包。请避免选择受保护目录，或在浏览器权限弹窗中允许写入。', 'warning');
                    finalOutputMode = ML_COLLECTION_DOWNLOAD_MODE.ZIP;
                } else {
                    folderHandle = await parentHandle.getDirectoryHandle(ml_sanitize_path_segment(collectionName), { create: true });

                    if (!await ml_verify_directory_writable(folderHandle)) {
                        ml_show_Alert('没有子文件夹写入权限', '浏览器没有授予目标子文件夹的写入权限，将改为下载ZIP压缩包。', 'warning');
                        finalOutputMode = ML_COLLECTION_DOWNLOAD_MODE.ZIP;
                        folderHandle = null;
                    }
                }
            } catch (error) {
                if (error?.name !== 'AbortError') {
                    ml_show_Alert('文件夹选择失败', '无法访问所选文件夹或浏览器拒绝写入，将改为下载ZIP压缩包。', 'warning');
                    finalOutputMode = ML_COLLECTION_DOWNLOAD_MODE.ZIP;
                    folderHandle = null;
                } else {
                    return null;
                }
            }
        }
    }

    if (finalOutputMode === ML_COLLECTION_DOWNLOAD_MODE.ZIP && typeof JSZip === 'undefined') {
        ml_show_Alert('ZIP不可用', 'ZIP组件未加载，将改为单独文件下载。', 'warning');
        finalOutputMode = ML_COLLECTION_DOWNLOAD_MODE.INDIVIDUAL;
    }

    return ml_create_task({
        type: ML_TASK_TYPE.BATCH,
        title: collectionName,
        subtitle: description || '',
        cover: cover || (songs[0] ? songs[0].picUrl : ''),
        description: description,
        songs: songs,
        level: level,
        outputMode: finalOutputMode,
        sourceType: options.sourceType || null,
        collectionName: collectionName,
        folderHandle: folderHandle
    });
}

function ml_get_collection_download_mode() {
    const mode = localStorage.getItem('ml_collection_download_mode') || ML_COLLECTION_DOWNLOAD_MODE.INDIVIDUAL;
    return Object.values(ML_COLLECTION_DOWNLOAD_MODE).includes(mode) ? mode : ML_COLLECTION_DOWNLOAD_MODE.INDIVIDUAL;
}

function ml_task_uses_browser_download(task) {
    return task.type === ML_TASK_TYPE.SINGLE || task.outputMode !== ML_COLLECTION_DOWNLOAD_MODE.FOLDER;
}

async function ml_prompt_collection_download_name(defaultName, outputMode) {
    const fallbackName = defaultName || 'download';
    const input = await ml_show_collection_name_prompt(fallbackName, outputMode);
    if (input === null) return null;

    const sanitized = ml_sanitize_path_segment(input.trim() || fallbackName);
    return sanitized || 'download';
}

function ml_get_collection_prompt_text(outputMode) {
    if (outputMode === ML_COLLECTION_DOWNLOAD_MODE.ZIP) {
        return {
            title: '设置ZIP压缩包名称',
            message: '请输入本次多曲下载的ZIP文件名。系统会自动添加 .zip 后缀。'
        };
    }
    if (outputMode === ML_COLLECTION_DOWNLOAD_MODE.FOLDER) {
        return {
            title: '设置目标文件夹名称',
            message: '请输入本次多曲下载要创建的文件夹名称。下一步请选择保存位置；如果浏览器拒绝写入，将自动改为ZIP下载。'
        };
    }
    return {
        title: '设置下载任务名称',
        message: '请输入本次多曲下载任务的名称。单曲文件仍会按文件名模板分别下载。'
    };
}

function ml_show_collection_name_prompt(defaultName, outputMode) {
    return new Promise((resolve) => {
        const promptText = ml_get_collection_prompt_text(outputMode);
        let modalElement = document.getElementById('ml_collection_name_modal');

        if (!modalElement) {
            modalElement = document.createElement('div');
            modalElement.className = 'modal fade';
            modalElement.id = 'ml_collection_name_modal';
            modalElement.tabIndex = -1;
            modalElement.setAttribute('aria-hidden', 'true');
            modalElement.innerHTML = `
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title" id="ml_collection_name_modal_title">设置下载名称</h5>
                            <button type="button" class="btn-close" id="ml_collection_name_close" aria-label="Close"></button>
                        </div>
                        <div class="modal-body">
                            <p class="text-muted small mb-2" id="ml_collection_name_modal_message"></p>
                            <label for="ml_collection_name_input" class="form-label">名称</label>
                            <input type="text" class="form-control" id="ml_collection_name_input" maxlength="120">
                            <div class="form-text">不能使用 \\ / : * ? &quot; &lt; &gt; |，这些字符会自动替换为下划线。</div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-outline-secondary" id="ml_collection_name_cancel">取消</button>
                            <button type="button" class="btn btn-primary" id="ml_collection_name_confirm">确定</button>
                        </div>
                    </div>
                </div>`;
            document.body.appendChild(modalElement);
        }

        const input = modalElement.querySelector('#ml_collection_name_input');
        const title = modalElement.querySelector('#ml_collection_name_modal_title');
        const message = modalElement.querySelector('#ml_collection_name_modal_message');
        const confirmButton = modalElement.querySelector('#ml_collection_name_confirm');
        const cancelButton = modalElement.querySelector('#ml_collection_name_cancel');
        const closeButton = modalElement.querySelector('#ml_collection_name_close');

        title.textContent = promptText.title;
        message.textContent = promptText.message;
        input.value = defaultName;

        const modal = bootstrap.Modal.getOrCreateInstance(modalElement, { backdrop: 'static' });
        let resolved = false;

        const cleanup = () => {
            confirmButton.removeEventListener('click', onConfirm);
            cancelButton.removeEventListener('click', onCancel);
            closeButton.removeEventListener('click', onCancel);
            input.removeEventListener('keydown', onKeyDown);
            modalElement.removeEventListener('hidden.bs.modal', onHidden);
        };

        const finish = (value) => {
            if (resolved) return;
            resolved = true;
            cleanup();
            resolve(value);
        };

        const onConfirm = () => {
            const value = input.value.trim() || defaultName;
            document.activeElement?.blur();
            modal.hide();
            finish(value);
        };

        const onCancel = () => {
            document.activeElement?.blur();
            modal.hide();
            finish(null);
        };

        const onKeyDown = (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                onConfirm();
            }
        };

        const onHidden = () => finish(null);

        confirmButton.addEventListener('click', onConfirm);
        cancelButton.addEventListener('click', onCancel);
        closeButton.addEventListener('click', onCancel);
        input.addEventListener('keydown', onKeyDown);
        modalElement.addEventListener('hidden.bs.modal', onHidden);

        modal.show();
        setTimeout(() => {
            input.focus();
            input.select();
        }, 150);
    });
}

async function ml_ensure_directory_write_permission(directoryHandle) {
    if (!directoryHandle) return false;
    const options = { mode: 'readwrite' };

    if (typeof directoryHandle.queryPermission === 'function') {
        const currentPermission = await directoryHandle.queryPermission(options);
        if (currentPermission === 'granted') return true;
    }

    if (typeof directoryHandle.requestPermission === 'function') {
        return await directoryHandle.requestPermission(options) === 'granted';
    }

    return true;
}

function ml_is_folder_write_blocked_error(error) {
    if (ml_is_storage_io_error(error)) return false;

    return error?.name === 'NotAllowedError' ||
        error?.name === 'SecurityError' ||
        error?.name === 'AbortError' ||
        /system file|permission|denied|not allowed|security/i.test(error?.message || '');
}

function ml_is_storage_io_error(error) {
    return error?.name === 'NotReadableError' ||
        error?.name === 'QuotaExceededError' ||
        error?.name === 'UnknownError' ||
        /disk|space|quota|swap file|could not be read|file operation|i\/o/i.test(error?.message || '');
}

function ml_get_storage_failed_songs(task) {
    return task.failedSongs.filter(song => ml_is_storage_io_error(task.songFailureErrors.get(song)));
}

async function ml_verify_directory_writable(directoryHandle) {
    if (!await ml_ensure_directory_write_permission(directoryHandle)) {
        return false;
    }

    const probeName = `.ml-write-test-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
    let writable = null;
    let fileCreated = false;
    try {
        const fileHandle = await directoryHandle.getFileHandle(probeName, { create: true });
        fileCreated = true;
        writable = await fileHandle.createWritable();
        await writable.write('ok');
        await writable.close();
        writable = null;
        return true;
    } catch (error) {
        console.warn('Folder write probe failed:', error);
        return false;
    } finally {
        if (writable && typeof writable.abort === 'function') {
            try {
                await writable.abort();
            } catch (abortError) {
                console.warn('Failed to abort folder write probe:', abortError);
            }
        }

        if (fileCreated && typeof directoryHandle.removeEntry === 'function') {
            try {
                await directoryHandle.removeEntry(probeName);
            } catch (removeError) {
                if (removeError?.name !== 'NotFoundError') {
                    console.warn('Failed to remove folder write probe:', removeError);
                }
            }
        }
    }
}

function ml_sanitize_path_segment(value) {
    return String(value || '')
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/[\x00-\x1f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[. ]+$/g, '')
        .substring(0, 120);
}

function ml_split_file_name(fileName) {
    const safeInput = String(fileName || '').trim();
    const dotIndex = safeInput.lastIndexOf('.');
    if (dotIndex <= 0 || dotIndex === safeInput.length - 1) {
        return { base: safeInput, ext: '' };
    }
    return {
        base: safeInput.slice(0, dotIndex),
        ext: safeInput.slice(dotIndex)
    };
}

function ml_format_safe_file_name(base, ext, suffix = '') {
    const safeExt = ml_sanitize_path_segment(ext).substring(0, 16);
    const maxBaseLength = Math.max(1, 120 - safeExt.length - suffix.length);
    const safeBase = (ml_sanitize_path_segment(base) || 'music')
        .substring(0, maxBaseLength)
        .replace(/[. ]+$/g, '') || 'music';
    return `${safeBase}${suffix}${safeExt}`;
}

function ml_sanitize_file_name(fileName) {
    const parts = ml_split_file_name(fileName);
    return ml_format_safe_file_name(parts.base, parts.ext);
}

function ml_get_unique_file_name(fileName, usedFileNames) {
    const safeName = ml_sanitize_file_name(fileName) || 'music.mp3';
    if (!usedFileNames.has(safeName)) {
        usedFileNames.add(safeName);
        return safeName;
    }

    const { base, ext } = ml_split_file_name(safeName);
    let index = 2;
    let candidate = ml_format_safe_file_name(base, ext, ` (${index})`);
    while (usedFileNames.has(candidate)) {
        index++;
        candidate = ml_format_safe_file_name(base, ext, ` (${index})`);
    }
    usedFileNames.add(candidate);
    return candidate;
}

async function ml_folder_file_exists(folderHandle, fileName) {
    try {
        await folderHandle.getFileHandle(fileName, { create: false });
        return true;
    } catch (error) {
        if (error?.name === 'NotFoundError') return false;
        if (error?.name === 'TypeMismatchError') return true;
        throw error;
    }
}

async function ml_get_unique_folder_file_name(folderHandle, fileName, usedFileNames) {
    const safeName = ml_sanitize_file_name(fileName) || 'music.mp3';
    const { base, ext } = ml_split_file_name(safeName);
    let index = 1;

    while (true) {
        const suffix = index === 1 ? '' : ` (${index})`;
        const candidate = ml_format_safe_file_name(base, ext, suffix);

        if (usedFileNames.has(candidate)) {
            index++;
            continue;
        }

        usedFileNames.add(candidate);
        let exists;
        try {
            exists = await ml_folder_file_exists(folderHandle, candidate);
        } catch (error) {
            usedFileNames.delete(candidate);
            throw error;
        }

        if (!exists) {
            return candidate;
        }

        index++;
    }
}

async function ml_write_data_to_folder(folderHandle, fileName, data) {
    let writable = null;
    let stage = 'get-file-handle';
    let fileHandleAcquired = false;

    try {
        const fileHandle = await folderHandle.getFileHandle(fileName, { create: true });
        fileHandleAcquired = true;
        stage = 'create-writable';
        writable = await fileHandle.createWritable();
        stage = 'write';
        await writable.write(data);
        stage = 'close';
        await writable.close();
        writable = null;
    } catch (error) {
        if (writable && typeof writable.abort === 'function') {
            try {
                await writable.abort();
            } catch (abortError) {
                console.warn(`Failed to abort folder writer for ${fileName}:`, abortError);
            }
        }

        if (fileHandleAcquired && typeof folderHandle.removeEntry === 'function') {
            try {
                await folderHandle.removeEntry(fileName);
            } catch (removeError) {
                if (removeError?.name !== 'NotFoundError') {
                    console.warn(`Failed to remove incomplete folder file ${fileName}:`, removeError);
                }
            }
        }

        try {
            error.mlFolderWriteStage = stage;
        } catch (_) {
            // Some browser-provided DOMException objects are not extensible.
        }
        throw error;
    }
}

// ===== Task Processing =====

/**
 * Process the task queue
 */
async function ml_process_task_queue() {
    if (ml_task_manager.isProcessing) return;
    ml_task_manager.isProcessing = true;

    try {
        // 使用固定的最大活动任务数 (1)
        const activeTasks = ml_task_manager.tasks.filter(t => t.status === ML_TASK_STATUS.ACTIVE);
        const waitingTasks = ml_task_manager.tasks.filter(t => t.status === ML_TASK_STATUS.WAITING);

        // Check if we can start more tasks
        if (activeTasks.length >= MAX_ACTIVE_TASKS || waitingTasks.length === 0) {
            return;
        }

        // Start next waiting task without awaiting it. Keeping the queue processor
        // locked for the full download can strand waiting tasks when an active task
        // is cancelled before its async work settles.
        ml_start_task(waitingTasks[0]);
    } finally {
        ml_task_manager.isProcessing = false;
    }
}

/**
 * Fetch song details for a task with cancellation support.
 */
async function ml_fetch_task_song_info(songId, level, signal) {
    const params = new URLSearchParams({
        url: songId,
        level: level,
        type: 'json'
    });

    const timeout = ml_create_timeout_signal(signal, ML_SONG_INFO_FETCH_TIMEOUT_MS, '获取歌曲信息超时，请稍后重试');
    try {
        const response = await fetch(ml_song_info_post_url_base + '/Song_V1', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
            },
            body: params.toString(),
            signal: timeout.signal
        });

        if (!response.ok) {
            throw new Error(`Failed to get song info: ${response.status}`);
        }

        return response.json();
    } catch (error) {
        throw timeout.normalizeError(error);
    } finally {
        timeout.cleanup();
    }
}

/**
 * Start executing a task
 */
async function ml_start_task(task) {
    task.status = ML_TASK_STATUS.ACTIVE;
    task.startTime = Date.now();
    task.abortController = new AbortController();

    // 显示任务开始通知
    ml_show_task_started_toast(task);

    ml_update_task_panel();

    try {
        if (task.type === ML_TASK_TYPE.SINGLE) {
            await ml_execute_single_task(task);
        } else {
            await ml_execute_batch_task(task);
        }

        // Task completed successfully
        if (task.status === ML_TASK_STATUS.ACTIVE) {
            task.status = task.failedSongs && task.failedSongs.length > 0 ? ML_TASK_STATUS.FAILED : ML_TASK_STATUS.COMPLETED;
            task.progress = 100;
            if (task.status === ML_TASK_STATUS.FAILED) {
                ml_show_task_failed_toast(task);
            } else {
                // 显示任务完成通知
                ml_show_task_completed_toast(task);
            }
        }
    } catch (error) {
        console.error(`Task ${task.id} failed:`, error);
        if (task.status === ML_TASK_STATUS.ACTIVE) {
            task.status = ML_TASK_STATUS.FAILED;
        }
    } finally {
        ml_update_task_panel();
        ml_update_task_badge();

        // Process next task in queue
        setTimeout(() => ml_process_task_queue(), 100);
    }
}

/**
 * Execute a single song download task
 */
async function ml_execute_single_task(task) {
    const song = task.songData || task.songs[0];

    try {
        // Fetch song info
        const response = await ml_fetch_task_song_info(song.id, task.level, task.abortController ? task.abortController.signal : undefined);

        if (response.status === 200) {
            task.progress = 30;
            ml_update_task_item(task);

            let processedLyrics = response.lyric;
            if (response.tlyric) {
                processedLyrics = lrctran(
                    ml_sanitize_lrc_timestamps(response.lyric),
                    ml_sanitize_lrc_timestamps(response.tlyric)
                );
            } else {
                processedLyrics = ml_sanitize_lrc_timestamps(processedLyrics);
            }
            processedLyrics = ml_resolve_lrc_timestamp_conflicts(processedLyrics);

            if (task.status === ML_TASK_STATUS.CANCELLED || task.status === ML_TASK_STATUS.PAUSED || task.isPaused) return;

            // Download music
            await ml_music_download(
                response.al_name,
                response.ar_name,
                processedLyrics,
                response.name,
                response.pic,
                response.url,
                task.level,
                song.trackNumber,
                song.totalTracks,
                task.abortController ? task.abortController.signal : undefined
            );

            if (task.status === ML_TASK_STATUS.CANCELLED) return;

            task.successCount = 1;
            task.completedCount = 1;
            task.progress = 100;
        } else {
            ml_show_error_toast(response, '解析失败', '无法获取歌曲信息');
            throw new Error(response.msg || 'Failed to get song info');
        }
    } catch (error) {
        if (task.status === ML_TASK_STATUS.CANCELLED || error?.name === 'AbortError') {
            return;
        }
        task.failedCount = 1;
        task.failedSongs = [song];
        // If it was a network error and not already handled by ml_show_error_toast
        if (error instanceof TypeError || error?.name === 'AbortError') {
             ml_show_error_toast(error, '解析失败', '网络请求错误');
        }
        throw error;
    }
}

async function ml_save_task_music_file(task, response, processedLyrics, song) {
    if (task.outputMode === ML_COLLECTION_DOWNLOAD_MODE.INDIVIDUAL) {
        await ml_music_download(
            response.al_name,
            response.ar_name,
            processedLyrics,
            response.name,
            response.pic,
            response.url,
            task.level,
            song.trackNumber,
            song.totalTracks,
            task.abortController ? task.abortController.signal : undefined
        );
        return;
    }

    const musicFile = await ml_build_music_file(
        response.al_name,
        response.ar_name,
        processedLyrics,
        response.name,
        response.pic,
        response.url,
        task.level,
        song.trackNumber,
        song.totalTracks,
        task.abortController ? task.abortController.signal : undefined
    );

    if (task.status !== ML_TASK_STATUS.ACTIVE || task.isPaused) {
        throw new DOMException('Download cancelled', 'AbortError');
    }

    if (task.outputMode === ML_COLLECTION_DOWNLOAD_MODE.ZIP) {
        const fileName = ml_get_unique_file_name(musicFile.fileName, task.usedFileNames);
        task.generatedFiles.push({ fileName: fileName, data: musicFile.data });
        return;
    }

    if (task.outputMode === ML_COLLECTION_DOWNLOAD_MODE.FOLDER) {
        if (!task.folderHandle) {
            throw new Error('Folder handle is not available');
        }

        let fileName = null;
        try {
            fileName = await ml_get_unique_folder_file_name(task.folderHandle, musicFile.fileName, task.usedFileNames);
            await ml_write_data_to_folder(task.folderHandle, fileName, musicFile.data);
            task.folderWrittenCount = (task.folderWrittenCount || 0) + 1;
        } catch (error) {
            if (!ml_is_folder_write_blocked_error(error)) {
                if (fileName) {
                    task.usedFileNames.delete(fileName);
                }
                throw error;
            }

            if (task.folderWrittenCount > 0) {
                if (fileName) {
                    task.usedFileNames.delete(fileName);
                }
                const partialFolderError = new Error('Folder write permission was lost after files were written');
                partialFolderError.name = 'FolderOutputBlockedError';
                partialFolderError.mlPartialFolderOutput = true;
                partialFolderError.mlFolderWriteStage = error.mlFolderWriteStage;
                partialFolderError.cause = error;
                throw partialFolderError;
            }

            task.outputMode = ML_COLLECTION_DOWNLOAD_MODE.ZIP;
            task.folderHandle = null;
            task.generatedFiles.push({ fileName: fileName || ml_get_unique_file_name(musicFile.fileName, task.usedFileNames), data: musicFile.data });

            if (!task.folderFallbackNotified) {
                task.folderFallbackNotified = true;
                ml_show_Alert('已改为ZIP下载', '浏览器拒绝写入所选文件夹，当前任务将继续处理并在完成后下载ZIP压缩包。普通浏览器下载仍会保存到你的默认下载目录。', 'warning');
            }
        }
    }
}

async function ml_finish_zip_task(task) {
    if (task.outputMode !== ML_COLLECTION_DOWNLOAD_MODE.ZIP || task.generatedFiles.length === 0) {
        return;
    }
    if (task.status !== ML_TASK_STATUS.ACTIVE || task.isPaused) {
        return;
    }
    if (typeof JSZip === 'undefined') {
        throw new Error('JSZip is not available');
    }

    const zip = new JSZip();
    task.generatedFiles.forEach(file => {
        zip.file(file.fileName, file.data);
    });

    let submitted = false;
    await ml_with_browser_download_slot(async () => {
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        if (task.status !== ML_TASK_STATUS.ACTIVE || task.isPaused) {
            return;
        }

        await ml_trigger_blob_download(zipBlob, `${ml_sanitize_path_segment(task.collectionName || task.title || 'download')}.zip`);
        submitted = true;
    });

    if (submitted) {
        task.generatedFiles = [];
    }
}

/**
 * Execute a batch download task
 */
async function ml_execute_batch_task(task) {
    const concurrentCount = ml_get_concurrent_count();
    let songQueue = task.remainingSongs ? [...task.remainingSongs] : [...task.songs];
    let attempt = 0;

    task.failedCount = 0;
    task.failedSongs = [];
    task.completedCount = task.successCount;
    task.progress = (task.completedCount / task.totalCount) * 100;

    while (songQueue.length > 0 && attempt < ml_max_try_times && task.status === ML_TASK_STATUS.ACTIVE && !task.fatalError) {
        if (attempt > 0) {
            console.log(`Task ${task.id}: Retry attempt ${attempt}, remaining: ${songQueue.length}`);
        }

        const currentRoundFailed = [];
        const cancelledSongs = [];

        async function downloadNextSong() {
            while (songQueue.length > 0 && task.status === ML_TASK_STATUS.ACTIVE && !task.isPaused && !task.fatalError) {
                const song = songQueue.shift();

                try {
                    const response = await ml_fetch_task_song_info(song.id, task.level, task.abortController ? task.abortController.signal : undefined);

                    if (task.status !== ML_TASK_STATUS.ACTIVE || task.isPaused) {
                        cancelledSongs.push(song);
                        return;
                    }

                    if (response.status !== 200) {
                        throw new Error(response.msg || 'Failed to get song info');
                    }

                    let processedLyrics = response.lyric;
                    if (response.tlyric) {
                        processedLyrics = lrctran(
                            ml_sanitize_lrc_timestamps(response.lyric),
                            ml_sanitize_lrc_timestamps(response.tlyric)
                        );
                    } else {
                        processedLyrics = ml_sanitize_lrc_timestamps(processedLyrics);
                    }
                    processedLyrics = ml_resolve_lrc_timestamp_conflicts(processedLyrics);

                    await ml_save_task_music_file(task, response, processedLyrics, song);

                    if (task.status === ML_TASK_STATUS.CANCELLED) {
                        return;
                    }

                    task.completedCount++;
                    task.successCount++;
                    task.songFailureErrors.delete(song);
                } catch (error) {
                    if (task.status === ML_TASK_STATUS.CANCELLED || error?.name === 'AbortError') {
                        cancelledSongs.push(song);
                        return;
                    }

                    if (error?.mlPartialFolderOutput) {
                        task.fatalError = error;
                        currentRoundFailed.push(song);
                        return;
                    }

                    task.songFailureErrors.set(song, error);
                    if (ml_is_storage_io_error(error)) {
                        console.warn(`Task ${task.id}: browser storage failed during ${error.mlFolderWriteStage || 'file processing'}.`, error);
                    }

                    console.warn(`Task ${task.id}: song ${song.id || song.name || 'unknown'} failed, will retry if attempts remain.`, error);
                    currentRoundFailed.push(song);
                }

                task.completedCount = task.successCount + task.failedCount;
                task.progress = (task.completedCount / task.totalCount) * 100;
                ml_update_task_item(task);
            }
        }

        const workerCount = task.outputMode === ML_COLLECTION_DOWNLOAD_MODE.FOLDER ?
            1 : Math.min(concurrentCount, songQueue.length);
        const workers = Array.from({ length: workerCount }, () => downloadNextSong());
        await Promise.all(workers);

        if (task.fatalError) {
            songQueue = [...currentRoundFailed, ...songQueue];
            break;
        }

        if (task.status === ML_TASK_STATUS.CANCELLED) {
            task.generatedFiles = [];
            break;
        }

        if (task.isPaused || task.status === ML_TASK_STATUS.PAUSED) {
            task.status = ML_TASK_STATUS.PAUSED;
            task.remainingSongs = [...currentRoundFailed, ...cancelledSongs, ...songQueue];
            ml_update_task_panel();
            return;
        }

        // Prepare for retry
        songQueue = currentRoundFailed;
        task.remainingSongs = songQueue;
        task.failedCount = 0;
        task.completedCount = task.successCount;
        task.progress = (task.completedCount / task.totalCount) * 100;
        ml_update_task_item(task);
        attempt++;
    }

    task.failedSongs = songQueue;
    task.failedCount = songQueue.length;
    task.completedCount = task.successCount + task.failedCount;
    task.progress = (task.completedCount / task.totalCount) * 100;
    task.remainingSongs = [];

    if (task.fatalError?.mlPartialFolderOutput) {
        ml_show_Alert(
            '文件夹下载中断',
            `已有 ${task.folderWrittenCount} 首歌曲写入文件夹，之后浏览器失去了文件夹写入权限。为避免生成不完整的ZIP，剩余 ${task.failedCount} 首歌曲未继续下载，请恢复权限后重新下载。`,
            'error'
        );
    }

    const storageFailedSongs = ml_get_storage_failed_songs(task);
    if (storageFailedSongs.length > 0) {
        const failedNames = task.failedSongs.map(song => song.name || song.id).join('\n');
        const zipNotice = task.outputMode === ML_COLLECTION_DOWNLOAD_MODE.ZIP && task.generatedFiles.length > 0 ?
            `ZIP压缩包只包含已成功下载的 ${task.successCount} 首歌曲。\n\n` : '';
        const otherFailedCount = task.failedCount - storageFailedSongs.length;
        const otherFailureNotice = otherFailedCount > 0 ? `另有 ${otherFailedCount} 首因其他原因失败。\n\n` : '';
        ml_show_Alert(
            otherFailedCount > 0 ? '部分歌曲下载失败' : '浏览器存储失败',
            `${zipNotice}有 ${storageFailedSongs.length} 首歌曲在写入浏览器临时存储或目标文件夹时失败。${otherFailureNotice}请释放系统盘和目标磁盘空间、降低同时下载数后重试。\n\n${failedNames}`,
            'error'
        );
    } else if (task.failedSongs.length > 0 && task.outputMode === ML_COLLECTION_DOWNLOAD_MODE.ZIP && task.generatedFiles.length > 0) {
        const failedNames = task.failedSongs.map(song => song.name || song.id).join('\n');
        ml_show_Alert('部分歌曲下载失败', `ZIP压缩包只包含已成功下载的 ${task.successCount} 首歌曲。\n失败: ${task.failedCount} 首\n\n${failedNames}`, 'warning');
    }

    if (task.status === ML_TASK_STATUS.ACTIVE) {
        await ml_finish_zip_task(task);
    }
}

// ===== Task Control =====

/**
 * Pause a task
 */
function ml_pause_task(taskId) {
    const task = ml_task_manager.tasks.find(t => t.id === taskId);
    if (!task) return;
    if (task.status === ML_TASK_STATUS.PAUSED ||
        task.status === ML_TASK_STATUS.COMPLETED ||
        task.status === ML_TASK_STATUS.FAILED ||
        task.status === ML_TASK_STATUS.CANCELLED) return;

    task.isPaused = true;
    task.status = ML_TASK_STATUS.PAUSED;
    task.pauseStartTime = Date.now();

    if (task.abortController) {
        task.abortController.abort();
    }

    ml_update_task_panel();
    ml_update_task_badge();

    // 显示暂停通知
    ml_show_task_paused_toast(task);

    // A paused task no longer occupies the active slot.
    setTimeout(() => ml_process_task_queue(), 100);
}

/**
 * Resume a task
 */
function ml_resume_task(taskId) {
    const task = ml_task_manager.tasks.find(t => t.id === taskId);
    if (!task) return;
    if (task.status !== ML_TASK_STATUS.PAUSED) return;

    task.isPaused = false;

    // Compensate pause time
    if (task.pauseStartTime && task.startTime) {
        const pausedDuration = Date.now() - task.pauseStartTime;
        task.startTime += pausedDuration;
    }
    task.pauseStartTime = null;

    // Resumed tasks re-enter the pending queue and will start when a slot is free.
    task.status = ML_TASK_STATUS.WAITING;

    ml_update_task_panel();

    // Ensure a resumed waiting/paused task can be picked up if no task is active.
    setTimeout(() => ml_process_task_queue(), 100);

    // 显示继续通知
    ml_show_task_resumed_toast(task);
}

/**
 * Cancel a task
 */
async function ml_cancel_task(taskId) {
    const task = ml_task_manager.tasks.find(t => t.id === taskId);
    if (!task) return;

    const confirmed = await ml_show_Confirm('取消任务', '确定要取消这个下载任务吗？');
    if (!confirmed) return;

    task.status = ML_TASK_STATUS.CANCELLED;
    task.isPaused = false;

    if (task.abortController) {
        task.abortController.abort();
    }

    ml_update_task_panel();
    ml_update_task_badge();

    // 显示取消通知
    ml_show_task_cancelled_toast(task);

    // Process next task
    setTimeout(() => ml_process_task_queue(), 100);
}

/**
 * Remove a completed/failed/cancelled task
 */
function ml_remove_task(taskId) {
    const index = ml_task_manager.tasks.findIndex(t => t.id === taskId);
    if (index !== -1) {
        ml_task_manager.tasks.splice(index, 1);
        ml_update_task_panel();
        ml_update_task_badge();
    }
}

/**
 * Clear all completed tasks
 */
function ml_clear_completed_tasks() {
    ml_task_manager.tasks = ml_task_manager.tasks.filter(t =>
        t.status !== ML_TASK_STATUS.COMPLETED &&
        t.status !== ML_TASK_STATUS.FAILED &&
        t.status !== ML_TASK_STATUS.CANCELLED
    );
    ml_update_task_panel();
    ml_update_task_badge();
}

// ===== UI Updates =====

/**
 * Update task manager badge
 */
function ml_update_task_badge() {
    const activeTasks = ml_task_manager.tasks.filter(t =>
        t.status === ML_TASK_STATUS.ACTIVE ||
        t.status === ML_TASK_STATUS.WAITING ||
        t.status === ML_TASK_STATUS.PAUSED
    );

    const $badge = $('#task-manager-badge');
    if (activeTasks.length > 0) {
        $badge.text(activeTasks.length).removeClass('d-none');
    } else {
        $badge.addClass('d-none');
    }
}

/**
 * Update entire task panel
 */
function ml_update_task_panel() {
    const tasks = ml_task_manager.tasks;

    // Categorize tasks
    const activeTasks = tasks.filter(t => t.status === ML_TASK_STATUS.ACTIVE);
    const waitingTasks = tasks.filter(t =>
        t.status === ML_TASK_STATUS.WAITING || t.status === ML_TASK_STATUS.PAUSED
    );
    const completedTasks = tasks.filter(t =>
        t.status === ML_TASK_STATUS.COMPLETED ||
        t.status === ML_TASK_STATUS.FAILED ||
        t.status === ML_TASK_STATUS.CANCELLED
    );

    // Update counts
    $('#active-task-count').text(activeTasks.length);
    $('#waiting-task-count').text(waitingTasks.length);
    $('#completed-task-count').text(completedTasks.length);

    // Render task lists
    ml_render_task_list('#active-tasks', '#active-tasks-empty', activeTasks);
    ml_render_task_list('#waiting-tasks', '#waiting-tasks-empty', waitingTasks);
    ml_render_task_list('#completed-tasks', '#completed-tasks-empty', completedTasks);
}

/**
 * Render a task list
 */
function ml_render_task_list(containerSelector, emptySelector, tasks) {
    const $container = $(containerSelector);
    const $empty = $(emptySelector);

    if (tasks.length === 0) {
        $container.empty();
        $empty.show();
        return;
    }

    $empty.hide();

    // Update existing or add new task items
    const existingIds = $container.find('.task-item').map(function() {
        return parseInt($(this).data('task-id'));
    }).get();

    const taskIds = tasks.map(t => t.id);

    // Remove tasks that no longer exist
    $container.find('.task-item').each(function() {
        const id = parseInt($(this).data('task-id'));
        if (!taskIds.includes(id)) {
            $(this).remove();
        }
    });

    // Add or update tasks
    tasks.forEach(task => {
        const $existing = $container.find(`.task-item[data-task-id="${task.id}"]`);
        if ($existing.length > 0) {
            ml_update_task_item_element($existing, task);
        } else {
            $container.append(ml_create_task_item_html(task));
        }
    });
}

/**
 * Update a single task item
 */
function ml_update_task_item(task) {
    const $item = $(`.task-item[data-task-id="${task.id}"]`);
    if ($item.length > 0) {
        ml_update_task_item_element($item, task);
    }
}

/**
 * Update task item element
 */
function ml_update_task_item_element($item, task) {
    // Update progress bar
    $item.find('.progress-bar').css('width', task.progress + '%');

    // Update stats
    if (task.type === ML_TASK_TYPE.BATCH) {
        $item.find('.task-item-stats-left').text(
            `${task.completedCount}/${task.totalCount} (${task.successCount}/${task.failedCount})`
        );
    }
    $item.find('.task-item-stats-right').text(task.progress.toFixed(1) + '%');

    // Update class
    $item.removeClass('paused completed failed waiting');
    if (task.status === ML_TASK_STATUS.PAUSED) $item.addClass('paused');
    if (task.status === ML_TASK_STATUS.COMPLETED) $item.addClass('completed');
    if (task.status === ML_TASK_STATUS.FAILED) $item.addClass('failed');
    if (task.status === ML_TASK_STATUS.WAITING) $item.addClass('waiting');

    // Update buttons
    const $pauseBtn = $item.find('.task-pause-btn');
    if (task.isPaused) {
        $pauseBtn.text('继续').removeClass('btn-warning').addClass('btn-success');
    } else {
        $pauseBtn.text('暂停').removeClass('btn-success').addClass('btn-warning');
    }
}

/**
 * Create task item HTML
 */
function ml_create_task_item_html(task) {
    const statusClass = task.status === ML_TASK_STATUS.PAUSED ? 'paused' :
                       task.status === ML_TASK_STATUS.COMPLETED ? 'completed' :
                       task.status === ML_TASK_STATUS.FAILED ? 'failed' :
                       task.status === ML_TASK_STATUS.WAITING ? 'waiting' : '';

    const isCompleted = task.status === ML_TASK_STATUS.COMPLETED ||
                       task.status === ML_TASK_STATUS.FAILED ||
                       task.status === ML_TASK_STATUS.CANCELLED;

    const showProgress = !isCompleted || task.type === ML_TASK_TYPE.BATCH;

    let statsHtml = '';
    if (task.type === ML_TASK_TYPE.BATCH) {
        statsHtml = `
            <span class="task-item-stats-left">${task.completedCount}/${task.totalCount} (${task.successCount}/${task.failedCount})</span>
            <span class="task-item-stats-right">${task.progress.toFixed(1)}%</span>
        `;
    } else {
        statsHtml = `
            <span class="task-item-stats-left"></span>
            <span class="task-item-stats-right">${task.progress.toFixed(1)}%</span>
        `;
    }

    let actionsHtml = '';
    if (!isCompleted) {
        const pauseText = task.isPaused ? '继续' : '暂停';
        const pauseClass = task.isPaused ? 'btn-success' : 'btn-warning';
        actionsHtml = `
            <button class="btn ${pauseClass} btn-sm task-pause-btn" onclick="ml_toggle_task_pause(${task.id})">${pauseText}</button>
            <button class="btn btn-outline-danger btn-sm" onclick="ml_cancel_task(${task.id})">取消</button>
        `;
    } else {
        let statusText = '';
        let statusClass = '';
        let statusIcon = '';
        if (task.status === ML_TASK_STATUS.COMPLETED) {
            statusText = ml_task_uses_browser_download(task) ? '已提交' : '完成';
            statusClass = 'bg-success';
            statusIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16"><path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zm-3.97-3.03a.75.75 0 0 0-1.08.022L7.477 9.417 5.384 7.323a.75.75 0 0 0-1.06 1.06L6.97 11.03a.75.75 0 0 0 1.079-.02l3.992-4.99a.75.75 0 0 0-.01-1.05z"/></svg>';
        } else if (task.status === ML_TASK_STATUS.FAILED) {
            statusText = '失败';
            statusClass = 'bg-danger';
            statusIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16"><path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zM5.354 4.646a.5.5 0 1 0-.708.708L7.293 8l-2.647 2.646a.5.5 0 0 0 .708.708L8 8.707l2.646 2.647a.5.5 0 0 0 .708-.708L8.707 8l2.647-2.646a.5.5 0 0 0-.708-.708L8 7.293 5.354 4.646z"/></svg>';
        } else if (task.status === ML_TASK_STATUS.CANCELLED) {
            statusText = '已取消';
            statusClass = 'bg-secondary';
            statusIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/><path d="M4 8a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7A.5.5 0 0 1 4 8z"/></svg>';
        }
        actionsHtml = `
            <span class="badge ${statusClass} task-status-badge">${statusIcon} ${statusText}</span>
            <button class="btn btn-outline-secondary btn-sm task-remove-btn" onclick="ml_remove_task(${task.id})" title="删除">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
                    <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
                </svg>
            </button>
        `;
    }

    const coverHtml = task.cover ?
        `<img src="${task.cover}" alt="cover" class="task-item-cover">` :
        `<div class="task-item-cover bg-secondary d-flex align-items-center justify-content-center">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="white" viewBox="0 0 16 16">
                <path d="M6 13c0 1.105-1.12 2-2.5 2S1 14.105 1 13c0-1.104 1.12-2 2.5-2s2.5.896 2.5 2zm9-2c0 1.105-1.12 2-2.5 2s-2.5-.895-2.5-2 1.12-2 2.5-2 2.5.895 2.5 2z"/>
                <path fill-rule="evenodd" d="M14 11V2h1v9h-1zM6 3v10H5V3h1z"/>
                <path d="M5 2.905a1 1 0 0 1 .9-.995l8-.8a1 1 0 0 1 1.1.995V3L5 4V2.905z"/>
            </svg>
        </div>`;

    return `
        <div class="task-item ${statusClass}" data-task-id="${task.id}">
            <div class="task-item-header">
                ${coverHtml}
                <div class="task-item-info">
                    <div class="task-item-title">${escapeHtml(task.title)}</div>
                    <div class="task-item-subtitle">${escapeHtml(task.subtitle)}</div>
                </div>
            </div>
            ${showProgress ? `
                <div class="task-item-progress">
                    <div class="progress">
                        <div class="progress-bar progress-bar-striped progress-bar-animated" style="width: ${task.progress}%"></div>
                    </div>
                    <div class="task-item-stats">${statsHtml}</div>
                </div>
            ` : ''}
            <div class="task-item-actions">
                ${actionsHtml}
            </div>
        </div>
    `;
}

/**
 * Toggle task pause state
 */
function ml_toggle_task_pause(taskId) {
    const task = ml_task_manager.tasks.find(t => t.id === taskId);
    if (!task) return;

    if (task.isPaused) {
        ml_resume_task(taskId);
    } else {
        ml_pause_task(taskId);
    }
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ===== Panel Toggle =====

function ml_open_task_panel() {
    $('#task-manager-panel').removeClass('d-none').addClass('show');
    $('#task-manager-overlay').removeClass('d-none').addClass('show');
    $('#task-manager-toggle').addClass('d-none'); // 隐藏按钮
}

function ml_close_task_panel() {
    $('#task-manager-panel').removeClass('show');
    $('#task-manager-overlay').removeClass('show');

    setTimeout(() => {
        $('#task-manager-panel').addClass('d-none');
        $('#task-manager-overlay').addClass('d-none');
        // 只有设置面板也未打开时才显示按钮
        if (!$('#settingsModal').hasClass('show')) {
            $('#task-manager-toggle').removeClass('d-none');
        }
    }, 300);
}

// ===== Toast Notification System =====

var ml_toast_manager = {
    toasts: [],
    toastIdCounter: 0,
    maxVisibleToasts: 5,
    autoCloseDelay: 4000
};

/**
 * 显示Toast通知
 * @param {object} options - Toast选项
 */
function ml_show_toast(options) {
    const toastId = ++ml_toast_manager.toastIdCounter;

    const toast = {
        id: toastId,
        type: options.type || 'info', // 'added', 'completed', 'info'
        title: options.title || '',
        subtitle: options.subtitle || '',
        cover: options.cover || '',
        createdAt: Date.now()
    };

    // 添加到数组头部（最新的在最前）
    ml_toast_manager.toasts.unshift(toast);

    // 创建Toast元素
    const toastHtml = ml_create_toast_html(toast);

    // 插入到容器最前面（视觉上的最下方，因为flex-direction: column）
    // 为了实现从右侧滑入到底部的效果，我们使用 prepend (如果是 column-reverse 则用 append)
    // 根据 CSS 的设计，#ml-toast-container 是 flex-direction: column
    // 所以最新的元素应该添加到后面，或者使用 order 控制
    // 让我们使用 prepend，这样最新的在最上面，但是通过 CSS 控制位置

    // 修改策略：CSS中 #ml-toast-container 使用 flex-direction: column
    // 我们希望新的 toast 出现在最底部。所以使用 append。
    $('#ml-toast-container').append(toastHtml);

    // 强制重绘以确保动画生效
    const $toast = $(`#ml-toast-${toastId}`);
    $toast[0].offsetHeight;

    // 动画显示
    $toast.addClass('show');

    // 自动关闭
    setTimeout(() => {
        ml_close_toast(toastId);
    }, ml_toast_manager.autoCloseDelay);

    // 管理Toast堆叠
    ml_manage_toast_stack();

    return toastId;
}

/**
 * 关闭Toast
 */
function ml_close_toast(toastId) {
    const $toast = $(`#ml-toast-${toastId}`);
    if ($toast.length === 0) return;

    // 标记为正在隐藏
    $toast.addClass('hiding');
    $toast.removeClass('show');

    // 从数组中移除
    ml_toast_manager.toasts = ml_toast_manager.toasts.filter(t => t.id !== toastId);

    // 立即更新其他 Toast 的堆叠状态
    ml_manage_toast_stack();

    // 等待动画结束后移除 DOM
    setTimeout(() => {
        $toast.remove();
        // 再次更新以防万一
        ml_manage_toast_stack();
    }, 400);
}

/**
 * 管理Toast堆叠显示
 */
function ml_manage_toast_stack() {
    const $toasts = $('#ml-toast-container .ml-toast:not(.hiding)');
    const maxVisible = ml_toast_manager.maxVisibleToasts;

    // 获取当前所有活动的 toast ID（从新到旧）
    const activeToastIds = [];
    $toasts.each(function() {
        activeToastIds.push(parseInt($(this).attr('id').replace('ml-toast-', '')));
    });
    // 反转，使得最新的在前面
    activeToastIds.reverse();

    activeToastIds.forEach((id, index) => {
        const $el = $(`#ml-toast-${id}`);

        // 重置所有堆叠类和高度
        $el.removeClass('stacked stacked-2 stacked-hidden');
        $el.css('max-height', '');

        if (index < 3) {
            // 最新的3条，正常完全显示
            $el.css('z-index', 1100 - index);
        } else if (index === 3) {
            // 第4条，堆叠效果1 (位置下调，露出标题)
            $el.addClass('stacked');
            $el.css('z-index', 1090);
        } else if (index === 4) {
            // 第5条，堆叠效果2 (进一步下调)
            $el.addClass('stacked-2');
            $el.css('z-index', 1080);
        } else {
            // 超出5条，隐藏
            $el.addClass('stacked-hidden');
        }
    });

    // 移除超出最大限制的旧 Toast (彻底清理 DOM)
    if (activeToastIds.length > maxVisible) {
        const toRemoveIds = activeToastIds.slice(maxVisible);
        toRemoveIds.forEach(id => {
            const $el = $(`#ml-toast-${id}`);
            if (!$el.hasClass('hiding')) {
                $el.remove();
                ml_toast_manager.toasts = ml_toast_manager.toasts.filter(t => t.id !== id);
            }
        });
    }
}

/**
 * 创建Toast HTML
 */
function ml_create_toast_html(toast) {
    let typeClass, typeIcon, typeText;

    switch (toast.type) {
        case 'added':
            typeClass = 'toast-added';
            typeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
                <path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z"/>
            </svg>`;
            typeText = '已添加';
            break;
        case 'started':
            typeClass = 'toast-started';
            typeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
                <path d="M6.271 5.055a.5.5 0 0 1 .52.038l3.5 2.5a.5.5 0 0 1 0 .814l-3.5 2.5A.5.5 0 0 1 6 10.5v-5a.5.5 0 0 1 .271-.445z"/>
            </svg>`;
            typeText = '开始下载';
            break;
        case 'completed':
            typeClass = 'toast-completed';
            typeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zm-3.97-3.03a.75.75 0 0 0-1.08.022L7.477 9.417 5.384 7.323a.75.75 0 0 0-1.06 1.06L6.97 11.03a.75.75 0 0 0 1.079-.02l3.992-4.99a.75.75 0 0 0-.01-1.05z"/>
            </svg>`;
            typeText = '已完成';
            break;
        case 'submitted':
            typeClass = 'toast-completed';
            typeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
                <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/>
            </svg>`;
            typeText = '已提交下载';
            break;
        case 'search':
            typeClass = 'toast-search';
            typeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/>
            </svg>`;
            typeText = '搜索成功';
            break;
        case 'parse':
            typeClass = 'toast-parse';
            typeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                <path d="M6 13c0 1.105-1.12 2-2.5 2S1 14.105 1 13c0-1.104 1.12-2 2.5-2s2.5.896 2.5 2zm9-2c0 1.105-1.12 2-2.5 2s-2.5-.895-2.5-2 1.12-2 2.5-2 2.5.895 2.5 2z"/>
                <path fill-rule="evenodd" d="M14 11V2h1v9h-1zM6 3v10H5V3h1z"/>
                <path d="M5 2.905a1 1 0 0 1 .9-.995l8-.8a1 1 0 0 1 1.1.995V3L5 4V2.905z"/>
            </svg>`;
            typeText = '解析成功';
            break;
        case 'playlist':
            typeClass = 'toast-playlist';
            typeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                <path d="M12 13c0 1.105-1.12 2-2.5 2S7 14.105 7 13s1.12-2 2.5-2 2.5.895 2.5 2z"/>
                <path fill-rule="evenodd" d="M12 3v10h-1V3h1z"/>
                <path d="M11 2.82a1 1 0 0 1 .804-.98l3-.6A1 1 0 0 1 16 2.22V4l-5 1V2.82z"/>
                <path fill-rule="evenodd" d="M0 11.5a.5.5 0 0 1 .5-.5H4a.5.5 0 0 1 0 1H.5a.5.5 0 0 1-.5-.5zm0-4A.5.5 0 0 1 .5 7H8a.5.5 0 0 1 0 1H.5a.5.5 0 0 1-.5-.5zm0-4A.5.5 0 0 1 .5 3H8a.5.5 0 0 1 0 1H.5a.5.5 0 0 1-.5-.5z"/>
            </svg>`;
            typeText = '歌单解析成功';
            break;
        case 'album':
            typeClass = 'toast-album';
            typeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                <path d="M0 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V6zm6 2.5a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 0-1h-3a.5.5 0 0 0-.5.5zM2 6a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-3A.5.5 0 0 0 3 6H2z"/>
                <path d="M8 1a1 1 0 0 0-1 1v1.5a1 1 0 0 0 1 1h.5a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H8zm3 0a1 1 0 0 0-1 1v1.5a1 1 0 0 0 1 1h.5a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H11z"/>
            </svg>`;
            typeText = '专辑解析成功';
            break;
        case 'paused':
            typeClass = 'toast-paused';
            typeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zM6.25 5C5.56 5 5 5.56 5 6.25v3.5a1.25 1.25 0 1 0 2.5 0v-3.5C7.5 5.56 6.94 5 6.25 5zm3.5 0c-.69 0-1.25.56-1.25 1.25v3.5a1.25 1.25 0 1 0 2.5 0v-3.5C11 5.56 10.44 5 9.75 5z"/>
            </svg>`;
            typeText = '已暂停';
            break;
        case 'resumed':
            typeClass = 'toast-resumed';
            typeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
                <path d="M6.271 5.055a.5.5 0 0 1 .52.038l3.5 2.5a.5.5 0 0 1 0 .814l-3.5 2.5A.5.5 0 0 1 6 10.5v-5a.5.5 0 0 1 .271-.445z"/>
            </svg>`;
            typeText = '已继续';
            break;
        case 'cancelled':
            typeClass = 'toast-cancelled';
            typeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zM5.354 4.646a.5.5 0 1 0-.708.708L7.293 8l-2.647 2.646a.5.5 0 0 0 .708.708L8 8.707l2.646 2.647a.5.5 0 0 0 .708-.708L8.707 8l2.647-2.646a.5.5 0 0 0-.708-.708L8 7.293 5.354 4.646z"/>
            </svg>`;
            typeText = '已取消';
            break;
        case 'error':
            typeClass = 'toast-error';
            typeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zM8 4a.905.905 0 0 0-.9.995l.35 3.507a.552.552 0 0 0 1.1 0l.35-3.507A.905.905 0 0 0 8 4zm.002 6a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/>
            </svg>`;
            typeText = '处理失败';
            break;
        default:
            typeClass = 'toast-info';
            typeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                <path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm.93-9.412-1 4.705c-.07.34.029.533.304.533.194 0 .487-.07.686-.246l-.088.416c-.287.346-.92.598-1.465.598-.703 0-1.002-.422-.808-1.319l.738-3.468c.064-.293.006-.399-.287-.47l-.451-.081.082-.381 2.29-.287zM8 5.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"/>
            </svg>`;
            typeText = '提示';
    }

    const coverHtml = toast.cover ?
        `<img src="${toast.cover}" alt="cover" class="ml-toast-cover">` :
        `<div class="ml-toast-cover ml-toast-cover-placeholder">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                <path d="M6 13c0 1.105-1.12 2-2.5 2S1 14.105 1 13c0-1.104 1.12-2 2.5-2s2.5.896 2.5 2zm9-2c0 1.105-1.12 2-2.5 2s-2.5-.895-2.5-2 1.12-2 2.5-2 2.5.895 2.5 2z"/>
                <path fill-rule="evenodd" d="M14 11V2h1v9h-1zM6 3v10H5V3h1z"/>
                <path d="M5 2.905a1 1 0 0 1 .9-.995l8-.8a1 1 0 0 1 1.1.995V3L5 4V2.905z"/>
            </svg>
        </div>`;

    return `
        <div id="ml-toast-${toast.id}" class="ml-toast ${typeClass}">
            <div class="ml-toast-header">
                <span class="ml-toast-type-icon">${typeIcon}</span>
                <span class="ml-toast-type-text">${typeText}</span>
                <button class="ml-toast-close" onclick="ml_close_toast(${toast.id})">&times;</button>
            </div>
            <div class="ml-toast-body">
                ${coverHtml}
                <div class="ml-toast-info">
                    <div class="ml-toast-title">${escapeHtml(toast.title)}</div>
                    <div class="ml-toast-subtitle">${escapeHtml(toast.subtitle)}</div>
                </div>
            </div>
        </div>
    `;
}

/**
 * 显示任务添加通知
 */
function ml_show_task_added_toast(task) {
    ml_show_toast({
        type: 'added',
        title: task.title,
        subtitle: task.subtitle,
        cover: task.cover
    });
}

/**
 * 显示任务开始下载通知
 */
function ml_show_task_started_toast(task) {
    ml_show_toast({
        type: 'started',
        title: task.title,
        subtitle: task.type === ML_TASK_TYPE.BATCH ?
            `开始下载 ${task.totalCount} 首歌曲` :
            '开始下载',
        cover: task.cover
    });
}

/**
 * 显示任务完成通知
 */
function ml_show_task_completed_toast(task) {
    const usesBrowserDownload = ml_task_uses_browser_download(task);
    ml_show_toast({
        type: usesBrowserDownload ? 'submitted' : 'completed',
        title: task.title,
        subtitle: usesBrowserDownload ?
            (task.type === ML_TASK_TYPE.BATCH ?
                `${task.successCount}/${task.totalCount} 首歌曲已提交，请在浏览器下载列表确认` :
                '已提交，请在浏览器下载列表确认') :
            `${task.successCount}/${task.totalCount} 首歌曲已写入文件夹`,
        cover: task.cover
    });
}

/**
 * 显示任务失败通知
 */
function ml_show_task_failed_toast(task) {
    ml_show_toast({
        type: 'error',
        title: task.title,
        subtitle: task.type === ML_TASK_TYPE.BATCH ?
            `${task.successCount}/${task.totalCount} 首歌曲下载完成，${task.failedCount} 首失败` :
            '下载失败',
        cover: task.cover
    });
}

/**
 * 显示搜索成功通知
 */
function ml_show_search_success_toast(count) {
    ml_show_toast({
        type: 'search',
        title: '搜索成功',
        subtitle: `找到 ${count} 首相关歌曲`,
        cover: ''
    });
}

/**
 * 显示单曲解析成功通知
 */
function ml_show_parse_success_toast(songName, artist, cover) {
    ml_show_toast({
        type: 'parse',
        title: songName,
        subtitle: artist,
        cover: cover
    });
}

/**
 * 显示歌单解析成功通知
 */
function ml_show_playlist_success_toast(playlistName, count, cover) {
    ml_show_toast({
        type: 'playlist',
        title: playlistName,
        subtitle: `共 ${count} 首歌曲`,
        cover: cover
    });
}

/**
 * 显示专辑解析成功通知
 */
function ml_show_album_success_toast(albumName, artist, count, cover) {
    ml_show_toast({
        type: 'album',
        title: albumName,
        subtitle: `${artist} · ${count} 首歌曲`,
        cover: cover
    });
}

/**
 * 显示任务暂停通知
 */
function ml_show_task_paused_toast(task) {
    ml_show_toast({
        type: 'paused',
        title: task.title,
        subtitle: task.type === ML_TASK_TYPE.BATCH ?
            `已暂停 (${task.completedCount}/${task.totalCount})` :
            '下载已暂停',
        cover: task.cover
    });
}

/**
 * 显示任务继续通知
 */
function ml_show_task_resumed_toast(task) {
    ml_show_toast({
        type: 'resumed',
        title: task.title,
        subtitle: task.type === ML_TASK_TYPE.BATCH ?
            `继续下载 (${task.completedCount}/${task.totalCount})` :
            '下载已继续',
        cover: task.cover
    });
}

/**
 * 显示任务取消通知
 */
function ml_show_task_cancelled_toast(task) {
    ml_show_toast({
        type: 'cancelled',
        title: task.title,
        subtitle: task.type === ML_TASK_TYPE.BATCH ?
            `已取消 (${task.successCount}/${task.totalCount} 已完成)` :
            '下载已取消',
        cover: task.cover
    });
}

/**
 * 显示错误通知
 * 优先显示 error.msg，否则使用默认提示
 */
function ml_show_error_toast(error, defaultTitle, defaultSubtitle) {
    let subtitle = defaultSubtitle;

    if (error && error.msg) {
        subtitle = error.msg;
    } else if (typeof error === 'string') {
        subtitle = error;
    }

    ml_show_toast({
        type: 'error',
        title: defaultTitle || '处理失败',
        subtitle: subtitle,
        cover: ''
    });
}

// ===== Page Unload Warning =====

/**
 * Check if there are incomplete tasks (active, waiting, or paused)
 * @returns {boolean} - True if there are incomplete tasks
 */
function ml_has_incomplete_tasks() {
    return ml_task_manager.tasks.some(t =>
        t.status === ML_TASK_STATUS.ACTIVE ||
        t.status === ML_TASK_STATUS.WAITING ||
        t.status === ML_TASK_STATUS.PAUSED
    );
}

/**
 * Handle beforeunload event to warn user about incomplete tasks
 */
window.addEventListener('beforeunload', function(e) {
    if (ml_has_incomplete_tasks()) {
        // Standard way to trigger browser's confirmation dialog
        e.preventDefault();
        // For older browsers, return a string (modern browsers ignore the custom message)
        e.returnValue = '您有未完成的下载任务，确定要离开吗？';
        return e.returnValue;
    }
});

// ===== Initialize =====

$(document).ready(function() {
    // 创建Toast容器
    if ($('#ml-toast-container').length === 0) {
        $('body').append('<div id="ml-toast-container"></div>');
    }

    // Toggle button
    $('#task-manager-toggle').on('click', function() {
        if ($('#task-manager-panel').hasClass('show')) {
            ml_close_task_panel();
        } else {
            ml_open_task_panel();
        }
    });

    // Close button
    $('#task-manager-close').on('click', ml_close_task_panel);

    // Overlay click to close
    $('#task-manager-overlay').on('click', ml_close_task_panel);

    // Clear completed tasks
    $('#clear-completed-tasks').on('click', ml_clear_completed_tasks);

    // 监听设置面板打开/关闭事件
    $('#settingsModal').on('show.bs.modal', function() {
        $('#task-manager-toggle').addClass('d-none');
    });

    $('#settingsModal').on('hidden.bs.modal', function() {
        // 只有任务面板也未打开时才显示按钮
        if (!$('#task-manager-panel').hasClass('show')) {
            $('#task-manager-toggle').removeClass('d-none');
        }
    });

    /* 最大任务数设置相关代码已注释
    // Max download tasks input validation
    $('#max-download-tasks').on('change blur', function() {
        let val = parseInt($(this).val());
        const min = parseInt($(this).attr('min'));
        const max = parseInt($(this).attr('max'));
        if (isNaN(val) || val < min) {
            val = min;
        } else if (val > max) {
            val = max;
        }
        $(this).val(val);
    });

    // Load max download tasks setting
    let savedMaxTasks = localStorage.getItem('ml_max_download_tasks');
    if (savedMaxTasks === null) {
        savedMaxTasks = DEFAULT_MAX_TASKS.toString();
        localStorage.setItem('ml_max_download_tasks', savedMaxTasks);
    }
    $('#max-download-tasks').val(savedMaxTasks);

    // Save max download tasks on change
    $('#max-download-tasks').on('change', function() {
        localStorage.setItem('ml_max_download_tasks', $(this).val());
    });
    */

    // Initial panel update
    ml_update_task_panel();
});
