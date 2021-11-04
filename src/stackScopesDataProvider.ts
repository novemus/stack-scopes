import * as vscode from 'vscode';
import * as path from 'path';
import * as utils from './utils';
import { StackSnapshotReviewer, StackSnapshot } from './debugSessionInterceptor';

export class StackScopesDataProvider implements vscode.TreeDataProvider<ScopeDataItem>, StackSnapshotReviewer {
    private _sessions: Map<string, DebugSessionScope> = new Map<string, DebugSessionScope>();
    private _onDidChangeTreeData: vscode.EventEmitter<ScopeDataItem | undefined | null | void> = new vscode.EventEmitter<ScopeDataItem | undefined | null | void>(); 
    readonly onDidChangeTreeData: vscode.Event<ScopeDataItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(context: vscode.ExtensionContext) {
        context.subscriptions.push(vscode.commands.registerCommand('stackScopes.evaluateNextArrayElement', async (item: VariableScope) => {
            if (item) {
                item.evaluateNextElement();
                this._onDidChangeTreeData.fire(item);
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
        if (element.contextValue === 'scope.module' && this._sessions.size === 1) {
            return undefined;
        }
        return element.getParent();
    }
  
    findFrameItem(snapshot: string, frame: number): FrameScope | undefined {
        const scope = this._sessions.get(snapshot);
        return scope ? scope.findFrame(frame) : undefined;
    }

    onSnapshotRemoved(snapshot: StackSnapshot) {
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

                    const module = modules.find((m: { id: any; }) => m.id === frame.moduleId);
                    const frameItem = sessionScope.pushFrame(thread, module, frame);

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
        this.contextValue = 'scope.session';
        this.id = snapshot.id;
        this.tooltip = snapshot.name;
        this.iconPath = new vscode.ThemeIcon('callstack-view-session', new vscode.ThemeColor('debugIcon.stopForeground'));
    }
    pushFrame(thread: any, module: any, frame: any): FrameScope | undefined {
        const id = frame.moduleId ? frame.moduleId : 0;
        if (!this.modules.has(id)) {
            this.modules.set(id, new ModuleScope(module, this));
        }
        const f = this.modules.get(id)?.pushFrame(thread, frame);
        if (f) {
            this.frames.set(frame.id, f);
        }
        return f;
    }
    getChildren() : vscode.ProviderResult<ScopeDataItem[]> {
        const children = [];
        for (const child of this.modules.values()) {
            children.push(child);
        }
        return Promise.resolve(children.sort((l, r) => (l.label as string).localeCompare(r.label as string)));
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
    constructor(public readonly module: any, public readonly parent: ScopeDataItem) {
        super(module?.name ? module.name : '', vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = 'scope.module';
        this.tooltip = module?.path ? module.path : '';
        this.iconPath = new vscode.ThemeIcon('database', new vscode.ThemeColor('debugIcon.pauseForeground'));
    }
    pushFrame(thread: any, frame: any): FrameScope | undefined {
        const key = frame.name + (frame.source ? frame.source.path : '');
        if (!this.scopes.has(key)) {
            this.scopes.set(key, new FunctionScope(frame, this));
        }
        return this.scopes.get(key)?.pushFrame(thread, frame);
    }
    getChildren() : vscode.ProviderResult<ScopeDataItem[]> {
        const children = [];
        for (const child of this.scopes.values()) {
            children.push(child);
        }
        return Promise.resolve(children.sort((l, r) => (l.label as string).localeCompare(r.label as string)));
    }
    getParent() : vscode.ProviderResult<ScopeDataItem> {
        return this.parent;
    }
    getTag() : string | undefined {
        return utils.makeModuleTag(this.module ? this.module.id : 0);
    }
    getSnapshot() : StackSnapshot {
        return this.parent.getSnapshot();
    }
}

export class FunctionScope extends ScopeDataItem {
    private frames: FrameScope[] = [];
    constructor(public readonly frame: any, public readonly parent: ScopeDataItem) {
        super(frame.name.substring(Math.max(frame.name.indexOf('!') + 1, 0)), vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = 'scope.function';
        this.tooltip = this.label as string;
        this.iconPath = new vscode.ThemeIcon('symbol-function');
        this.description = frame.source?.path ? path.parse(frame.source.path).base : 'Unknown Source';
    }
    pushFrame(thread: any, frame: any): FrameScope | undefined {
        this.frames.push(new FrameScope(thread, frame, this));
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
        return utils.makeFunctionTag(this.label as string, this.frame.source?.path);
    }
    getSnapshot() : StackSnapshot {
        return this.parent.getSnapshot();
    }
}

export class FrameScope extends ScopeDataItem {
    constructor(public readonly thread: any, public readonly frame: any, public readonly parent: ScopeDataItem) {
        super('#' + frame.id, vscode.TreeItemCollapsibleState.Collapsed);
        this.description = 'Thread #' + thread.id;
        this.contextValue = 'scope.frame';
        this.tooltip = frame.source?.path ? path.parse(frame.source.path).base + ':' + frame.line : 'Unknown Source';
        this.iconPath = new vscode.ThemeIcon('debug-stackframe-focused');

        if (frame.source?.path) {
            this.command = {
                title: 'Select Source Line',
                command: 'stackScopes.revealSourceLine',
                arguments: [frame.source?.path, frame.line > 0 ? frame.line - 1 : 0]
            };
        }
    }
    getChildren(): vscode.ProviderResult<ScopeDataItem[]> {
        return new Promise(async (resolve, reject) => {
            try {
                const items: VariableScope[] = [];
                const variables = await this.getSnapshot().getFrameVariables(this.frame.id) || [];
                for (const variable of variables) {
                    items.push(new VariableScope(variable, this.frame, this));
                }
                resolve(items);
            } catch (error) {
                console.log(error);
                reject(error);
            }
        });
    }
    getParent() : vscode.ProviderResult<ScopeDataItem> {
        return this.parent;
    }
    getTag() : string | undefined {
        return utils.makeFrameTag(this.frame.id);
    }
    getSnapshot() : StackSnapshot {
        return this.parent.getSnapshot();
    }
}

export class VariableScope extends ScopeDataItem {
    private evaluate: number = 0;
    constructor(public readonly variable: any, public readonly frame: any, public readonly parent: ScopeDataItem) { 
        super(variable.name?.length > 0 ? variable.name + ':' : '', variable.variablesReference !== 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
        this.description = variable.value ? variable.value : variable.result;
        this.contextValue = this.variable.name === 'this' ? 'scope.this' : 'scope.variable';
        this.tooltip = variable.type;
    }
    getChildren() : vscode.ProviderResult<ScopeDataItem[]> {
        return new Promise(async (resolve, reject) => {
            try {
                const items: ScopeDataItem[] = [];
                const variables = await this.getSnapshot().getVariables(this.variable.variablesReference) || [];
                if (this.variable.type.match(/^.*\*\s*(const)?\s*$/) && variables.length === 1 && variables[0].memoryReference) {
                    const variable = { ...variables[0] };
                    variable.name = '';
                    items.push(new VariableScope(variable, this.frame, this));
                    for(let i = 1; i <= this.evaluate; ++i) {
                        const expression = '*((' + this.variable.evaluateName + ')+' + i + ')';
                        const data = await this.getSnapshot().evaluateExpression(this.frame.id, expression);
                        items.push(new VariableScope({ ...data, value: data.result, evaluateName: expression }, this.frame, this));
                    }
                    items.push(new EvaluateScope(this));
                } else {
                    for (const variable of variables) {
                        items.push(new VariableScope(variable, this.frame, this));
                    }
                }
                resolve(items);
            } catch (error) {
                console.log(error);
                reject(error);
            }
        });
    }
    getParent() : vscode.ProviderResult<ScopeDataItem> {
        return this.parent;
    }
    getTag() : string | undefined {
        return this.variable.name === 'this' ? utils.makeObjectTag(this.variable.value) : undefined;
    }
    getSnapshot() : StackSnapshot {
        return this.parent.getSnapshot();
    }
    evaluateNextElement() {
        this.evaluate = this.evaluate + 1;
    }
}

export class EvaluateScope extends ScopeDataItem {
    constructor(public readonly parent: ScopeDataItem) { 
        super('', vscode.TreeItemCollapsibleState.None);
        this.tooltip = 'more';
        this.iconPath = new vscode.ThemeIcon('more');
        this.contextValue = 'scope.evaluate';
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
