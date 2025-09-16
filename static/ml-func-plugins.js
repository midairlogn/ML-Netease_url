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

// 定义下载函数
async function ml_music_download(al_name, ar_name, processedLyrics, name, pic, url) {
    try {
        // 1. 获取MP3文件
        console.log("正在下载音乐文件...");
        const audioResponse = await fetch(url);
        if (!audioResponse.ok) {
            throw new Error(`无法下载音乐文件: ${audioResponse.statusText}`);
        }
        // 直接获取 ArrayBuffer
        const audioBuffer = await audioResponse.arrayBuffer(); // audioBuffer 现在是 ArrayBuffer
        console.log("音乐文件下载完成。");

        // 2. 获取封面图片
        // 这部分代码已经正确地处理了 ArrayBuffer，所以无需修改
        let coverBuffer = null; // 期望 ArrayBuffer
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

                    // *** 调用图片压缩函数 ***
                    // 假设 compressImage 返回 { buffer: ArrayBuffer, mime: string }
                    const compressedImageData = await compressImage(originalCoverBuffer, originalCoverMimeType);
                    coverBuffer = compressedImageData.buffer; // ArrayBuffer
                    coverMimeType = compressedImageData.mime;
                    // *************************

                    console.log("封面图片处理完成。");
                }
            } catch (error) {
                console.error("下载或处理封面图片时发生错误:", error);
                console.warn("将不添加封面。");
            }
        }

        // 3. 使用id3-writer添加ID3标签
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

        // 获取带标签的 Blob
        const taggedBlob = writer.getBlob();
        console.log("ID3 标签添加完成。");

        // 4. 触发下载
        const fileName = `${name}.mp3`;
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
        alert("下载音乐时发生错误，请查看控制台获取详情。");
    }
};

// multi-songs download
var ml_song_list = [];
var ml_first_song_detailed_info = {};
const ml_max_try_times = 5;

async function ml_donwload_song_list(ml_selected_level){
    let unsuccessfulSongs = [...ml_song_list]; // Copy the original list
    let attempt = 0;
    while (unsuccessfulSongs.length > 0 && attempt < ml_max_try_times) {
        console.log(`下载尝试 ${attempt + 1}，剩余歌曲数: ${unsuccessfulSongs.length}`);
        console.log(unsuccessfulSongs);
        const currentUnsuccessful = [];
        for (const song of unsuccessfulSongs) {
            try {
                const response = await $.post(ml_song_info_post_url_base + '/Song_V1', { url: song.id, level: ml_selected_level, type: 'json' });
                console.log(response);
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
                        response.url
                    );
                } else {
                    console.error(`Error downloading song ${song.name}: ${response.msg}`);
                    currentUnsuccessful.push(song); // Keep for next attempt
                }
            } catch (error) {
                console.error(`Error processing song ${song.name}:`, error);
                currentUnsuccessful.push(song); // Keep for next attempt
            }
        }
        unsuccessfulSongs = currentUnsuccessful; // Update the list for the next attempt
        attempt++;
    }
    if (unsuccessfulSongs.length > 0) {
        console.log(`以下歌曲下载失败，请稍后重试:\n${unsuccessfulSongs.map(s => s.name).join('\n')}`);
        alert(`以下歌曲下载失败，请稍后重试:\n${unsuccessfulSongs.map(s => s.name).join('\n')}`);
    } else {
        alert("所有歌曲已成功下载！");
    }
};
