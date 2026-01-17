// ml-flac-writer.js
// Browser-compatible FLAC Vorbis Comment writer
// Supports adding metadata (title, artist, album, lyrics) and cover art to FLAC files

class FlacWriter {
    constructor(arrayBuffer) {
        this.buffer = new Uint8Array(arrayBuffer);
        this.metadata = {};
        this.picture = null;
    }

    // Set text frame (Vorbis comment style)
    setFrame(key, value) {
        if (value !== null && value !== undefined) {
            if (Array.isArray(value)) {
                this.metadata[key.toUpperCase()] = value.join('; ');
            } else {
                this.metadata[key.toUpperCase()] = String(value);
            }
        }
        return this;
    }

    // Set picture (cover art)
    setPicture(pictureData, mimeType, description = 'Cover') {
        this.picture = {
            type: 3, // Front cover
            mimeType: mimeType || 'image/jpeg',
            description: description,
            data: new Uint8Array(pictureData)
        };
        return this;
    }

    // Validate FLAC file
    _validateFlac() {
        // Check fLaC magic number
        if (this.buffer.length < 4) return false;
        const magic = String.fromCharCode(this.buffer[0], this.buffer[1], this.buffer[2], this.buffer[3]);
        return magic === 'fLaC';
    }

    // Read 32-bit big-endian integer
    _readUint32BE(arr, offset) {
        return (arr[offset] << 24) | (arr[offset + 1] << 16) | (arr[offset + 2] << 8) | arr[offset + 3];
    }

    // Write 32-bit big-endian integer
    _writeUint32BE(value) {
        return new Uint8Array([
            (value >> 24) & 0xFF,
            (value >> 16) & 0xFF,
            (value >> 8) & 0xFF,
            value & 0xFF
        ]);
    }

    // Write 32-bit little-endian integer
    _writeUint32LE(value) {
        return new Uint8Array([
            value & 0xFF,
            (value >> 8) & 0xFF,
            (value >> 16) & 0xFF,
            (value >> 24) & 0xFF
        ]);
    }

    // Create Vorbis Comment block
    _createVorbisCommentBlock() {
        const encoder = new TextEncoder();

        // Vendor string
        const vendorString = 'ML-Netease Toolkit';
        const vendorBytes = encoder.encode(vendorString);

        // Build comments
        const comments = [];
        for (const [key, value] of Object.entries(this.metadata)) {
            if (value) {
                const comment = `${key}=${value}`;
                comments.push(encoder.encode(comment));
            }
        }

        // Calculate total size
        let size = 4 + vendorBytes.length; // vendor length (LE) + vendor string
        size += 4; // comment count (LE)
        for (const comment of comments) {
            size += 4 + comment.length; // length (LE) + comment
        }

        // Build block content
        const content = new Uint8Array(size);
        let offset = 0;

        // Vendor length (LE)
        content.set(this._writeUint32LE(vendorBytes.length), offset);
        offset += 4;

        // Vendor string
        content.set(vendorBytes, offset);
        offset += vendorBytes.length;

        // Comment count (LE)
        content.set(this._writeUint32LE(comments.length), offset);
        offset += 4;

        // Comments
        for (const comment of comments) {
            content.set(this._writeUint32LE(comment.length), offset);
            offset += 4;
            content.set(comment, offset);
            offset += comment.length;
        }

        return content;
    }

    // Create PICTURE block
    _createPictureBlock() {
        if (!this.picture) return null;

        const encoder = new TextEncoder();
        const mimeBytes = encoder.encode(this.picture.mimeType);
        const descBytes = encoder.encode(this.picture.description);

        // Picture block format:
        // 4 bytes: picture type (3 = front cover)
        // 4 bytes: MIME type length
        // n bytes: MIME type
        // 4 bytes: description length
        // n bytes: description
        // 4 bytes: width (0 = unknown)
        // 4 bytes: height (0 = unknown)
        // 4 bytes: color depth (0 = unknown)
        // 4 bytes: indexed colors (0 = unknown)
        // 4 bytes: picture data length
        // n bytes: picture data

        const size = 4 + 4 + mimeBytes.length + 4 + descBytes.length + 16 + 4 + this.picture.data.length;
        const content = new Uint8Array(size);
        let offset = 0;

        // Picture type (BE)
        content.set(this._writeUint32BE(this.picture.type), offset);
        offset += 4;

        // MIME type length (BE)
        content.set(this._writeUint32BE(mimeBytes.length), offset);
        offset += 4;

        // MIME type
        content.set(mimeBytes, offset);
        offset += mimeBytes.length;

        // Description length (BE)
        content.set(this._writeUint32BE(descBytes.length), offset);
        offset += 4;

        // Description
        content.set(descBytes, offset);
        offset += descBytes.length;

        // Width, height, color depth, indexed colors (all 0 = unknown)
        content.set(this._writeUint32BE(0), offset); offset += 4; // width
        content.set(this._writeUint32BE(0), offset); offset += 4; // height
        content.set(this._writeUint32BE(0), offset); offset += 4; // color depth
        content.set(this._writeUint32BE(0), offset); offset += 4; // indexed colors

        // Picture data length (BE)
        content.set(this._writeUint32BE(this.picture.data.length), offset);
        offset += 4;

        // Picture data
        content.set(this.picture.data, offset);

        return content;
    }

