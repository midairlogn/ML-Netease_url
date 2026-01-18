// ml-func-plugins

var ml_song_info_post_url_base = '';

function lrctrim(lyrics) {
    const lines = lyrics.split('\n');
    const data = [];

    lines.forEach((line, index) => {
        const matches = line.match(/\[(\d{2}):(\d{2}[\.:]?\d*)]/);
        if (matches) {
            const minutes = parseInt(matches[1], 10);
            const seconds = parseFloat(matches[2].replace('.', ':')) || 0;
            const timestamp = minutes * 60000 + seconds * 1000;

            let text = line.replace(/\[\d{2}:\d{2}[\.:]?\d*\]/g, '').trim();
            text = text.replace(/\s\s+/g, ' '); // Replace multiple spaces with a single space

            data.push([timestamp, index, text]);
        }
    });

    data.sort((a, b) => a[0] - b[0]);

    return data;
}

function lrctran(lyric, tlyric) {
    lyric = lrctrim(lyric);
    tlyric = lrctrim(tlyric);

    let len1 = lyric.length;
    let len2 = tlyric.length;
    let result = "";

    for (let i = 0, j = 0; i < len1 && j < len2; i++) {
        while (lyric[i][0] > tlyric[j][0] && j + 1 < len2) {
            j++;
        }

        if (lyric[i][0] === tlyric[j][0]) {
            tlyric[j][2] = tlyric[j][2].replace('/', '');
            if (tlyric[j][2]) {
                lyric[i][2] += ` (翻译：${tlyric[j][2]})`;
            }
            j++;
        }
    }

    for (let i = 0; i < len1; i++) {
        let t = lyric[i][0];
        result += `[${String(Math.floor(t / 60000)).padStart(2, '0')}:${String(Math.floor((t % 60000) / 1000)).padStart(2, '0')}.${String(t % 1000).padStart(3, '0')}]${lyric[i][2]}\n`;
    }

    return result;
}

function extractLinks(text) {
    var regex = /https?:\/\/\S+/g;
    var matches = text.match(regex);
    if (matches) {
        return matches[0];
    } else {
        return '';
    }
}

function checkValidLink(link) {
    if (link.indexOf("http") === -1 || 
        (link.indexOf("music.163.com") === -1 && link.indexOf("163cn.tv") === -1)) {
        return false;
    }
    return true;
}

function extractAndCheckId(text) {
    var link = extractLinks(text);
    if (checkValidLink(link)) {
        return link;
    } else {
        var idRegex = /\b\d+\b/g;
        var ids = text.match(idRegex);
        if (ids && ids.length > 0) {
            return ids[0];
        }
        return '';
    }
}

// 定义图片压缩函数
// 目标最大边长 (例如 640px)
const MAX_IMAGE_SIDE_LENGTH = 640; // 目标最大边长，与Python脚本的max_size保持一致
// 目标最大文件大小 (例如 500KB)
const MAX_IMAGE_FILE_SIZE_BYTES = 500 * 1024; // 500 KB
// 初始JPEG质量，与Python脚本的quality=90保持一致
const INITIAL_JPEG_QUALITY = 0.9;

// 辅助函数：检查图片是否包含透明度 (保持不变)
function hasTransparency(ctx, width, height) {
    const imageData = ctx.getImageData(0, 0, width, height).data;
    for (let i = 3; i < imageData.length; i += 4) { // 检查每个像素的alpha通道
        if (imageData[i] < 255) return true;
    }
    return false;
}

