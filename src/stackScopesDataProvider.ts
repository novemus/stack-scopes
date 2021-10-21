import * as vscode from 'vscode';
import * as path from 'path';
import * as utils from './utils';
import { StackSnapshotReviewer, StackSnapshot } from './debugSessionInterceptor';

interface StackFrameInfo {
    frameId: number;
    moduleId: number;
    moduleName: string;
    modulePath: string;
    threadId: number;
    scopeName: string;
    sourceFile: string;
    sourceLine: number;
}

export class StackScopesDataProvider implements vscode.TreeDataProvider<ScopeDataItem>, StackSnapshotReviewer {
    private _sessions: Map<string, DebugSessionScope> = new Map<string, DebugSessionScope>();
    private _onDidChangeTreeData: vscode.EventEmitter<ScopeDataItem | undefined | null | void> = new vscode.EventEmitter<ScopeDataItem | undefined | null | void>(); 
    readonly onDidChangeTreeData: vscode.Event<ScopeDataItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(context: vscode.ExtensionContext) {
        context.subscriptions.push(vscode.commands.registerCommand('stackScopes.evaluateNextArrayElement', async (item: VariableScope) => {
            if (item) {
                await item.evaluateNextElement();
                this._onDidChangeTreeData.fire();
            }
        }));
    }

    getTreeItem(element: ScopeDataItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ScopeDataItem): vscode.ProviderResult<ScopeDataItem[]> {
        if (element) {
            return element.getChildren();
        }

        if (this._sessions.size === 1) {
            for (const value of this._sessions.values()) {
                return value.getChildren();
            }
        }

        const children: DebugSessionScope[] = [];
        for (const value of this._sessions.values()) {
            children.push(value);
        }

        return Promise.resolve(children.sort((l, r) => l.snapshot.name.localeCompare(r.snapshot.name)));
    }

    getParent(element: ScopeDataItem) : vscode.ProviderResult<ScopeDataItem> {
        if (element.contextValue === 'module' && this._sessions.size === 1) {
            return undefined;
        }
        return element.getParent();
    }
  
    findFrameItem(snapshot: string, frame: number): FrameScope | undefined {
        const scope = this._sessions.get(snapshot);
        return scope ? scope.findFrame(frame) : undefined;
    }

    async onSnapshotRemoved(snapshot: StackSnapshot) {
        this._sessions.delete(snapshot.id);
        this._onDidChangeTreeData.fire();
    }
    
    async onSnapshotCreated(snapshot: StackSnapshot) {
        let topFrameItem: ScopeDataItem | undefined;
        const sessionScope: DebugSessionScope = new DebugSessionScope(snapshot);

        this._sessions.set(snapshot.id, sessionScope);

        try {
            const threads = await snapshot.threads() || [];
            const modules = await snapshot.modules() || [];

            for(const thread of threads) {
                const frames = await snapshot.frames(thread.id) || [];

                for(const frame of frames) {
                    const scopeName = frame.name.substring(Math.max(frame.name.indexOf('!') + 1, 0));
                    const module = modules.find((m: { id: any; }) => m.id === frame.moduleId);

                    let modulePath = '';
                    let moduleName = frame.name.substring(0, Math.min(frame.name.indexOf('!'), frame.name.length));
                    if (module) {
                        moduleName = module.name;
                        modulePath = module.path ? module.path : '';
                    }

                    const frameItem = sessionScope.pushFrame({
                        frameId: frame.id,
                        moduleId: frame.moduleId,
                        moduleName: moduleName,
                        modulePath: modulePath,
                        threadId: thread.id,
                        scopeName: scopeName,
                        sourceFile: frame.source ? frame.source.path : '',
                        sourceLine: frame.line,

                    });

                    if (frames[0] === frame && snapshot.topThread === thread.id) {
                        topFrameItem = frameItem;
                    }
                }
            }
        } catch (error) {
            console.log(error);
        }

        this._onDidChangeTreeData.fire();

        if (topFrameItem) {
            topFrameItem.iconPath = new vscode.ThemeIcon('debug-stackframe');
            vscode.commands.executeCommand('stackScopes.revealScopeTreeItem', topFrameItem);
        }
    }
}

export abstract class ScopeDataItem extends vscode.TreeItem {
    abstract getChildren() : vscode.ProviderResult<ScopeDataItem[]>;
    abstract getParent() : vscode.ProviderResult<ScopeDataItem>;
    abstract getTag() : string | undefined;
    abstract getSnapshot() : StackSnapshot;
}

