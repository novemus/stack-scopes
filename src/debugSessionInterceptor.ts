import * as vscode from 'vscode';

export function longReferencePath(): number {
    const value : number | undefined = vscode.workspace.getConfiguration('stackScopes.reference').get('longPath');
    return value && value > 0 ? value : 16;
}

export function shortReferencePath(): number {
    const value : number | undefined = vscode.workspace.getConfiguration('stackScopes.reference').get('shortPath');
    return value && value > 0 ? value : 4;
}

export function searchResultLimit(): number {
    const value : number | undefined = vscode.workspace.getConfiguration('stackScopes.search').get('resultLimit');
    return value && value > 0 ? value : 64;
}

export interface Progress {
    abort(): boolean;
    yield(): void;
    tried(): void;
}

export interface StackSnapshotReviewer {
    onSnapshotCreated(snapshot: StackSnapshot): void;
    onSnapshotRemoved(snapshot: StackSnapshot): void;
}

export interface VariableInfo {
    getFrameId() : number;
    getVariable() : any;
    getSnapshot() : StackSnapshot;
}

export interface Reference {
    readonly thread?: any;
    readonly frame?: any;
    readonly variable?: any;
    readonly chain?: any[];
}

export interface Filter {
    readonly modules: number[];
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
                    const { modules } = await this.session.customRequest('modules', { startModule: 0, moduleCount: 10000});
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

    async hasThread(thread: number): Promise<boolean> {
        const threads = await this.threads();
        if (threads !== undefined) {
            return threads.find(th => th.id === thread);
        }
        return false;
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

    async getActualModules(): Promise<readonly any[] | undefined> {
        const modules = await this.modules() || [];
        const result: Map<number, any> = new Map<number, any>();
        const threads = await this.threads() || [];
        for(const thread of threads) {
            const frames = await this.frames(thread.id) || [];
            for(const frame of frames) {
                const module = modules.find(m => m.id === frame.moduleId);
                if (module !== undefined) {
                    result.set(module.id, module);
                } else {
                    result.set(-1, { name: 'unknown', id: -1 });
                }
            }
        }
        return Array.from(result.values());
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

    async getFrameVariable(frame: number, name: string): Promise<any | undefined> {
        const scopes = await this.getScopes(frame) || [];
        for(const scope of scopes) {
            if (scope.name === "Locals" || scope.presentationHint === 'locals') {
                const variables = await this.getVariables(scope.variablesReference) || [];
                for (const variable of variables) {
                    if (variable.name === name) {
                        return variable;
                    }
                }
            }
        }
        return undefined;
    }

    async getFrameVariables(frame: number): Promise<readonly any[] | undefined> {
        const scopes = await this.getScopes(frame) || [];
        for(const scope of scopes) {
            if (scope.name === "Local" || scope.name === "Locals" || scope.presentationHint === 'locals') {
                return await this.getVariables(scope.variablesReference);
            }
        }
        return undefined;
    }

    async evaluateExpression(frame: number, expression: string): Promise<any | undefined> {
        return new Promise(async (resolve, reject) => {
            try {
                const result = await this.session.customRequest('evaluate', {
                    expression: this.session.type == 'lldb' && this.session.configuration?.expressions != 'native' ? '${' + expression + '}' : expression,
                    frameId: frame
                });
                resolve(result);
            } catch (error) {
                console.log(error);
                reject(error);
            }
        });
    }

    searchReferences(pointer: number, depth: number, progress: Progress, filter?: Filter, target?: Reference): Promise<Reference[]> {
        const snapshot = this;

        class VariableReference implements Reference {
            static maxPathLength: number = longReferencePath();
            public readonly thread: any;
            public readonly frame: any;
            public readonly chain: any[] = [];
            public readonly variable: any;
            public readonly pointer: number = 0;
            constructor(thread?: any, frame?: any, chain?: any[], variable?: any, pointer?: number) {
                this.thread = thread;
                this.frame = frame;
                if (chain) {
                    this.chain = chain;
                }
                this.variable = variable;
                if (pointer) {
                    this.pointer = pointer;
                }
            }
            public static addThread(reference: Reference, thread: any) : VariableReference {
                return new VariableReference(thread, reference.frame, reference.chain?.slice(0, VariableReference.maxPathLength), reference.variable);
            }
            public static addFrame(reference: Reference, frame: any) : VariableReference {
                return new VariableReference(reference.thread, frame, reference.chain?.slice(0, VariableReference.maxPathLength), reference.variable);
            }
            public static addVariable(reference: Reference, variable: any, pointer: number) : VariableReference {
                if (reference.variable) {
                    let chain = reference.chain?.slice(0, VariableReference.maxPathLength);
                    if (!chain) {
                        chain = [reference.variable];
                    } else if (chain.length < VariableReference.maxPathLength) {
                        chain.push(reference.variable);
                    }
                    return new VariableReference(reference.thread, reference.frame, chain, variable, pointer);
                }
                return new VariableReference(reference.thread, reference.frame, reference.chain?.slice(0, VariableReference.maxPathLength), variable, pointer);
            }
        }

        const search = async (pointer: number, depth: number, job: number, control: Progress, target: VariableReference, exclude: Set<number>): Promise<Reference[]> => {
            let references: Reference[] = [];
            if (!control.abort()) {
                if (!target.thread) {
                    const threads = await snapshot.threads() || [];
                    for(const thread of threads) {
                        if (control.abort()) {
                            break;
                        }
                        const places = await search(pointer, depth, job / threads.length, control, VariableReference.addThread(target, thread), new Set<number>(exclude));
                        if (places.length > 0) {
                            references = [...references, ...places];
                        }
                    }
                } else if (!target.frame) {
                    const frames = await snapshot.frames(target.thread.id) || [];
                    for(const frame of frames) {
                        if (control.abort()) {
                            break;
                        }
                        if (filter && filter.modules.length > 0) {
                            const moduleId = frame.moduleId ? frame.moduleId as number : -1;
                            if (filter.modules.find(id => id === moduleId) === undefined) {
                                continue;
                            }
                        }
                        const places = await search(pointer, depth - 1, job / frames.length, control, VariableReference.addFrame(target, frame), new Set<number>(exclude));
                        if (places.length > 0) {
                            references = [...references, ...places];
                        }
                    }
                } else {
                    const variables = target.variable 
                                    ? await this.getVariables(target.variable.variablesReference)
                                    : await snapshot.getFrameVariables(target.frame.id);
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
                                const { memoryReference } = await snapshot.evaluateExpression(target.frame.id, '(void*)&(' + variable.evaluateName + ')');
                                ptr = parseInt(memoryReference);
                            }
    
                            if (ptr === pointer) {
                                references.push(VariableReference.addVariable(target, variable, ptr));
                                control.yield();
                            } else if (depth > 0 && variable.variablesReference !== 0 && ptr !== 0 && !exclude.has(ptr)) {
                                const verified: Set<number> = new Set<number>(exclude);
                                if (target.pointer !== ptr) {
                                    verified.add(target.pointer);
                                }
                                const places = await search(pointer, depth - 1, job / variables.length, control, VariableReference.addVariable(target, variable, ptr), verified);
                                if (places.length > 0) {
                                    references = [...references, ...places];
                                }
                            }
                            control.tried();
                        }
                    }
                }
            }
            return references;
        };

