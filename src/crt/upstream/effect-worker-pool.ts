// Adapted from ntsc-rs-web 5d15ee0 (GPL-3.0-or-later). See docs/UPSTREAM-CHANGES.md.
import {Formats, WorkerSchema} from './effect-worker.worker';
import Queue from 'valadaptive-lib/util/queue';
import RpcDispatcher from './worker-rpc';
import {ResizeFilter, Rotation} from '../../../ntsc-rs-web-wrapper/build/ntsc_rs_web_wrapper';
import {wasmModulePromise} from './ntsc-rs-module';
import {TypedEvent, TypedEventTarget} from 'valadaptive-lib/util/typed-events';

export type EffectWorker = RpcDispatcher<WorkerSchema>;

const messageMap = {
    'render-frame-to-bitmap': 'rendered-frame-to-bitmap',
    'render-frame-to-videoframe': 'rendered-frame-to-videoframe',
    'render-frame-to-png': 'rendered-frame-to-png',
    'init': 'initialized',
    'update-settings': 'settings-updated',
} as const;
type Runner<T> = (cb: (worker: EffectWorker) => Promise<T>) => Promise<T>;

const taskRegistry = new FinalizationRegistry<null>(() => {
    // eslint-disable-next-line no-console
    console.error('A worker pool task was garbage-collected without being run or cancelled.');
});

export type RenderFrameSettings = {
    frame: VideoFrame,
    squarePixelWidth?: number,
    squarePixelHeight?: number,
    resizeHeight: number | null,
    resizeFilter: ResizeFilter,
    effectEnabled: boolean,
    rotation: Rotation,
    effectSettings: Record<string, number | boolean>,
    padToEven: boolean,
    frameNum: number,
    outputRect: {
        top: number,
        right: number,
        bottom: number,
        left: number,
    } | null,
};

export class PanicEvent extends TypedEvent<'panic'> {
    message: string;

    constructor(message: string) {
        super('panic');
        this.message = message;
    }
}

export default class EffectWorkerPool extends TypedEventTarget<PanicEvent> {
    private workers: EffectWorker[] = [];
    private queue: Queue<{resolve: (worker: EffectWorker) => void; reject: (error: unknown) => void}> = new Queue();
    private destroyed = false;
    resolveFrame: ((timestampUs: number) => {frameNum: number; effectSettings: Record<string,number|boolean>}) | null = null;
    readonly metrics = {frames:0,settingsUpdates:0};
    private effectSettingsPerWorker = new WeakMap<EffectWorker, Record<string, number | boolean>>();
    allWorkers: EffectWorker[] = [];
    errorMessage: string | null = null;

    private constructor(workers: EffectWorker[], allWorkers: EffectWorker[]) {
        super();
        this.workers = workers;
        this.allWorkers = allWorkers;

        for (const worker of workers) {
            worker.addEventListener('standalonemessage', event => {
                switch (event.messageName) {
                    case 'panicked':
                        if (this.errorMessage) return;
                        this.errorMessage = event.message;
                        this.dispatchEvent(new PanicEvent(event.message));
                        break;
                }
            });
        }
    }

    static async create(concurrency?: number) {
        if (!concurrency) concurrency = Math.min(4, navigator.hardwareConcurrency || 2);
        concurrency = Math.max(1, Math.min(4, concurrency));

        const initPromises = [];
        const workers = [];
        const allWorkers = [];
        for (let i = 0; i < concurrency; i++) {
            const worker = new Worker(new URL('./effect-worker.worker.js', import.meta.url), {type: 'module'});

            const dispatcher = new RpcDispatcher<WorkerSchema>(worker, messageMap);
            workers.push(dispatcher);
            allWorkers.push(dispatcher);

            initPromises.push(wasmModulePromise.then(wasmModule => dispatcher.send('init', {module: wasmModule})));
        }

        try { await Promise.all(initPromises); } catch(error) { for(const worker of workers) worker.close(); throw error; }

        return new EffectWorkerPool(workers, allWorkers);
    }

