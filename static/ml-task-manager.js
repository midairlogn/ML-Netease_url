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

        // State management
        isPaused: false,
        abortController: null,
        startTime: null,

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
function ml_add_batch_task(songs, title, description, cover, level) {
    // If only 1 song, treat as single song task
    if (songs.length === 1) {
        return ml_add_single_song_task(songs[0], level);
    }

    return ml_create_task({
        type: ML_TASK_TYPE.BATCH,
        title: title || `${songs.length} songs`,
        subtitle: description || '',
        cover: cover || (songs[0] ? songs[0].picUrl : ''),
        description: description,
        songs: songs,
        level: level
    });
}

// ===== Task Processing =====

/**
 * Process the task queue
 */
async function ml_process_task_queue() {
    if (ml_task_manager.isProcessing) return;
    ml_task_manager.isProcessing = true;

    try {
        while (true) {
            // 使用固定的最大活动任务数 (1)
            const activeTasks = ml_task_manager.tasks.filter(t => t.status === ML_TASK_STATUS.ACTIVE);
            const waitingTasks = ml_task_manager.tasks.filter(t => t.status === ML_TASK_STATUS.WAITING);

            // Check if we can start more tasks
            if (activeTasks.length >= MAX_ACTIVE_TASKS || waitingTasks.length === 0) {
                break;
            }

            // Start next waiting task
            const nextTask = waitingTasks[0];
            await ml_start_task(nextTask);
        }
    } finally {
        ml_task_manager.isProcessing = false;
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
        if (task.status !== ML_TASK_STATUS.CANCELLED) {
            task.status = ML_TASK_STATUS.COMPLETED;
            task.progress = 100;
            // 显示任务完成通知
            ml_show_task_completed_toast(task);
        }
    } catch (error) {
        console.error(`Task ${task.id} failed:`, error);
        if (task.status !== ML_TASK_STATUS.CANCELLED) {
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
        const response = await $.post(ml_song_info_post_url_base + '/Song_V1', {
            url: song.id,
            level: task.level,
            type: 'json'
        });

        if (response.status === 200) {
            task.progress = 30;
            ml_update_task_item(task);

            let processedLyrics = response.lyric;
            if (response.tlyric) {
                processedLyrics = lrctran(response.lyric, response.tlyric);
            }

            // Check if paused
            while (task.isPaused && task.status !== ML_TASK_STATUS.CANCELLED) {
                await new Promise(resolve => setTimeout(resolve, 200));
            }

            if (task.status === ML_TASK_STATUS.CANCELLED) return;

            // Download music
            await ml_music_download(
                response.al_name,
                response.ar_name,
                processedLyrics,
                response.name,
                response.pic,
                response.url,
                task.level
            );

            task.successCount = 1;
            task.completedCount = 1;
            task.progress = 100;
        } else {
            throw new Error(response.msg || 'Failed to get song info');
        }
    } catch (error) {
        task.failedCount = 1;
        task.failedSongs = [song];
        throw error;
    }
}

/**
 * Execute a batch download task
 */
async function ml_execute_batch_task(task) {
    const concurrentCount = ml_get_concurrent_count();
    let songQueue = [...task.songs];
    let attempt = 0;

    while (songQueue.length > 0 && attempt < ml_max_try_times && task.status !== ML_TASK_STATUS.CANCELLED) {
        if (attempt > 0) {
            console.log(`Task ${task.id}: Retry attempt ${attempt}, remaining: ${songQueue.length}`);
        }

        const currentRoundFailed = [];

        // Process in batches
        for (let i = 0; i < songQueue.length && task.status !== ML_TASK_STATUS.CANCELLED; i += concurrentCount) {
            // Check if paused
            while (task.isPaused && task.status !== ML_TASK_STATUS.CANCELLED) {
                task.status = ML_TASK_STATUS.PAUSED;
                ml_update_task_panel();
                await new Promise(resolve => setTimeout(resolve, 200));
            }

            if (task.status === ML_TASK_STATUS.CANCELLED) break;

            // Resume from paused state
            if (task.status === ML_TASK_STATUS.PAUSED) {
                task.status = ML_TASK_STATUS.ACTIVE;
                ml_update_task_panel();
            }

            const batch = songQueue.slice(i, i + concurrentCount);

            // Download batch in parallel
            const downloadPromises = batch.map(async (song) => {
                if (task.status === ML_TASK_STATUS.CANCELLED) {
                    return { success: false, song: song, cancelled: true };
                }

                try {
                    const response = await $.post(ml_song_info_post_url_base + '/Song_V1', {
                        url: song.id,
                        level: task.level,
                        type: 'json'
                    });

                    if (response.status === 200) {
                        let processedLyrics = response.lyric;
                        if (response.tlyric) {
                            processedLyrics = lrctran(response.lyric, response.tlyric);
                        }

                        await ml_music_download(
                            response.al_name,
                            response.ar_name,
                            processedLyrics,
                            response.name,
                            response.pic,
                            response.url,
                            task.level
                        );

                        return { success: true, song: song };
                    } else {
                        return { success: false, song: song, error: new Error(response.msg) };
                    }
                } catch (error) {
                    return { success: false, song: song, error: error };
                }
            });

            const results = await Promise.all(downloadPromises);

            // Update task progress
            results.forEach(result => {
                if (result.cancelled) return;

                task.completedCount++;
                if (result.success) {
                    task.successCount++;
                } else {
                    task.failedCount++;
                    currentRoundFailed.push(result.song);
                }

                task.progress = (task.completedCount / task.totalCount) * 100;
                ml_update_task_item(task);
            });
        }

        // Prepare for retry
        songQueue = currentRoundFailed;
        if (songQueue.length > 0) {
            task.completedCount = task.totalCount - songQueue.length;
            task.failedCount = 0;
        }
        attempt++;
    }

    task.failedSongs = songQueue;
}

// ===== Task Control =====

/**
 * Pause a task
 */
function ml_pause_task(taskId) {
    const task = ml_task_manager.tasks.find(t => t.id === taskId);
    if (!task) return;

    task.isPaused = true;
    task.pauseStartTime = Date.now();
    ml_update_task_panel();

    // 显示暂停通知
    ml_show_task_paused_toast(task);
}

/**
 * Resume a task
 */
function ml_resume_task(taskId) {
    const task = ml_task_manager.tasks.find(t => t.id === taskId);
    if (!task) return;

    task.isPaused = false;

    // Compensate pause time
    if (task.pauseStartTime && task.startTime) {
        const pausedDuration = Date.now() - task.pauseStartTime;
        task.startTime += pausedDuration;
    }
    task.pauseStartTime = null;

    // If task was waiting, restart queue processing
    if (task.status === ML_TASK_STATUS.PAUSED) {
        task.status = ML_TASK_STATUS.ACTIVE;
    }

    ml_update_task_panel();

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
            statusText = '完成';
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

    ml_toast_manager.toasts.push(toast);

    // 创建Toast元素
    const toastHtml = ml_create_toast_html(toast);
    $('#ml-toast-container').append(toastHtml);

    // 动画显示
    setTimeout(() => {
        $(`#ml-toast-${toastId}`).addClass('show');
    }, 50);

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

    $toast.removeClass('show');

    setTimeout(() => {
        $toast.remove();
        ml_toast_manager.toasts = ml_toast_manager.toasts.filter(t => t.id !== toastId);
        ml_manage_toast_stack();
    }, 300);
}

/**
 * 管理Toast堆叠显示
 */
function ml_manage_toast_stack() {
    const $toasts = $('#ml-toast-container .ml-toast');
    const maxVisible = ml_toast_manager.maxVisibleToasts;

    $toasts.each(function(index) {
        const reverseIndex = $toasts.length - 1 - index;
        if (reverseIndex >= maxVisible) {
            $(this).addClass('collapsed');
        } else {
            $(this).removeClass('collapsed');
        }
    });
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
    ml_show_toast({
        type: 'completed',
        title: task.title,
        subtitle: task.type === ML_TASK_TYPE.BATCH ?
            `${task.successCount}/${task.totalCount} 首歌曲下载完成` :
            task.subtitle,
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