    // Find position after STREAMINFO block
    _findInsertPosition() {
        if (!this._validateFlac()) {
            throw new Error('Invalid FLAC file');
        }

        let offset = 4; // Skip fLaC magic
        let lastBlockEnd = offset;
        let foundStreamInfo = false;

        while (offset < this.buffer.length) {
            const header = this.buffer[offset];
            const isLast = (header & 0x80) !== 0;
            const blockType = header & 0x7F;
            const blockSize = (this.buffer[offset + 1] << 16) | (this.buffer[offset + 2] << 8) | this.buffer[offset + 3];

            offset += 4; // Skip header

            if (blockType === 0) { // STREAMINFO
                foundStreamInfo = true;
            }

            offset += blockSize;
            lastBlockEnd = offset;

            if (isLast) break;
        }

        if (!foundStreamInfo) {
            throw new Error('STREAMINFO block not found');
        }

        return { insertPos: lastBlockEnd, audioStart: lastBlockEnd };
    }

    // Build new FLAC file with metadata
    addTag() {
        if (!this._validateFlac()) {
            throw new Error('Invalid FLAC file - missing fLaC signature');
        }

        // Parse existing blocks to find where to insert
        let offset = 4; // Skip fLaC magic
        let streamInfoEnd = 0;
        let existingBlocks = [];
        let audioDataStart = 0;

        while (offset < this.buffer.length) {
            const header = this.buffer[offset];
            const isLast = (header & 0x80) !== 0;
            const blockType = header & 0x7F;
            const blockSize = (this.buffer[offset + 1] << 16) | (this.buffer[offset + 2] << 8) | this.buffer[offset + 3];

            const blockStart = offset;
            offset += 4 + blockSize;

            // Keep STREAMINFO (type 0), skip VORBIS_COMMENT (type 4) and PICTURE (type 6)
            if (blockType === 0) {
                streamInfoEnd = offset;
                existingBlocks.push({
                    type: blockType,
                    isLast: false, // Will be updated later
                    data: this.buffer.slice(blockStart + 4, blockStart + 4 + blockSize)
                });
            } else if (blockType !== 4 && blockType !== 6) {
                // Keep other blocks (like SEEKTABLE, APPLICATION, PADDING)
                existingBlocks.push({
                    type: blockType,
                    isLast: false,
                    data: this.buffer.slice(blockStart + 4, blockStart + 4 + blockSize)
                });
            }

            if (isLast) {
                audioDataStart = offset;
                break;
            }
        }

        // Create new blocks
        const vorbisComment = this._createVorbisCommentBlock();
        const pictureBlock = this._createPictureBlock();

        // Add our new blocks to the list
        existingBlocks.push({
            type: 4, // VORBIS_COMMENT
            isLast: false,
            data: vorbisComment
        });

        if (pictureBlock) {
            existingBlocks.push({
                type: 6, // PICTURE
                isLast: false,
                data: pictureBlock
            });
        }

        // Mark last block
        existingBlocks[existingBlocks.length - 1].isLast = true;

        // Calculate total size
        let totalSize = 4; // fLaC magic
        for (const block of existingBlocks) {
            totalSize += 4 + block.data.length; // header + data
        }
        totalSize += this.buffer.length - audioDataStart; // Audio frames

        // Build new file
        const newBuffer = new Uint8Array(totalSize);
        let writeOffset = 0;

        // Write fLaC magic
        newBuffer.set(this.buffer.slice(0, 4), writeOffset);
        writeOffset += 4;

        // Write metadata blocks
        for (const block of existingBlocks) {
            // Block header
            let headerByte = block.type;
            if (block.isLast) headerByte |= 0x80;

            newBuffer[writeOffset] = headerByte;
            newBuffer[writeOffset + 1] = (block.data.length >> 16) & 0xFF;
            newBuffer[writeOffset + 2] = (block.data.length >> 8) & 0xFF;
            newBuffer[writeOffset + 3] = block.data.length & 0xFF;
            writeOffset += 4;

            // Block data
            newBuffer.set(block.data, writeOffset);
            writeOffset += block.data.length;
        }

        // Write audio frames
        newBuffer.set(this.buffer.slice(audioDataStart), writeOffset);

        this.taggedBuffer = newBuffer;
        return this;
    }

    // Get Blob with tagged audio
    getBlob() {
        if (!this.taggedBuffer) {
            throw new Error('Call addTag() first');
        }
        return new Blob([this.taggedBuffer], { type: 'audio/flac' });
    }

    // Get ArrayBuffer with tagged audio
    getArrayBuffer() {
        if (!this.taggedBuffer) {
            throw new Error('Call addTag() first');
        }
        return this.taggedBuffer.buffer;
    }
}

// Export for use in browser
window.FlacWriter = FlacWriter;
