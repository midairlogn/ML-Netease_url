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

// ---------------------------------------------------------
// 文件名自定义功能
// ---------------------------------------------------------

/**
 * 根据模板生成文件名
 * @param {string} template - 文件名模板 (e.g., "${artist} - ${title}")
 * @param {object} metadata - 歌曲元数据 { title, artist, album }
 * @returns {string} - 处理后的文件名
 */
function ml_customize_filename(template, metadata) {
    if (!template || !template.trim()) {
        template = "${title}_${artist}_${album}"; // 默认模板
    }

    let filename = template;

    // 替换变量
    filename = filename.replace(/\$\{title\}/g, metadata.title || '');
    filename = filename.replace(/\$\{artist\}/g, metadata.artist || '');
    filename = filename.replace(/\$\{album\}/g, metadata.album || '');

    // 非法字符清洗
    // Windows文件名非法字符: \ / : * ? " < > |
    filename = filename.replace(/[\\/:*?"<>|]/g, '_');

    // 移除首尾空格
    filename = filename.trim();

    // 如果文件名为空，回退到默认
    if (!filename) {
        filename = `${metadata.title}_${metadata.artist}_${metadata.album}`.replace(/[\\/:*?"<>|]/g, '_');
    }

    return filename;
}

/**
 * 更新文件名预览
 */
function ml_update_filename_preview() {
    const template = $('#filename-template').val();
    const mockMetadata = {
        title: '歌名',
        artist: '歌手',
        album: '专辑'
    };

    // 尝试获取当前选择的音质对应的后缀
    const level = getCurrentLevel();
    const ext = getAudioFormatByLevel(level);

    const filename = ml_customize_filename(template, mockMetadata);
    $('#filename-preview').text(`${filename}.${ext}`);
    $('#filename-header-preview').text(`${filename}.${ext}`);
}

// 绑定事件监听器 (在页面加载完成后调用，或者在这里直接绑定如果 DOM 已就绪)
// 由于此文件在 body 底部引入，可以直接绑定
$(document).ready(function() {
    // 监听输入框变化
    $('#filename-template').on('input', ml_update_filename_preview);

    // 监听音质变化，更新后缀
    $('#level').on('change', ml_update_filename_preview);

    // 监听变量插入按钮
    $('.filename-variable').on('click', function() {
        const val = $(this).data('value');
        const $input = $('#filename-template');
        const currentVal = $input.val();

        // 在光标位置插入
        const input = $input[0];
        if (input.selectionStart || input.selectionStart == '0') {
            const startPos = input.selectionStart;
            const endPos = input.selectionEnd;
            $input.val(currentVal.substring(0, startPos) + val + currentVal.substring(endPos, currentVal.length));
            input.selectionStart = startPos + val.length;
            input.selectionEnd = startPos + val.length;
        } else {
            $input.val(currentVal + val);
        }

        $input.focus();
        $input.trigger('input'); // 触发input事件以保存设置
        ml_update_filename_preview();
    });

    // 监听预设按钮
    $('.filename-preset').on('click', function() {
        const val = $(this).data('value');
        $('#filename-template').val(val).trigger('input'); // 触发input事件以保存设置
        ml_update_filename_preview();
    });

    // 监听清空按钮
    $('#clear-filename-template').on('click', function() {
        $('#filename-template').val('').focus().trigger('input'); // 触发input事件以保存设置
        ml_update_filename_preview();
    });

    // 监听折叠事件以旋转图标和控制 Header 预览显示
    $('#filename-custom-body').on('show.bs.collapse', function () {
        $('#filename-collapse-icon').css('transform', 'rotate(180deg)');
        $('#filename-header-preview').fadeOut(200);
    });
    $('#filename-custom-body').on('hide.bs.collapse', function () {
        $('#filename-collapse-icon').css('transform', 'rotate(0deg)');
        $('#filename-header-preview').fadeIn(200);
    });

    // ---------------------------------------------------------
    // 分隔符切换逻辑
    // ---------------------------------------------------------
    function updatePresetsWithSeparator() {
        const separator = $('input[name="separator-type"]:checked').val() || '_';

        // 键名映射
        const keyMap = {
            'title': '歌名',
            'artist': '歌手',
            'album': '专辑'
        };

        $('.filename-preset').each(function() {
            const $btn = $(this);
            const keysAttr = $btn.data('keys');

            if (!keysAttr) return; // 跳过没有 keys 的 (如"仅歌名"如果没加)

            const keys = keysAttr.split(',');

            // 构建新的 data-value (例如 ${title}-${artist})
            const newValue = keys.map(k => '${' + k + '}').join(separator);
            $btn.data('value', newValue);

            // 构建新的按钮文本 (例如 歌名-歌手)
            // 如果只有一个key，不需要分隔符，也不需要改变文本（通常）
            if (keys.length > 1) {
                 const newText = keys.map(k => keyMap[k] || k).join(separator);
                 $btn.text(newText);
            }
        });
    }

    // 监听分隔符切换
    $('input[name="separator-type"]').on('change', updatePresetsWithSeparator);

    // 初始化一次 (虽然HTML默认是 _，但为了逻辑统一)
    updatePresetsWithSeparator();

    // 初始化预览
    ml_update_filename_preview();
});

// ---------------------------------------------------------

// 定义下载函数
async function ml_music_download(al_name, ar_name, processedLyrics, name, pic, url, level = null) {
    try {
        // 获取音质级别
        const audioLevel = level || getCurrentLevel();
        const audioFormat = getAudioFormatByLevel(audioLevel);
        console.log(`当前音质级别: ${audioLevel}, 格式: ${audioFormat}`);

        // 获取文件名模板并生成基础文件名 (不含后缀)
        const filenameTemplate = $('#filename-template').val();
        const metadata = {
            title: name,
            artist: ar_name,
            album: al_name
        };
        const customFilenameBase = ml_customize_filename(filenameTemplate, metadata);
        console.log(`生成的文件名: ${customFilenameBase}.${audioFormat}`);

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
            fileName = `${customFilenameBase}.mp3`;
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
                fileName = `${customFilenameBase}.mp3`;
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
                fileName = `${customFilenameBase}.flac`;
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
    currentIndex: 0,           // 当前下载进度（浮点数，用于计算百分比）
    completedCount: 0,         // 已完成的歌曲数（整数，用于显示）
    totalCount: 0,             // 总歌曲数
    successCount: 0,           // 成功数
    failedCount: 0,            // 失败数
    failedSongs: [],           // 失败的歌曲列表
    abortController: null,     // 用于取消请求
    containerSelector: null,   // 当前活动的容器选择器
    startTime: null,           // 下载开始时间
    // EMA 速度估算
    emaSpeed: null,            // EMA 速度（歌曲/毫秒）
    speedHistory: [],          // 速度计算历史记录 [{time, count}]
    pauseStartTime: null,      // 暂停开始时间
};

// EMA 平滑系数
const ML_EMA_ALPHA = 0.2;
// EMA 权重 (在最终估算中 EMA 占比)
const ML_EMA_WEIGHT = 0.8;
// 速度计算的时间窗口 (毫秒) - 窗口越大越平滑，越小越灵敏
const ML_SPEED_WINDOW = 5000;
// 需要完成的最少歌曲数才开始估算时间
const ML_MIN_COMPLETED_FOR_ETA = 1;

// 获取当前设置的并行下载数量
function ml_get_concurrent_count() {
    const count = parseInt($('#concurrent-downloads').val());
    if (isNaN(count) || count < 1) return 3;
    if (count > 10) return 10; // 严格限制最大值为10，与UI保持一致
    return count;
}

// 格式化剩余时间（使用清晰的中文格式）
function ml_format_remaining_time(seconds) {
    if (!isFinite(seconds) || seconds < 0) {
        return '计算中...';
    }

    seconds = Math.ceil(seconds);

    if (seconds === 0) {
        return '即将完成';
    }

    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    // 超过1天
    if (days > 0) {
        if (hours > 0) {
            return `${days}天${hours}小时`;
        }
        return `${days}天`;
    }

    // 超过1小时
    if (hours > 0) {
        if (mins > 0) {
            return `${hours}小时${mins}分`;
        }
        return `${hours}小时`;
    }

    // 超过1分钟
    if (mins > 0) {
        if (secs > 0) {
            return `${mins}分${secs}秒`;
        }
        return `${mins}分钟`;
    }

    // 小于1分钟
    return `${secs}秒`;
}

// 更新 EMA 速度（使用滑动窗口计算，避免短时间内突发完成导致剧烈波动）
function ml_update_speed() {
    const state = ml_download_state;
    const now = Date.now();
    const currentCount = state.completedCount;

    // 记录当前状态
    state.speedHistory.push({ time: now, count: currentCount });

    // 清理过旧的记录 (只保留最近 30秒，足够用于窗口计算)
    const keepTime = now - 30000;
    while (state.speedHistory.length > 0 && state.speedHistory[0].time < keepTime) {
        state.speedHistory.shift();
    }

    // 寻找合适的对比样本点 (大约在 ML_SPEED_WINDOW 之前)
    const targetTime = now - ML_SPEED_WINDOW;
    let prevRecord = null;

    // 1. 尝试从历史记录中找
    // 我们的目标是找到 time <= targetTime 的最近的一个点
    for (let i = state.speedHistory.length - 1; i >= 0; i--) {
        if (state.speedHistory[i].time <= targetTime) {
            prevRecord = state.speedHistory[i];
            break;
        }
    }

    // 2. 如果没找到（说明历史记录都很新），或者找到的点离现在太近（< 1s）
    // 尝试使用任务开始时间作为基准
    if (!prevRecord || (now - prevRecord.time < 1000)) {
        if (state.startTime && (now - state.startTime >= 1000)) {
             prevRecord = { time: state.startTime, count: 0 };
        }
    }

    // 如果仍然没有合适的对比点（可能是刚开始下载不到1秒），则跳过更新
    if (!prevRecord) return;

    const timeDiff = now - prevRecord.time;
    const countDiff = currentCount - prevRecord.count;

    if (timeDiff <= 0 || countDiff <= 0) return;

    // 计算当前窗口内的平均速度 (样本速度)
    const sampleSpeed = countDiff / timeDiff; // 歌曲/毫秒

    if (state.emaSpeed === null) {
        state.emaSpeed = sampleSpeed;
    } else {
        // 动态调整 Alpha:
        // 如果样本的时间跨度 (timeDiff) 接近或超过理想窗口 (ML_SPEED_WINDOW)，说明样本可靠，权重增加
        // 如果样本时间跨度很短（刚开始），权重降低，防止初期波动
        const reliability = Math.min(timeDiff / ML_SPEED_WINDOW, 1.0);
        const dynamicAlpha = ML_EMA_ALPHA * reliability;

        state.emaSpeed = dynamicAlpha * sampleSpeed + (1 - dynamicAlpha) * state.emaSpeed;
    }
}

// 计算预估剩余时间（毫秒）- 结合整体平均和 EMA
function ml_estimate_remaining_time() {
    const state = ml_download_state;

    // 需要至少完成一定数量的歌曲才开始估算
    if (state.completedCount < ML_MIN_COMPLETED_FOR_ETA || !state.startTime) {
        return null;
    }

    const now = Date.now();
    const elapsedMs = now - state.startTime;
    if (elapsedMs <= 0) {
        return null;
    }

    // 整体平均速度
    const overallSpeed = state.completedCount / elapsedMs;

    // 最终速度：如果有 EMA 速度，则加权混合；否则使用整体平均
    let finalSpeed;
    if (state.emaSpeed !== null && state.emaSpeed > 0) {
        // 加权：EMA 占 ML_EMA_WEIGHT，整体平均占剩余部分（保持稳定性）
        finalSpeed = ML_EMA_WEIGHT * state.emaSpeed + (1 - ML_EMA_WEIGHT) * overallSpeed;
    } else {
        finalSpeed = overallSpeed;
    }

    const remainingSongs = state.totalCount - state.completedCount;
    if (remainingSongs <= 0) {
        return 0;
    }

    return remainingSongs / finalSpeed; // 毫秒
}

// 更新进度条UI
function ml_update_progress_ui() {
    const state = ml_download_state;
    const progress = state.totalCount > 0 ? (state.currentIndex / state.totalCount) * 100 : 0;

    // 更新速度估算
    ml_update_speed();

    // 获取当前活动容器中的控制区域
    const $controls = state.containerSelector ? $(state.containerSelector).find('.ml-download-controls') : $('.ml-download-controls');

    // 更新进度条
    $controls.find('.ml-progress-bar').css('width', progress + '%').attr('aria-valuenow', progress);
    // 使用 completedCount 显示已完成的歌曲数（整数）
    $controls.find('.ml-progress-text').text(`${state.completedCount}/${state.totalCount} (成功: ${state.successCount}, 失败: ${state.failedCount})`);

    // 计算预估剩余时间（使用整体平均速度）
    let remainingTimeText = '计算中...';

    if (state.isPaused) {
        remainingTimeText = '已暂停';
    } else {
        const remainingMs = ml_estimate_remaining_time();
        if (remainingMs !== null) {
            remainingTimeText = ml_format_remaining_time(remainingMs / 1000);
        }
    }

    // 更新进度百分比（保留1位小数）和剩余时间
    $controls.find('.ml-progress-percent').text(progress.toFixed(1) + '%');
    $controls.find('.ml-progress-eta').text(remainingTimeText);

    // 计算并显示当前速度
    let speedText = '';
    // 使用 EMA 速度，如果没有则使用整体平均
    const currentSpeed = state.emaSpeed || (state.completedCount > 0 && state.startTime ? state.completedCount / (Date.now() - state.startTime) : 0);

    if (currentSpeed > 0) {
        // 转换为更易读的格式
        const songsPerSec = currentSpeed * 1000;
        if (songsPerSec >= 1) {
             speedText = songsPerSec.toFixed(1) + ' 首/秒';
        } else {
             // 如果速度很慢，显示多少秒一首
             speedText = (1 / songsPerSec).toFixed(1) + ' 秒/首';
        }
    }
    $controls.find('.ml-progress-speed').text(speedText ? ` (${speedText})` : '');
}

// 处理暂停时间补偿（支持多次暂停）
function ml_compensate_pause_time() {
    if (ml_download_state.pauseStartTime) {
        const pausedDuration = Date.now() - ml_download_state.pauseStartTime;

        if (pausedDuration > 0) {
            console.log(`暂停结束，补偿时间: ${pausedDuration}ms`);

            // 1. 推迟开始时间，保证整体平均速度计算正确
            // 每次暂停都会累加这个推迟，因此自然支持多次暂停
            if (ml_download_state.startTime) {
                ml_download_state.startTime += pausedDuration;
            }

            // 2. 推迟历史记录中的时间点，保证瞬时速度计算正确（保持相对时间一致）
            if (ml_download_state.speedHistory) {
                ml_download_state.speedHistory.forEach(record => {
                    record.time += pausedDuration;
                });
            }
        }

        // 3. 清除暂停开始时间，为下一次暂停做准备
        ml_download_state.pauseStartTime = null;
    }
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
        $controls.find('.ml-progress-percent').text('0.0%');
        $controls.find('.ml-progress-eta').text('计算中...');
        $controls.find('.ml-pause-btn').text('暂停下载').removeClass('btn-success').addClass('btn-warning');

        // 绑定暂停按钮事件
        $controls.find('.ml-pause-btn').off('click').on('click', function(e) {
            e.preventDefault();
            e.stopPropagation();

            if (ml_download_state.isPaused) {
                // 用户点击“继续下载”
                ml_download_state.isPaused = false;
                $(this).text('暂停下载').removeClass('btn-success').addClass('btn-warning');

                // 调用时间补偿函数（处理多次暂停的核心逻辑）
                ml_compensate_pause_time();

                console.log('下载已继续');
                // 触发继续下载事件
                $(document).trigger('ml-download-resume');

                // 立即更新一次 UI 以移除“已暂停”状态
                ml_update_progress_ui();
            } else {
                // 用户点击“暂停下载”
                ml_download_state.isPaused = true;
                // 记录暂停开始时间
                ml_download_state.pauseStartTime = Date.now();

                $(this).text('继续下载').removeClass('btn-warning').addClass('btn-success');
                console.log('下载已暂停');

                // 立即更新一次 UI 以显示“已暂停”
                ml_update_progress_ui();
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
    let infoFetched = false;

    try {
        const response = await $.post(ml_song_info_post_url_base + '/Song_V1', {
            url: song.id,
            level: ml_selected_level,
            type: 'json'
        });

        if (response.status === 200) {
            // 获取歌曲信息成功，更新进度（10%）
            infoFetched = true;
            ml_download_state.currentIndex += 0.1;
            ml_update_progress_ui();

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
            return { success: true, song: song, infoFetched: true };
        } else {
            return { success: false, song: song, infoFetched: false, error: new Error(response.msg || '下载失败') };
        }
    } catch (error) {
        return { success: false, song: song, infoFetched: infoFetched, error: error };
    }
}

async function ml_donwload_song_list(ml_selected_level, custom_song_list = null){
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

    // Determine which list to use
    const target_song_list = custom_song_list || ml_song_list;

    if (!target_song_list || target_song_list.length === 0) {
        ml_show_Alert('提示', '没有可下载的歌曲', 'warning');
        return;
    }

    // 初始化下载状态
    ml_download_state.isDownloading = true;
    ml_download_state.isPaused = false;
    ml_download_state.currentIndex = 0;
    ml_download_state.completedCount = 0;
    ml_download_state.totalCount = target_song_list.length;
    ml_download_state.successCount = 0;
    ml_download_state.failedCount = 0;
    ml_download_state.failedSongs = [];
    ml_download_state.containerSelector = containerSelector;
    ml_download_state.startTime = Date.now();
    ml_download_state.pauseStartTime = null;
    // 重置 EMA 状态
    ml_download_state.emaSpeed = null;
    ml_download_state.speedHistory = [];

    // 设置按钮加载状态
    ml_set_button_state(`${containerSelector} [id^="download_all"]`, true, '下载中...');

    // 显示进度条和控制按钮
    ml_show_download_controls(containerSelector, true);
    ml_update_progress_ui();

    const concurrentCount = ml_get_concurrent_count();
    console.log(`开始批量下载，共 ${target_song_list.length} 首歌曲，并行数: ${concurrentCount}`);

    let songQueue = [...target_song_list];
    let attempt = 0;

    try {
        while (songQueue.length > 0 && attempt < ml_max_try_times && ml_download_state.isDownloading) {
            if (attempt > 0) {
                console.log(`重试第 ${attempt} 次，剩余失败歌曲: ${songQueue.length}`);
            }

            const currentRoundFailed = [];

            // 分批并行下载
            for (let i = 0; i < songQueue.length && ml_download_state.isDownloading; i += concurrentCount) {
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
                const batch = songQueue.slice(i, i + concurrentCount);
                console.log(`正在下载批次 ${Math.floor(i / concurrentCount) + 1}，包含 ${batch.length} 首歌曲`);

                // 并行下载当前批次，每首完成时立即更新进度
                const downloadPromises = batch.map(async (song) => {
                    // 在每个下载任务中也检查取消状态
                    if (!ml_download_state.isDownloading) {
                        return { success: false, song: song, cancelled: true, infoFetched: false };
                    }
                    const result = await ml_download_single_song(song, ml_selected_level);

                    // 下载完成后立即更新进度（不等待其他并行任务）
                    if (!result.cancelled && ml_download_state.isDownloading) {
                        ml_download_state.completedCount++;
                        if (result.success) {
                            ml_download_state.currentIndex += 0.9;
                            ml_download_state.successCount++;
                            console.log(`✅ 成功下载: ${song.name}`);
                        } else {
                            if (result.infoFetched) {
                                ml_download_state.currentIndex += 0.9;
                            } else {
                                ml_download_state.currentIndex += 1;
                            }
                            ml_download_state.failedCount++;
                            console.error(`❌ 下载失败: ${song.name}`, result.error);
                        }
                        ml_update_progress_ui();
                    }

                    return result;
                });

                // 等待当前批次完成
                const results = await Promise.all(downloadPromises);

                // 如果已取消，不再处理结果
                if (!ml_download_state.isDownloading) {
                    console.log('下载已取消，跳过结果处理');
                    break;
                }

                // 收集失败的歌曲用于重试
                results.forEach(result => {
                    if (result.cancelled) return;
                    if (!result.success) {
                        currentRoundFailed.push(result.song);
                    }
                });
            }

            // 如果已取消，退出重试循环
            if (!ml_download_state.isDownloading) break;

            // 更新失败列表用于下一轮重试
            songQueue = currentRoundFailed;
            if (songQueue.length > 0) {
                // 重置索引用于重试显示
                ml_download_state.currentIndex = ml_download_state.totalCount - songQueue.length;
                ml_download_state.completedCount = ml_download_state.totalCount - songQueue.length;
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
