export {};

declare global {
    interface FileSystemFileHandle extends FileSystemHandle {
        readonly move: (directory: FileSystemDirectoryHandle, newName: string) => Promise<void>;
    }
}