export class DebugSessionScope extends ScopeDataItem {
    private modules: Map<number, ModuleScope> = new Map<number, ModuleScope>();
    private frames: Map<number, FrameScope> = new Map<number, FrameScope>();

    constructor(public readonly snapshot: StackSnapshot) {
        super(snapshot.name, vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = 'session';
        this.id = snapshot.id;
        this.tooltip = snapshot.name;
        this.iconPath = new vscode.ThemeIcon('callstack-view-session', new vscode.ThemeColor('debugIcon.stopForeground'));
    }
    pushFrame(info: StackFrameInfo): FrameScope | undefined {
        if (!this.modules.has(info.moduleId)) {
            this.modules.set(info.moduleId, new ModuleScope(info.moduleId, info.moduleName, info.modulePath, this));
        }
        const frame = this.modules.get(info.moduleId)?.pushFrame(info);
        if (frame) {
            this.frames.set(info.frameId, frame);
        }
        return frame;
    }
    getChildren() : vscode.ProviderResult<ScopeDataItem[]> {
        const children = [];
        for (const child of this.modules.values()) {
            children.push(child);
        }
        return Promise.resolve(children.sort((l, r) => l.name.localeCompare(r.name)));
    }
    getParent() : vscode.ProviderResult<ScopeDataItem> {
        return undefined;
    }
    findFrame(id: number): FrameScope | undefined {
        return this.frames.get(id);
    }
    getTag() : string | undefined {
        return undefined;
    }
    getSnapshot() : StackSnapshot {
        return this.snapshot;
    }
}

export class ModuleScope extends ScopeDataItem {
    private scopes: Map<string, FunctionScope> = new Map<string, FunctionScope>();

    constructor(public readonly moduleId: number, public readonly name: string, public readonly file: string, public readonly parent: ScopeDataItem) {
        super(name, vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = 'module';
        this.tooltip = file ? file : '';
        this.iconPath = new vscode.ThemeIcon('database', new vscode.ThemeColor('debugIcon.pauseForeground'));
    }
    pushFrame(info: StackFrameInfo): FrameScope | undefined {
        const key = info.scopeName + info.sourceFile;
        if (!this.scopes.has(key)) {
            this.scopes.set(key, new FunctionScope(info.scopeName, info.sourceFile, this));
        }
        return this.scopes.get(key)?.pushFrame(info);
    }
    getChildren() : vscode.ProviderResult<ScopeDataItem[]> {
        const children = [];
        for (const child of this.scopes.values()) {
            children.push(child);
        }
        return Promise.resolve(children.sort((l, r) => l.name.localeCompare(r.name)));
    }
    getParent() : vscode.ProviderResult<ScopeDataItem> {
        return this.parent;
    }
    getTag() : string | undefined {
        return utils.makeModuleTag(this.moduleId);
    }
    getSnapshot() : StackSnapshot {
        return this.parent.getSnapshot();
    }
}

export class FunctionScope extends ScopeDataItem {
    private frames: FrameScope[] = [];

    constructor(public readonly name: string, public readonly file: string, public readonly parent: ScopeDataItem) {
        super(name, vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = 'function';
        this.tooltip = name;
        this.iconPath = new vscode.ThemeIcon('symbol-function');
        this.description = file !== '' ? path.parse(file).base : 'Unknown Source';
    }
    pushFrame(info: StackFrameInfo): FrameScope | undefined {
        this.frames.push(new FrameScope(info.threadId, info.frameId, info.sourceFile, info.sourceLine, this));
        return this.frames[this.frames.length - 1];
    }
    getChildren() : vscode.ProviderResult<ScopeDataItem[]> {
        const children = [];
        for (const child of this.frames.values()) {
            children.push(child);
        }
        return Promise.resolve(children);
    }
    getParent() : vscode.ProviderResult<ScopeDataItem> {
        return this.parent;
    }
    getTag() : string | undefined {
        return utils.makeFunctionTag(this.name, this.file);
    }
    getSnapshot() : StackSnapshot {
        return this.parent.getSnapshot();
    }
}

export class FrameScope extends ScopeDataItem {
    private variables: Promise<VariableScope[]> | undefined = undefined;