        return search(pointer, depth, 100.0, progress, new VariableReference(target?.thread, target?.frame, target?.chain, target?.variable), new Set<number>());
    }
}

export class DebugSessionInterceptor implements vscode.DebugAdapterTrackerFactory {
    private reviewers: Set<StackSnapshotReviewer> = new Set<StackSnapshotReviewer>();
    private sessions: Map<string, StackSnapshot> = new Map<string, StackSnapshot>();

    constructor(context: vscode.ExtensionContext) {
        context.subscriptions.push(vscode.debug.registerDebugAdapterTrackerFactory('cppdbg', this));
        context.subscriptions.push(vscode.debug.registerDebugAdapterTrackerFactory('cppvsdbg', this));
        context.subscriptions.push(vscode.debug.registerDebugAdapterTrackerFactory('lldb', this));
    }

    createDebugAdapterTracker(session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterTracker> {
        return {
            onDidSendMessage: message => {
                if (message.type === 'event' && message.event === 'stopped') {
                    const snapshot = new StackSnapshot(session, message.body.threadId);
                    this.sessions.set(session.id, snapshot);
                    this.reviewers.forEach(r => r.onSnapshotCreated(snapshot));
                    vscode.commands.executeCommand('setContext', 'stackScopes.multisession', this.sessions.size > 1);
                } else if (message.type === 'response' && message.command === 'continue' || message.command === 'next' || message.command === 'stepIn' || message.command === 'stepOut') {
                    const snapshot = this.sessions.get(session.id);
                    if (snapshot) {
                        this.reviewers.forEach(r => r.onSnapshotRemoved(snapshot));
                        this.sessions.delete(session.id);
                        vscode.commands.executeCommand('setContext', 'stackScopes.multisession', this.sessions.size > 1);
                    }
                }
            },
            onWillStopSession: () => {
                const snapshot = this.sessions.get(session.id);
                if (snapshot) {
                    this.reviewers.forEach(r => r.onSnapshotRemoved(snapshot));
                    this.sessions.delete(session.id);
                    vscode.commands.executeCommand('setContext', 'stackScopes.multisession', this.sessions.size > 1);
                }
            }
        };
    }

    subscribeStackSnapshot(reviewer: StackSnapshotReviewer): void {
        this.reviewers.add(reviewer);
        if (reviewer) {
            for(const snapshot of this.sessions.values()) {
                reviewer.onSnapshotCreated(snapshot);
            }
        }
    }

    unsubscribeStackSnapshot(reviewer: StackSnapshotReviewer): void {
        this.reviewers.delete(reviewer);
        if (reviewer) {
            for(const snapshot of this.sessions.values()) {
                reviewer.onSnapshotRemoved(snapshot);
            }
        }
    }

    getSnapshot(id: string): StackSnapshot | undefined {
        return this.sessions.get(id);
    }

    getSnapshots(): StackSnapshot[] | undefined {
        return Array.from(this.sessions.values());
    }
}