async function compressImage(imageBuffer, mimeType) {
    if (!imageBuffer || !mimeType || !mimeType.startsWith('image/')) {
        console.warn("无法压缩非图片或无效图片数据。");
        return { buffer: imageBuffer, mime: mimeType };
    }

    console.log("尝试压缩封面图片...");

    return new Promise((resolve) => {
        const blob = new Blob([imageBuffer], { type: mimeType });
        const img = new Image();
        const url = URL.createObjectURL(blob);

        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            let width = img.width;
            let height = img.height;

            // 1. 调整图片尺寸 (如果过大)，保持宽高比
            // 此逻辑等同于Python的 img.thumbnail(max_size, ...)
            if (width > MAX_IMAGE_SIDE_LENGTH || height > MAX_IMAGE_SIDE_LENGTH) {
                const aspectRatio = width / height;
                if (width > height) { // 横向或方形
                    width = MAX_IMAGE_SIDE_LENGTH;
                    height = width / aspectRatio;
                } else { // 纵向
                    height = MAX_IMAGE_SIDE_LENGTH;
                    width = height * aspectRatio;
                }
                // 确保尺寸为整数，以便在canvas上绘制
                width = Math.round(width);
                height = Math.round(height);
            }

            canvas.width = width;
            canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);

            // 2. 确定输出格式和初始质量
            // Python的 img.convert('RGB') 暗示非透明格式，通常是JPEG。
            // 除非需要保留透明度，否则我们默认转换为JPEG。
            let outputMimeType;
            let currentQuality = INITIAL_JPEG_QUALITY;

            // 如果原始图片是PNG且包含透明度，则保留PNG格式。
            if (mimeType === 'image/png' && hasTransparency(ctx, width, height)) {
                outputMimeType = 'image/png';
                currentQuality = 1.0; // PNG质量通常是无损或接近无损的；1.0表示不进行明确的质量降低。
            } else if (mimeType === 'image/gif') {
                outputMimeType = 'image/gif'; // GIF不支持toBlob的质量参数。
                currentQuality = 1.0; // GIF不降低质量。
            } else {
                // 对于所有其他情况 (JPEG, 无透明度的PNG, WebP等),
                // 优先转换为JPEG，以匹配Python的'RGB'转换并利用质量控制。
                outputMimeType = 'image/jpeg';
            }

            // 递归函数，尝试压缩直到达到目标文件大小或质量过低
            const tryCompress = (q) => {
                canvas.toBlob((compressedBlob) => {
                    if (!compressedBlob) {
                        console.error("canvas.toBlob 无法创建 Blob。返回原始图片。");
                        URL.revokeObjectURL(url);
                        resolve({ buffer: imageBuffer, mime: mimeType });
                        return;
                    }

                    if (compressedBlob.size <= MAX_IMAGE_FILE_SIZE_BYTES || q <= 0.1) {
                        // 达到目标大小，或质量已非常低。
                        compressedBlob.arrayBuffer().then(buffer => {
                            console.log(`图片压缩完成。原始大小: ${(imageBuffer.byteLength / 1024).toFixed(2)}KB, 压缩后大小: ${(buffer.byteLength / 1024).toFixed(2)}KB (质量: ${q.toFixed(1)}, 类型: ${outputMimeType})`);
                            URL.revokeObjectURL(url); // 释放Blob URL
                            resolve({ buffer: buffer, mime: outputMimeType });
                        });
                    } else {
                        // 仍然太大，降低质量再试 (仅对JPEG/WebP有效)
                        let nextQuality = q - 0.1;
                        if (nextQuality < 0.1) nextQuality = 0.1; // 最小质量
                        console.log(`图片仍过大 (${(compressedBlob.size / 1024).toFixed(2)}KB)，尝试降低质量到 ${nextQuality.toFixed(1)}`);
                        tryCompress(nextQuality); // 递归调用
                    }
                }, outputMimeType, q); // 将outputMimeType和当前质量传递给toBlob
            };

            // 初始调用，开始压缩
            tryCompress(currentQuality);
        };

        img.onerror = (e) => {
            console.error("加载图片进行压缩时发生错误:", e);
            URL.revokeObjectURL(url);
            resolve({ buffer: imageBuffer, mime: mimeType }); // 发生错误时，返回原始图片数据
        };

        img.src = url;
    });
}

// 根据音质级别确定文件格式
// standard, exhigh -> mp3
// lossless, hires, jyeffect, sky, jymaster -> flac
function getAudioFormatByLevel(level) {
    const mp3Levels = ['standard', 'exhigh'];
    if (mp3Levels.includes(level)) {
        return 'mp3';
    }
    return 'flac';
}

// 获取当前选择的音质级别
function getCurrentLevel() {
    const levelSelect = document.getElementById('level');
    return levelSelect ? levelSelect.value : 'standard';
}

