import { ID3Writer } from 'browser-id3-writer';

import md5 from './md5';

export interface LyricLine {
    time: number;
    index: number;
    text: string;
}

function neteaseEncryptId(id_str: string): string {
    const magic = '3go8&$8*3*3h0k(2)2'.split('');
    const song_id = id_str.split('');

    for (let i = 0; i < song_id.length; i++) {
        song_id[i] = String.fromCharCode(song_id[i].charCodeAt(0) ^ magic[i % magic.length].charCodeAt(0));
    }

    const m = song_id.join('');
    // MD5 hash and base64 encode
    // The Python implementation uses hashlib.md5().digest() which returns bytes
    // and then base64 encodes those bytes.
    // Our md5 library can return a binary string or raw array, we need to handle this correctly.

    // Using the md5 library in 'raw' mode (returns string of bytes) is closest to Python's digest()
    // Then we use btoa to base64 encode it.
    const md5_raw = md5(m, undefined, true);
    let result = btoa(md5_raw);

    result = result.replace(/\//g, '_').replace(/\+/g, '-');
    return result;
}

export function getPicUrl(picId: string | number, size: number = 300): string {
    const picIdStr = String(picId);
    const encId = neteaseEncryptId(picIdStr);
    return `https://p3.music.126.net/${encId}/${picIdStr}.jpg?param=${size}y${size}`;
}

export function lrctrim(lyrics: string): LyricLine[] {
    const lines = lyrics.split('\n');
    const data: LyricLine[] = [];

    lines.forEach((line, index) => {
        const matches = line.match(/\[(\d{2}):(\d{2}[\.:]?\d*)]/);
        if (matches) {
            const minutes = parseInt(matches[1], 10);
            const seconds = parseFloat(matches[2].replace('.', ':')) || 0;
            const timestamp = minutes * 60000 + seconds * 1000;

            let text = line.replace(/\[\d{2}:\d{2}[\.:]?\d*\]/g, '').trim();
            text = text.replace(/\s\s+/g, ' '); // Replace multiple spaces with a single space

            data.push({ time: timestamp, index, text });
        }
    });

    data.sort((a, b) => a.time - b.time);

    return data;
}

export function lrctran(lyric: string, tlyric: string): string {
    const lyricData = lrctrim(lyric);
    const tlyricData = lrctrim(tlyric);

    let len1 = lyricData.length;
    let len2 = tlyricData.length;
    let result = "";

    for (let i = 0, j = 0; i < len1 && j < len2; i++) {
        while (j < len2 && lyricData[i].time > tlyricData[j].time && j + 1 < len2) {
            j++;
        }

        if (j < len2 && lyricData[i].time === tlyricData[j].time) {
            const trans = tlyricData[j].text.replace('/', '');
            if (trans) {
                lyricData[i].text += ` (翻译：${trans})`;
            }
            j++;
        }
    }

    for (let i = 0; i < len1; i++) {
        let t = lyricData[i].time;
        result += `[${String(Math.floor(t / 60000)).padStart(2, '0')}:${String(Math.floor((t % 60000) / 1000)).padStart(2, '0')}.${String(t % 1000).padStart(3, '0')}]${lyricData[i].text}\n`;
    }

    return result;
}

const MAX_IMAGE_SIDE_LENGTH = 640;
const MAX_IMAGE_FILE_SIZE_BYTES = 500 * 1024;
const INITIAL_JPEG_QUALITY = 0.9;

function hasTransparency(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
    const imageData = ctx.getImageData(0, 0, width, height).data;
    for (let i = 3; i < imageData.length; i += 4) {
        if (imageData[i] < 255) return true;
    }
    return false;
}

export async function compressImage(imageBuffer: ArrayBuffer, mimeType: string): Promise<{ buffer: ArrayBuffer, mime: string }> {
    if (!imageBuffer || !mimeType || !mimeType.startsWith('image/')) {
        console.warn("无法压缩非图片或无效图片数据。");
        return { buffer: imageBuffer, mime: mimeType };
    }

    return new Promise((resolve) => {
        const blob = new Blob([imageBuffer], { type: mimeType });
        const img = new Image();
        const url = URL.createObjectURL(blob);

        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                URL.revokeObjectURL(url);
                resolve({ buffer: imageBuffer, mime: mimeType });
                return;
            }

            let width = img.width;
            let height = img.height;

            if (width > MAX_IMAGE_SIDE_LENGTH || height > MAX_IMAGE_SIDE_LENGTH) {
                const aspectRatio = width / height;
                if (width > height) {
                    width = MAX_IMAGE_SIDE_LENGTH;
                    height = width / aspectRatio;
                } else {
                    height = MAX_IMAGE_SIDE_LENGTH;
                    width = height * aspectRatio;
                }
                width = Math.round(width);
                height = Math.round(height);
            }

            canvas.width = width;
            canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);

            let outputMimeType: string;
            let currentQuality = INITIAL_JPEG_QUALITY;

            if (mimeType === 'image/png' && hasTransparency(ctx, width, height)) {
                outputMimeType = 'image/png';
                currentQuality = 1.0;
            } else if (mimeType === 'image/gif') {
                outputMimeType = 'image/gif';
                currentQuality = 1.0;
            } else {
                outputMimeType = 'image/jpeg';
            }

            const tryCompress = (q: number) => {
                canvas.toBlob((compressedBlob) => {
                    if (!compressedBlob) {
                        URL.revokeObjectURL(url);
                        resolve({ buffer: imageBuffer, mime: mimeType });
                        return;
                    }

                    if (compressedBlob.size <= MAX_IMAGE_FILE_SIZE_BYTES || q <= 0.1) {
                        compressedBlob.arrayBuffer().then(buffer => {
                            URL.revokeObjectURL(url);
                            resolve({ buffer: buffer, mime: outputMimeType });
                        });
                    } else {
                        let nextQuality = q - 0.1;
                        if (nextQuality < 0.1) nextQuality = 0.1;
                        tryCompress(nextQuality);
                    }
                }, outputMimeType, q);
            };

            tryCompress(currentQuality);
        };

        img.onerror = (e) => {
            console.error("加载图片进行压缩时发生错误:", e);
            URL.revokeObjectURL(url);
            resolve({ buffer: imageBuffer, mime: mimeType });
        };

        img.src = url;
    });
}

