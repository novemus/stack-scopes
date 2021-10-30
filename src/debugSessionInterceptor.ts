import * as vscode from 'vscode';

export interface Progress {
    abort(): boolean;
    report(job: number): void;
}

export interface StackSnapshotReviewer {
    onSnapshotCreated(snapshot: StackSnapshot): void;
    onSnapshotRemoved(snapshot: StackSnapshot): void;
}

export interface Reference {
    thread: any;
    frame: any;
    chain: any[];
}

export class StackSnapshot {
    public readonly id: string;
    public readonly name: string;
    private _threads: Promise<readonly any[] | undefined> | undefined = undefined;
    private _modules: Promise<readonly any[] | undefined> | undefined = undefined;
    private _frames: Map<number, Promise<readonly any[] | undefined>> = new Map<number, Promise<readonly any[] | undefined>>();
    private _scopes: Map<number, Promise<readonly any[] | undefined>> = new Map<number, Promise<readonly any[] | undefined>>();
    private _variables: Map<number, Promise<readonly any[] | undefined>> = new Map<number, Promise<readonly any[] | undefined>>();

    constructor(private readonly session: vscode.DebugSession, public readonly topThread: number) {
        this.id = session.id;
        this.name = session.name;
    }

    async modules(): Promise<readonly any[] | undefined> {
        if (!this._modules) {
            this._modules = new Promise(async (resolve, reject) => {
                try {
                    const { modules } = await this.session.customRequest('modules', { startModule: 0, moduleCount: 0});
                    resolve(modules);
                } catch (error) {
                    console.log(error);
                    reject(error);
                }
            });
        }
        return this._modules;
    }

    async threads(): Promise<readonly any[] | undefined> {
        if (!this._threads) {
            this._threads = new Promise(async (resolve, reject) => {
                try {
                    const { threads } = await this.session.customRequest('threads');
                    resolve(threads);
                } catch (error) {
                    console.log(error);
                    reject(error);
                }
            });
        }
        return this._threads;
    }

    async frames(thread: number): Promise<readonly any[] | undefined> {
        if (!this._frames.has(thread)) {
            this._frames.set(thread, new Promise(async (resolve, reject) => {
                try {
                    const { stackFrames } = await this.session.customRequest('stackTrace', {
                        threadId: thread,
                        startFrame: 0,
                        levels: undefined,
                        format: {
                            parameters: true,
                            parameterTypes: true,
                            parameterNames: true,
                            parameterValues: false,
                            line: false,
                            module: true
                        }
                    });
                    resolve(stackFrames);
                } catch (error) {
                    console.log(error);
                    reject(error);
                }
            }));
        }
        return this._frames.get(thread);
    }

    async getScopes(frame: number): Promise<readonly any[] | undefined> {
        if (!this._scopes.has(frame)) {
            this._scopes.set(frame, new Promise(async (resolve, reject) => {
                try {
                    const { scopes } = await this.session.customRequest('scopes', { frameId: frame });
                    resolve(scopes);
                } catch (error) {
                    console.log(error);
                    reject(error);
                }
            }));
        }
        return this._scopes.get(frame);
    }

    async getVariables(reference: number): Promise<readonly any[] | undefined> {
        if (!this._variables.has(reference)) {
            this._variables.set(reference, new Promise(async (resolve, reject) => {
                try {
                    const { variables } = await this.session.customRequest('variables', {
                        variablesReference: reference,
                        filter: undefined,
                        start: 0,
                        count: undefined,
                        format: { hex: false }
                    });
                    resolve(variables);
                } catch (error) {
                    console.log(error);
                    reject(error);
                }
            }));
        }
        return this._variables.get(reference);
    }

    async getVariableValue(frame: number, name: string): Promise<string | undefined> {
        const scopes = await this.getScopes(frame) || [];
        for(const scope of scopes) {
            if (scope.name === "Locals" || scope.presentationHint === 'locals') {
                const variables = await this.getVariables(scope.variablesReference) || [];
                for (const variable of variables) {
                    if (variable.name === name) {
                        return variable.value;
                    }
                }
            }
        }
        return undefined;
    }

    async getFrameVariables(frame: number): Promise<readonly any[] | undefined> {
        const scopes = await this.getScopes(frame) || [];
        for(const scope of scopes) {
            if (scope.name === "Locals" || scope.presentationHint === 'locals') {
                return await this.getVariables(scope.variablesReference);
            }
        }
        return undefined;
    }

    async evaluateExpression(frame: number, expression: string): Promise<any | undefined> {
        return new Promise(async (resolve, reject) => {
            try {
                const result = await this.session.customRequest('evaluate', {
                    expression: expression,
                    frameId: frame
                });
                resolve(result);
            } catch (error) {
                console.log(error);
                reject(error);
            }
        });
    }

