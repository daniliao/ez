import path from 'path'
import fs from 'fs'

export class StorageService {
    private rootPath: string;
    private uploadPath: string;

    constructor(databaseIdHash: string) {
        this.rootPath = process.env.DATA_PATH ? path.resolve(process.env.DATA_PATH) : path.resolve(process.cwd());
        this.uploadPath =path.join(this.rootPath, 'data', databaseIdHash)
    }

    getTempDir(): string {
        return path.join(this.uploadPath, 'temp');
    }

    clearTempDir(): void {
        const tempDir = this.getTempDir();
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true });
        }
    }

    public async saveAttachment(file: File, storageKey: string): Promise<void> {
        const arrayBuffer = await file.arrayBuffer();
        const buffer = new Uint8Array(arrayBuffer);
        fs.writeFileSync(path.resolve(this.uploadPath, storageKey), buffer);
    }

    public readAttachment(storageKey: string): ArrayBuffer {
        const filePath = path.resolve(this.uploadPath, storageKey);
        const buffer = fs.readFileSync(filePath);
        return new Uint8Array(buffer).buffer;
    }


    public deleteAttachment(storageKey: string) {
        return fs.rmSync(path.resolve(this.uploadPath, storageKey));
    }
}