export async function downloadMusic(
    al_name: string,
    ar_name: string,
    processedLyrics: string,
    name: string,
    pic: string,
    url: string
) {
    try {
        // Ensure URLs are HTTPS to avoid mixed content errors
        const secureUrl = url.replace(/^http:\/\//, 'https://');
        const securePic = pic.replace(/^http:\/\//, 'https://');

        const audioResponse = await fetch(secureUrl);
        if (!audioResponse.ok) throw new Error(`无法下载音乐文件: ${audioResponse.statusText}`);
        const audioBuffer = await audioResponse.arrayBuffer();

        let coverBuffer: ArrayBuffer | undefined = undefined;
        let coverMimeType: string | undefined = undefined;

        if (securePic) {
            try {
                const coverResponse = await fetch(securePic);
                if (coverResponse.ok) {
                    const originalCoverBuffer = await coverResponse.arrayBuffer();
                    const originalCoverMimeType = coverResponse.headers.get('Content-Type') || 'image/jpeg';
                    const compressed = await compressImage(originalCoverBuffer, originalCoverMimeType);
                    coverBuffer = compressed.buffer;
                    coverMimeType = compressed.mime;
                }
            } catch (error) {
                console.warn("封面下载失败 (可能是跨域限制)", error);
            }
        }

        const writer = new ID3Writer(audioBuffer);
        writer.setFrame('TIT2', name)
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
        const taggedBlob = writer.getBlob();
        const fileName = `${name}.mp3`;
        const blobUrl = URL.createObjectURL(taggedBlob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);

    } catch (error) {
        console.error("下载失败", error);
        alert("下载失败: " + error);
    }
}