    /**
     * Wait for a worker to become available, then returns a function you can pass a callback into to run with that
     * worker. After the callback is done, the worker is put back into the pool automatically.
     */
    getNextWorker<T>(): Promise<Runner<T>> {
        if(this.destroyed) return Promise.reject(new Error('Processor closed'));
        const p = new Promise((resolve: (worker: EffectWorker) => void, reject) => {
            this.queue.pushBack({resolve,reject});
        }).then(worker => {
            const runner = (cb: (worker: EffectWorker) => Promise<T>) => {
                return cb(worker).finally(() => {
                    taskRegistry.unregister(runner);
                    if(!this.destroyed) this.workers.push(worker);
                    this.doWork();
                });
            };
            taskRegistry.register(runner, null, runner);
            return runner;
        });

        this.doWork();

        return p;
    }

    async processFrame<F extends keyof Formats>(
        settings: RenderFrameSettings,
        format: F,
    ): Promise<() => Promise<Formats[F]>> {
        if(this.resolveFrame) settings = {...settings,...this.resolveFrame(settings.frame.timestamp)};
        let runner: Runner<Formats[F]>;
        try { runner = await this.getNextWorker<Formats[F]>(); } catch(error) { settings.frame.close(); throw error; }
        this.metrics.frames++;

        // This is a two-step process. First, we send the frame to the worker to be processed immediately. However, the
        // "runner" callback intentionally does not finish until someone calls the function we return to access the
        // frame. This means that the number of in-flight frames is naturally limited to the number of workers in the
        // pool.
        let release: () => void;
        const waitForRelease = new Promise<void>(resolve => {
            release = resolve;
        });
        const framePromise = runner(async worker => {
            const workerEffectSettings = this.effectSettingsPerWorker.get(worker);
            if (workerEffectSettings !== settings.effectSettings) {
                await worker.send('update-settings', JSON.stringify(settings.effectSettings));
                this.metrics.settingsUpdates++;
                this.effectSettingsPerWorker.set(worker, settings.effectSettings);
            }
            let renderName;
            switch (format) {
                case 'imagebitmap':
                    renderName = 'render-frame-to-bitmap' as const;
                    break;
                case 'videoframe':
                    renderName = 'render-frame-to-videoframe' as const;
                    break;
                case 'pngBlob':
                    renderName = 'render-frame-to-png' as const;
                    break;
            }
            const renderedFrame = await worker.send(renderName, {
                frame: settings.frame,
                squarePixelWidth: settings.squarePixelWidth,
                squarePixelHeight: settings.squarePixelHeight,
                resizeHeight: settings.resizeHeight,
                resizeFilter: settings.resizeFilter,
                effectEnabled: settings.effectEnabled,
                rotation: settings.rotation,
                frameNum: settings.frameNum,
                padToEven: settings.padToEven,
                outputRect: settings.outputRect,
            }, [settings.frame]);
            await waitForRelease;
            return renderedFrame as Formats[F];
        });

        void framePromise.catch(() => {});
        return () => {
            release();
            return framePromise;
        };
    }

    private doWork() {
        if (!this.queue.peekFront() || this.workers.length === 0) return;
        const nextWorker = this.workers.pop()!;
        const queueHead = this.queue.popFront()!;
        queueHead.resolve(nextWorker);
    }

    destroy() {
        if(this.destroyed) return;
        this.destroyed = true;
        for(const entry of this.queue.drain()) entry.reject(new Error('Processor closed'));
        this.workers=[];
        for (const worker of this.allWorkers) {
            worker.close();
        }
    }
}



/**
 * Return the `Rotation` that undoes a video frame's EXIF rotation.
 * @param rotation The frame rotation, as a number.
 * @returns The inverse rotation, as a `Rotation`.
 */
export const getRotation = (rotation: number): Rotation => {
    switch (rotation) {
        case 90: return Rotation.Cw90;
        case 180: return Rotation.Cw180;
        case 270: return Rotation.Cw270;
        default: return Rotation.None;
    }
};