    private async searchPointerReferences(pointer: number, depth: number, job: number, control: Progress, target: Reference, verified: Set<number>): Promise<Reference[]> {
        let references: Reference[] = [];
        if (!control.abort()) {
            if (!target?.thread) {
                const threads = await this.threads() || [];
                for(const thread of threads) {
                    if (control.abort()) {
                        break;
                    }
                    const places = await this.searchPointerReferences(pointer, depth, job / threads.length, control, { thread: thread, frame: target?.frame, chain: target?.chain }, verified);
                    if (places.length > 0) {
                        references = [...references, ...places];
                    }
                }
            } else if (!target.frame) {
                const frames = await this.frames(target.thread.id) || [];
                for(const frame of frames) {
                    if (control.abort()) {
                        break;
                    }
                    const places = await this.searchPointerReferences(pointer, depth - 1, job / frames.length, control, { thread: target.thread, frame: frame, chain: target?.chain }, verified);
                    if (places.length > 0) {
                        references = [...references, ...places];
                    }
                }
            } else {
                const variables = !target.chain || target.chain.length === 0 ? await this.getFrameVariables(target.frame.id) : await this.getVariables(target.chain[target.chain.length - 1].variablesReference);
                if (variables) {
                    for(const variable of variables) {
                        if (control.abort()) {
                            break;
                        }

                        let ptr = 0;
                        if (variable.memoryReference !== undefined && parseInt(variable.variablesReference) !== 0) {
                            ptr = parseInt(variable.memoryReference);
                        } else if (variable.memoryReference !== undefined && variable.value?.match(/^(0x[0-9A-Fa-f]+).*$/)) {
                            if (parseInt(variable.memoryReference) === parseInt(variable.value.match(/^(0x[0-9A-Fa-f]+).*$/)[1])) {
                                ptr = parseInt(variable.memoryReference);
                            }
                        } else {
                            const { memoryReference } = await this.evaluateExpression(target.frame.id, '(void*)&(' + variable.evaluateName + ')');
                            ptr = parseInt(memoryReference);
                        }

                        if (ptr === pointer) {
                            references.push({ thread: target.thread, frame: target.frame, chain: [ ...target.chain, variable ] });
                        }
                        else if (depth > 0 && ptr !== 0 && variable.variablesReference !== 0 && !verified.has(ptr)) {
                            verified.add(ptr);
                            const places = await this.searchPointerReferences(pointer, depth - 1, job / variables.length, control, { thread: target.thread, frame: target.frame, chain: [ ...target.chain, variable ] }, verified);
                            if (places.length > 0) {
                                references = [...references, ...places];
                            }
                        }
                    }
                }
            }
        }
        control.report(job);
        return references;
    }

    searchReferences(pointer: number, depth: number, progress: Progress, target?: Reference): Promise<Reference[]> {
        let total: number = 0;
        const prog = {
            abort: progress.abort,
            report: (job: number) => {
                total += job;
                progress.report(Math.round(total));
            }
        };
        return this.searchPointerReferences(pointer, depth, 100, prog, target ? target : { thread: null, frame: null, chain: [] }, new Set<number>());
    }
}

export class DebugSessionInterceptor implements vscode.DebugAdapterTrackerFactory {
    private reviewers: StackSnapshotReviewer[] = [];
    private sessions: Map<string, StackSnapshot> = new Map<string, StackSnapshot>();

    constructor(context: vscode.ExtensionContext) {
        context.subscriptions.push(vscode.debug.registerDebugAdapterTrackerFactory('cppdbg', this));
        context.subscriptions.push(vscode.debug.registerDebugAdapterTrackerFactory('cppvsdbg', this));
    }

    createDebugAdapterTracker(session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterTracker> {
        return {
            onDidSendMessage: message => {
                if (message.type === 'event' && message.event === 'stopped') {
                    const snapshot = new StackSnapshot(session, message.body.threadId);
                    this.sessions.set(session.id, snapshot);
                    this.reviewers.forEach(r => r.onSnapshotCreated(snapshot));
                } else if (message.type === 'response' && message.command === 'continue' || message.command === 'next' || message.command === 'stepIn' || message.command === 'stepOut') {
                    const snapshot = this.sessions.get(session.id);
                    if (snapshot) {
                        this.reviewers.forEach(r => r.onSnapshotRemoved(snapshot));
                        this.sessions.delete(session.id);
                    }
                }
            },
            onWillStopSession: () => {
                const snapshot = this.sessions.get(session.id);
                if (snapshot) {
                    this.reviewers.forEach(r => r.onSnapshotRemoved(snapshot));
                    this.sessions.delete(session.id);
                }
            }
        };
    }

    subscribeStackSnapshot(reviewer: StackSnapshotReviewer): void {
        this.reviewers.push(reviewer);
    }

    getSnapshot(id: string): StackSnapshot | undefined {
        return this.sessions.get(id);
    }
}