    constructor(public readonly thread: number, public readonly frame: number, public readonly file: string, public readonly line: number, public readonly parent: ScopeDataItem) {
        super('#' + frame, vscode.TreeItemCollapsibleState.Collapsed);
        this.description = 'Thread #' + thread;
        this.contextValue = 'frame';
        this.tooltip = file !== '' ? path.parse(file).base + ':' + line : 'Unknown Source';
        this.iconPath = new vscode.ThemeIcon('debug-stackframe-focused');

        if (file && file.length > 0) {
            this.command = {
                title: 'Select Source Line',
                command: 'stackScopes.revealSourceLine',
                arguments: [file, line > 0 ? line - 1 : 0]
            };
        }
    }
    getChildren(): vscode.ProviderResult<ScopeDataItem[]> {
        if (!this.variables) {
            this.variables = new Promise(async (resolve, reject) => {
                try {
                    const items: VariableScope[] = [];
                    const variables = await this.getSnapshot().getFrameVariables(this.frame) || [];
                    for (const variable of variables) {
                        items.push(new VariableScope(variable.evaluateName, variable.name, variable.value, variable.type, this.frame, variable.variablesReference, this));
                    }
                    resolve(items);
                } catch (error) {
                    console.log(error);
                    reject(error);
                }
            });
        }
        return this.variables;
    }
    getParent() : vscode.ProviderResult<ScopeDataItem> {
        return this.parent;
    }
    getTag() : string | undefined {
        return utils.makeFrameTag(this.frame);
    }
    getSnapshot() : StackSnapshot {
        return this.parent.getSnapshot();
    }
}

export class VariableScope extends ScopeDataItem {
    private variables: Promise<ScopeDataItem[]> | undefined = undefined;

    constructor(public readonly accessor: string, public readonly name: string, public readonly value: string, public readonly type: string, public readonly frame: number, public readonly variablesReference: number, public readonly parent: ScopeDataItem) { 
        super(name.length > 0 ? name + ':' : '', variablesReference !== 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
        this.description = value;
        this.contextValue = name === 'this' ? 'this' : undefined;
        this.tooltip = type;
    }
    getChildren() : vscode.ProviderResult<ScopeDataItem[]> {
        if (!this.variables) {
            this.variables = new Promise(async (resolve, reject) => {
                try {
                    const items: ScopeDataItem[] = [];

                    if (this.type.match(/^.*\*\s*$/)) {
                        const expression = '*(' + this.accessor + ')';
                        const result = await this.getSnapshot().evaluateExpression(this.frame, expression);
                        items.push(new VariableScope(expression, '', result.result, result.type, this.frame, result.variablesReference, this));
                        items.push(new EvaluateScope(this));
                    } else {
                        const variables = await this.getSnapshot().getVariables(this.variablesReference) || [];
                        for (const variable of variables) {
                            items.push(new VariableScope(variable.evaluateName, variable.name, variable.value, variable.type, this.frame, variable.variablesReference, this));
                        }   
                    }

                    resolve(items);
                } catch (error) {
                    console.log(error);
                    reject(error);
                }
            });
        }
        return this.variables;
    }
    getParent() : vscode.ProviderResult<ScopeDataItem> {
        return this.parent;
    }
    getTag() : string | undefined {
        return this.name === 'this' ? utils.makeObjectTag(this.value) : undefined;
    }
    getSnapshot() : StackSnapshot {
        return this.parent.getSnapshot();
    }
    async evaluateNextElement() {
        if (this.type.match(/^.*\*\s*$/)) {
            const variables = await this.variables;
            if (variables) {
                const more = variables.pop();
                const expression = '*((' + this.accessor + ')+' + (variables.length) + ')';
                const result = await this.getSnapshot().evaluateExpression(this.frame, expression);
                variables.push(new VariableScope(expression, '', result.result, result.type, this.frame, result.variablesReference, this));
                variables.push(more as EvaluateScope);
            }
        }
    }
}

export class EvaluateScope extends ScopeDataItem {
    constructor(public readonly parent: ScopeDataItem) { 
        super('', vscode.TreeItemCollapsibleState.None);
        this.tooltip = 'more';
        this.iconPath = new vscode.ThemeIcon('more');
        this.command = {
            title: 'Evaluate Array Element',
            command: 'stackScopes.evaluateNextArrayElement',
            arguments: [this.parent as VariableScope]
        };
    }
    getChildren() : vscode.ProviderResult<ScopeDataItem[]> {
        return null;
    }
    getParent() : vscode.ProviderResult<ScopeDataItem> {
        return this.parent;
    }
    getTag() : string | undefined {
        return undefined;
    }
    getSnapshot() : StackSnapshot {
        return this.parent.getSnapshot();
    }
}
