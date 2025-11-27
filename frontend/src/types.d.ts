declare module 'browser-id3-writer' {
    export class ID3Writer {
        constructor(buffer: ArrayBuffer);
        setFrame(frameId: string, frameValue: any): this;
        addTag(): void;
        getBlob(): Blob;
        getURL(): string;
        revokeURL(): void;
    }
}