// 定义下载函数
async function ml_music_download(al_name, ar_name, processedLyrics, name, pic, url, level = null) {
    try {
        // 获取音质级别
        const audioLevel = level || getCurrentLevel();
        const audioFormat = getAudioFormatByLevel(audioLevel);
        console.log(`当前音质级别: ${audioLevel}, 格式: ${audioFormat}`);

        // 1. 获取音乐文件
        console.log("正在下载音乐文件...");
        const audioResponse = await fetch(url);
        if (!audioResponse.ok) {
            throw new Error(`无法下载音乐文件: ${audioResponse.statusText}`);
        }
        // 直接获取 ArrayBuffer
        const audioBuffer = await audioResponse.arrayBuffer();
        console.log("音乐文件下载完成。");

        // 2. 获取封面图片
        let coverBuffer = null;
        let coverMimeType = null;
        if (pic) {
            console.log("正在下载封面图片...");
            try {
                const coverResponse = await fetch(pic);
                if (!coverResponse.ok) {
                    console.warn(`无法下载封面图片: ${coverResponse.statusText}，将不添加封面。`);
                } else {
                    const originalCoverBuffer = await coverResponse.arrayBuffer();
                    const originalCoverMimeType = coverResponse.headers.get('Content-Type');

                    // 调用图片压缩函数
                    const compressedImageData = await compressImage(originalCoverBuffer, originalCoverMimeType);
                    coverBuffer = compressedImageData.buffer;
                    coverMimeType = compressedImageData.mime;

                    console.log("封面图片处理完成。");
                }
            } catch (error) {
                console.error("下载或处理封面图片时发生错误:", error);
                console.warn("将不添加封面。");
            }
        }

        let taggedBlob;
        let fileName;

        if (audioFormat === 'mp3') {
            // MP3 格式：使用 ID3Writer 添加 ID3 标签
            console.log("正在添加 ID3 标签...");
            const writer = new ID3Writer(audioBuffer);

            // 设置标签
            writer
                .setFrame('TIT2', name)      // 标题
                .setFrame('TPE1', [ar_name]) // 艺术家（数组）
                .setFrame('TALB', al_name);  // 专辑

            // 歌词
            if (processedLyrics) {
                writer.setFrame('USLT', {
                    language: 'und',
                    description: '',
                    lyrics: processedLyrics
                });
            }

            // 封面
            if (coverBuffer && coverMimeType) {
                writer.setFrame('APIC', {
                    type: 3,
                    data: coverBuffer,
                    description: 'Cover',
                    useUnicodeEncoding: false
                });
            }

            // 写入标签
            writer.addTag();
            taggedBlob = writer.getBlob();
            fileName = `${name}.mp3`;
            console.log("ID3 标签添加完成。");

        } else {
            // FLAC 格式：使用 FlacWriter 添加 Vorbis 注释
            console.log("正在添加 FLAC Vorbis 标签...");

            // 检查是否为有效的 FLAC 文件
            const headerBytes = new Uint8Array(audioBuffer.slice(0, 4));
            const magic = String.fromCharCode(headerBytes[0], headerBytes[1], headerBytes[2], headerBytes[3]);

            if (magic !== 'fLaC') {
                console.warn("警告：期望 FLAC 格式但文件头不匹配，将尝试作为 MP3 处理...");
                // 如果不是 FLAC，回退到 MP3 处理
                const writer = new ID3Writer(audioBuffer);
                writer
                    .setFrame('TIT2', name)
                    .setFrame('TPE1', [ar_name])
                    .setFrame('TALB', al_name);

                if (processedLyrics) {
                    writer.setFrame('USLT', {
                        language: 'und',
                        description: '',
                        lyrics: processedLyrics
                    });
                }

                if (coverBuffer && coverMimeType) {
                    writer.setFrame('APIC', {
                        type: 3,
                        data: coverBuffer,
                        description: 'Cover',
                        useUnicodeEncoding: false
                    });
                }

                writer.addTag();
                taggedBlob = writer.getBlob();
                fileName = `${name}.mp3`;
                console.log("已回退到 MP3 格式处理。");
            } else {
                // 确实是 FLAC 文件
                const writer = new FlacWriter(audioBuffer);

                // 设置 Vorbis 注释标签
                writer
                    .setFrame('TITLE', name)
                    .setFrame('ARTIST', ar_name)
                    .setFrame('ALBUM', al_name);

                // 歌词
                if (processedLyrics) {
                    writer.setFrame('LYRICS', processedLyrics);
                }

                // 封面
                if (coverBuffer && coverMimeType) {
                    writer.setPicture(coverBuffer, coverMimeType, 'Cover');
                }

                // 写入标签
                writer.addTag();
                taggedBlob = writer.getBlob();
                fileName = `${name}.flac`;
                console.log("FLAC Vorbis 标签添加完成。");
            }
        }

        // 4. 触发下载
        const blobUrl = URL.createObjectURL(taggedBlob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
        console.log(`文件 "${fileName}" 已开始下载。`);

    } catch (error) {
        console.error("下载或处理音乐文件时发生错误:", error);
        ml_show_Alert('下载错误', '下载音乐时发生错误，请查看控制台获取详情。', 'error');
    }
};

// multi-songs download
var ml_song_list = [];
var ml_first_song_detailed_info = {};
const ml_max_try_times = 5;

// 下载状态管理
var ml_download_state = {
    isDownloading: false,      // 是否正在下载
    isPaused: false,           // 是否暂停
    currentIndex: 0,           // 当前下载索引
    totalCount: 0,             // 总歌曲数
    successCount: 0,           // 成功数
    failedCount: 0,            // 失败数
    failedSongs: [],           // 失败的歌曲列表
    abortController: null,     // 用于取消请求
    containerSelector: null    // 当前活动的容器选择器
};

// 并行下载配置
const ML_PARALLEL_DOWNLOAD_COUNT = 3; // 同时下载的歌曲数量

// 更新进度条UI
function ml_update_progress_ui() {
    const state = ml_download_state;
    const progress = state.totalCount > 0 ? Math.round((state.currentIndex / state.totalCount) * 100) : 0;

    // 获取当前活动容器中的控制区域
    const $controls = state.containerSelector ? $(state.containerSelector).find('.ml-download-controls') : $('.ml-download-controls');

    // 更新进度条
    $controls.find('.ml-progress-bar').css('width', progress + '%').attr('aria-valuenow', progress);
    $controls.find('.ml-progress-text').text(`${state.currentIndex}/${state.totalCount} (成功: ${state.successCount}, 失败: ${state.failedCount})`);

    // 更新进度百分比
    $controls.find('.ml-progress-percent').text(progress + '%');
}

// 设置按钮状态
function ml_set_button_state(buttonSelector, isLoading, loadingText = '处理中...') {
    const $btn = $(buttonSelector);
    if (isLoading) {
        // 保存原始文本
        if (!$btn.data('original-text')) {
            $btn.data('original-text', $btn.text());
        }
        $btn.prop('disabled', true)
            .addClass('disabled')
            .html(`<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>${loadingText}`);
    } else {
        const originalText = $btn.data('original-text') || 'Download All';
        $btn.prop('disabled', false)
            .removeClass('disabled')
            .text(originalText);
    }
}

// 显示/隐藏暂停按钮和进度条（使用预定义的HTML元素）
function ml_show_download_controls(containerSelector, show) {
    const $container = $(containerSelector);
    const $controls = $container.find('.ml-download-controls');

    if (show) {
        // 存储当前容器选择器到全局状态
        ml_download_state.containerSelector = containerSelector;

        // 显示控制区域
        $controls.removeClass('d-none');

        // 重置进度条状态
        $controls.find('.ml-progress-bar').css('width', '0%').attr('aria-valuenow', 0);
        $controls.find('.ml-progress-text').text('准备中...');
        $controls.find('.ml-progress-percent').text('0%');
        $controls.find('.ml-pause-btn').text('暂停下载').removeClass('btn-success').addClass('btn-warning');

        // 绑定暂停按钮事件
        $controls.find('.ml-pause-btn').off('click').on('click', function(e) {
            e.preventDefault();
            e.stopPropagation();

            if (ml_download_state.isPaused) {
                ml_download_state.isPaused = false;
                $(this).text('暂停下载').removeClass('btn-success').addClass('btn-warning');
                console.log('下载已继续');
                // 触发继续下载事件
                $(document).trigger('ml-download-resume');
            } else {
                ml_download_state.isPaused = true;
                $(this).text('继续下载').removeClass('btn-warning').addClass('btn-success');
                console.log('下载已暂停');
            }
        });

        // 绑定取消按钮事件
        $controls.find('.ml-cancel-btn').off('click').on('click', async function(e) {
            e.preventDefault();
            e.stopPropagation();

            const confirmed = await ml_show_Confirm('取消下载', '确定要取消下载吗？');
            if (confirmed) {
                const currentContainer = ml_download_state.containerSelector;
                ml_download_state.isPaused = false;
                ml_download_state.isDownloading = false;
                // 触发继续事件以解除等待
                $(document).trigger('ml-download-resume');
                ml_show_download_controls(currentContainer, false);
                ml_set_button_state(`${currentContainer} [id^="download_all"]`, false);
                console.log('下载已取消');
            }
        });
    } else {
        // 隐藏控制区域
        $controls.addClass('d-none');
        ml_download_state.containerSelector = null;
    }
}

// 等待暂停解除
function ml_wait_for_resume() {
    return new Promise((resolve) => {
        // 如果没有暂停或已取消下载，立即返回
        if (!ml_download_state.isPaused || !ml_download_state.isDownloading) {
            resolve();
            return;
        }

        // 使用事件监听和定时器双重机制确保可靠性
        let resolved = false;

        const cleanup = () => {
            if (!resolved) {
                resolved = true;
                $(document).off('ml-download-resume', resumeHandler);
                clearInterval(checkInterval);
                resolve();
            }
        };

        const resumeHandler = () => {
            console.log('收到继续下载事件');
            cleanup();
        };

        // 监听继续事件
        $(document).on('ml-download-resume', resumeHandler);

        // 定时检查状态（作为备份机制）
        const checkInterval = setInterval(() => {
            if (!ml_download_state.isPaused || !ml_download_state.isDownloading) {
                console.log('检测到状态变化，继续下载');
                cleanup();
            }
        }, 200);
    });
}

// 获取当前活动的结果容器选择器
function ml_get_active_result_container() {
    if (!$('#search-result').hasClass('d-none')) return '#search-result';
    if (!$('#playlist-result').hasClass('d-none')) return '#playlist-result';
    if (!$('#album-result').hasClass('d-none')) return '#album-result';
    return null;
}

// 并行下载单首歌曲
async function ml_download_single_song(song, ml_selected_level) {
    const response = await $.post(ml_song_info_post_url_base + '/Song_V1', {
        url: song.id,
        level: ml_selected_level,
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
            ml_selected_level
        );
        return { success: true, song: song };
    } else {
        throw new Error(response.msg || '下载失败');
    }
}

async function ml_donwload_song_list(ml_selected_level){
    // 防止重复点击
    if (ml_download_state.isDownloading) {
        console.warn('下载正在进行中，请等待完成或取消当前下载。');
        return;
    }

    const containerSelector = ml_get_active_result_container();
    if (!containerSelector) {
        console.error('未找到活动的结果容器');
        return;
    }

    // 初始化下载状态
    ml_download_state.isDownloading = true;
    ml_download_state.isPaused = false;
    ml_download_state.currentIndex = 0;
    ml_download_state.totalCount = ml_song_list.length;
    ml_download_state.successCount = 0;
    ml_download_state.failedCount = 0;
    ml_download_state.failedSongs = [];
    ml_download_state.containerSelector = containerSelector;

    // 设置按钮加载状态
    ml_set_button_state(`${containerSelector} [id^="download_all"]`, true, '下载中...');

    // 显示进度条和控制按钮
    ml_show_download_controls(containerSelector, true);
    ml_update_progress_ui();

    console.log(`开始批量下载，共 ${ml_song_list.length} 首歌曲，并行数: ${ML_PARALLEL_DOWNLOAD_COUNT}`);

    let songQueue = [...ml_song_list];
    let attempt = 0;

    try {
        while (songQueue.length > 0 && attempt < ml_max_try_times && ml_download_state.isDownloading) {
            if (attempt > 0) {
                console.log(`重试第 ${attempt} 次，剩余失败歌曲: ${songQueue.length}`);
            }

            const currentRoundFailed = [];

            // 分批并行下载
            for (let i = 0; i < songQueue.length && ml_download_state.isDownloading; i += ML_PARALLEL_DOWNLOAD_COUNT) {
                // 检查是否暂停
                while (ml_download_state.isPaused && ml_download_state.isDownloading) {
                    console.log('下载已暂停，等待继续...');
                    await ml_wait_for_resume();
                }

                // 如果取消了就退出
                if (!ml_download_state.isDownloading) {
                    console.log('下载已取消，退出循环');
                    break;
                }

                // 获取当前批次的歌曲
                const batch = songQueue.slice(i, i + ML_PARALLEL_DOWNLOAD_COUNT);
                console.log(`正在下载批次 ${Math.floor(i / ML_PARALLEL_DOWNLOAD_COUNT) + 1}，包含 ${batch.length} 首歌曲`);

                // 并行下载当前批次
                const downloadPromises = batch.map(async (song) => {
                    // 在每个下载任务中也检查取消状态
                    if (!ml_download_state.isDownloading) {
                        return { success: false, song: song, cancelled: true };
                    }
                    try {
                        await ml_download_single_song(song, ml_selected_level);
                        console.log(`✅ 成功下载: ${song.name}`);
                        return { success: true, song: song };
                    } catch (error) {
                        console.error(`❌ 下载失败: ${song.name}`, error);
                        return { success: false, song: song, error: error };
                    }
                });

                // 等待当前批次完成
                const results = await Promise.all(downloadPromises);

                // 如果已取消，不再处理结果
                if (!ml_download_state.isDownloading) {
                    console.log('下载已取消，跳过结果处理');
                    break;
                }

                // 处理结果
                results.forEach(result => {
                    if (result.cancelled) return; // 跳过已取消的
                    ml_download_state.currentIndex++;
                    if (result.success) {
                        ml_download_state.successCount++;
                    } else {
                        ml_download_state.failedCount++;
                        currentRoundFailed.push(result.song);
                    }
                    ml_update_progress_ui();
                });
            }

            // 如果已取消，退出重试循环
            if (!ml_download_state.isDownloading) break;

            // 更新失败列表用于下一轮重试
            songQueue = currentRoundFailed;
            if (songQueue.length > 0) {
                // 重置索引用于重试显示
                ml_download_state.currentIndex = ml_download_state.totalCount - songQueue.length;
                ml_download_state.failedCount = 0;
            }
            attempt++;
        }
    } finally {
        // 记录最终失败的歌曲
        ml_download_state.failedSongs = songQueue;

        const wasDownloading = ml_download_state.isDownloading;
        const successCount = ml_download_state.successCount;
        const failedSongs = [...ml_download_state.failedSongs];

        // 下载完成，恢复按钮状态
        ml_download_state.isDownloading = false;
        ml_set_button_state(`${containerSelector} [id^="download_all"]`, false);

        // 延迟隐藏进度条，让用户看到最终结果
        setTimeout(() => {
            ml_show_download_controls(containerSelector, false);
        }, wasDownloading ? 3000 : 500);

        // 只有正常完成时才显示结果（取消时不显示）
        if (wasDownloading) {
            if (failedSongs.length > 0) {
                const failedNames = failedSongs.map(s => s.name).join('\n');
                console.log(`以下歌曲下载失败，请稍后重试:\n${failedNames}`);
                ml_show_Alert('下载完成', `成功: ${successCount} 首\n失败: ${failedSongs.length} 首\n\n失败的歌曲:\n${failedNames}`, 'warning');
            } else if (successCount > 0) {
                ml_show_Alert('下载完成', `所有 ${successCount} 首歌曲已成功下载！`, 'success');
            }
        } else {
            console.log(`下载已取消。已完成: ${successCount} 首`);
        }
    }
};
