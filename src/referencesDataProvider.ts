import * as vscode from 'vscode';
import * as path from 'path';
import * as utils from './utils';
import { Reference } from './debugSessionInterceptor';
import { StackSnapshot, StackSnapshotReviewer } from './debugSessionInterceptor';
import { ScopeDataItem, VariableScope } from './stackScopesDataProvider';

export class ReferencesDataProvider implements vscode.TreeDataProvider<ReferenceDataItem>, StackSnapshotReviewer {
    private _sessions: Map<string, DebugSessionReference> = new Map<string, DebugSessionReference>();
    private _onDidChangeTreeData: vscode.EventEmitter<ReferenceDataItem | undefined | null | void> = new vscode.EventEmitter<ReferenceDataItem | undefined | null | void>(); 
    readonly onDidChangeTreeData: vscode.Event<ReferenceDataItem | undefined | null | void> = this._onDidChangeTreeData.event;
    constructor(context: vscode.ExtensionContext) {
        context.subscriptions.push(
            vscode.commands.registerCommand('stackScopes.searchReferences', (item: ScopeDataItem) => {
                if (item instanceof VariableScope) {
                    this.makeBunch(item as VariableScope);
                }
            })
        );
        context.subscriptions.push(
            vscode.commands.registerCommand('stackScopes.removeReferenceBunch', (item: ReferenceDataItem) => {
                if (item instanceof SearchReference) {
                    this.removeBunch(item as SearchReference);
                }
            })
        );
        context.subscriptions.push(
            vscode.commands.registerCommand('stackScopes.clearReferenceTree', () => {
                this.clear();
            })
        );
    }
    onSnapshotRemoved(snapshot: StackSnapshot) {
        this._sessions.delete(snapshot.id);
        this._onDidChangeTreeData.fire();
        this.refreshVisibility();
    }
    onSnapshotCreated(snapshot: StackSnapshot) {
        this._sessions.set(snapshot.id, new DebugSessionReference(snapshot));
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element: ReferenceDataItem): vscode.TreeItem {
        return element;
    }
    getParent(element: ReferenceDataItem) : vscode.ProviderResult<ReferenceDataItem> {
        if (element.contextValue === 'reference.references' && this._sessions.size === 1) {
            return undefined;
        }
        return element.getParent();
    }
    getChildren(element?: ReferenceDataItem): vscode.ProviderResult<ReferenceDataItem[]> {
        if (element) {
            return element.getChildren();
        }

        if (this._sessions.size === 1) {
            for (const value of this._sessions.values()) {
                return value.getChildren();
            }
        }

        const children: ReferenceDataItem[] = [];
        for (const value of this._sessions.values()) {
            children.push(value);
        }

        return Promise.resolve([...this._sessions.values()]);
    }
    async makeBunch(scope: VariableScope) {
        const snapshot = scope.getSnapshot();
        const session = this._sessions.get(snapshot.id);
        if (session) {
            const input = await vscode.window.showInputBox({
                placeHolder: 'Specify the search depth. By default, only in the frame scopes.',
                validateInput: text => {
                    if (text.length > 0) {
                        const depth = parseInt(text);
                        if (isNaN(depth) || depth <= 0) {
                            return 'type a number more than 0';
                        };
                    }
                    return undefined;
                }
            });

            const depth = input && input.length > 0 ? parseInt(input) : 1;
            let pointer = '';
            if (scope.variable.memoryReference !== undefined && parseInt(scope.variable.variablesReference) !== 0) {
                pointer = scope.variable.memoryReference;
            } else if (scope.variable.memoryReference !== undefined && scope.variable.value?.match(/^(0x[0-9A-Fa-f]+).*$/)) {
                if (parseInt(scope.variable.memoryReference) === parseInt(scope.variable.value.match(/^(0x[0-9A-Fa-f]+).*$/)[1])) {
                    pointer = scope.variable.memoryReference;
                }
            } else {
                const { memoryReference } = await snapshot.evaluateExpression(scope.frame.id, '(void*)&(' + scope.variable.evaluateName + '),x');
                pointer = memoryReference;
            }
            const name = 'pointer=' + pointer + ' depth=' + depth;

            vscode.window.withProgress({
                location: vscode.ProgressLocation.Window,
                title: 'Search References',
                cancellable: true
            }, async (progress, token) => {
                const references = await snapshot.searchReferences(parseInt(pointer), depth, {
                    report: value => {
                        progress.report({ increment: value, message: value + '%' });
                    },
                    abort: () => {
                        return token.isCancellationRequested;
                    }
                });
                session.pushBunch(name, references);

                this._onDidChangeTreeData.fire();
                vscode.commands.executeCommand('setContext', 'stackScopes.showReferences', true);
            });
        }
    }
    removeBunch(bunch: SearchReference) {
        const snapshot = bunch.getSnapshot();
        if (snapshot && this._sessions.has(snapshot.id)) {
            this._sessions.get(snapshot.id)?.bunches.delete(bunch.name);
            this._onDidChangeTreeData.fire();
            this.refreshVisibility();
        }
    }
    clear() {
        for (const session of this._sessions.values()) {
            session.bunches.clear();
        }
        this._onDidChangeTreeData.fire();
        this.refreshVisibility();
    }
    refreshVisibility() {
        let show = false;
        this._sessions.forEach(session => {
            if (session.bunches.size > 0) {
                show = true;
            }
        });
        vscode.commands.executeCommand('setContext', 'stackScopes.showReferences', show);
    }
}

export abstract class ReferenceDataItem extends vscode.TreeItem {
    abstract getParent() : vscode.ProviderResult<ReferenceDataItem>;
    abstract getChildren() : vscode.ProviderResult<ReferenceDataItem[]>;
    abstract getSnapshot() : StackSnapshot;
    abstract getTag() : string | undefined;
}

export class DebugSessionReference extends ReferenceDataItem {
    public readonly bunches: Map<string, SearchReference> = new Map<string, SearchReference>();
    constructor(public readonly snapshot: StackSnapshot) {
        super(snapshot.name, vscode.TreeItemCollapsibleState.Expanded);
        this.contextValue = 'reference.session';
        this.id = snapshot.id;
        this.tooltip = snapshot.name;
        this.iconPath = new vscode.ThemeIcon('callstack-view-session', new vscode.ThemeColor('debugIcon.stopForeground'));
    }
    pushBunch(name: string, references: Reference[]) {
        this.bunches.set(name, new SearchReference(name, references, this));
    }
    getChildren() : vscode.ProviderResult<ReferenceDataItem[]> {
        return Promise.resolve(Array.from(this.bunches.values()));
    }
    getSnapshot() : StackSnapshot {
        return this.snapshot;
    }
    getTag() : string | undefined {
        return undefined;
    }
    getParent() : vscode.ProviderResult<ReferenceDataItem> {
        return undefined;
    }
}

export class SearchReference extends ReferenceDataItem {
    constructor(public readonly name: string, public readonly references: Reference[], public readonly parent: DebugSessionReference) {
        super(name, vscode.TreeItemCollapsibleState.Expanded);
        this.contextValue = 'reference.references';
        this.tooltip = name;
        this.iconPath = new vscode.ThemeIcon('references', new vscode.ThemeColor('debugIcon.pauseForeground'));
    }
    getChildren() : vscode.ProviderResult<ReferenceDataItem[]> {
        return new Promise(async (resolve, reject) => {
            try {
                const map: Map<number, FrameReference> = new Map<number, FrameReference>();
                this.references.forEach(reference => {
                    if (!map.has(reference.frame.id)) {
                        map.set(reference.frame.id, new FrameReference(reference.frame, reference.thread, this));
                    }
                    map.get(reference.frame.id)?.pushChain(reference.chain);
                });
                resolve(Array.from(map.values()));
            } catch (error) {
                console.log(error);
                reject(error);
            }
        });
    }
    getSnapshot() : StackSnapshot {
        return this.parent.getSnapshot();
    }
    getTag() : string | undefined {
        return undefined;
    }
    getParent() : vscode.ProviderResult<ReferenceDataItem> {
        return this.parent;
    }
}

export class FrameReference extends ReferenceDataItem {
    private chains: any[][] = [];
    constructor(public readonly frame: any, public readonly thread: any, public readonly parent: SearchReference) {
        super(frame.name, vscode.TreeItemCollapsibleState.Expanded);
        this.contextValue = 'reference.frame';
        this.description = 'Thread #' + thread.id;
        this.tooltip = frame.source && frame.source.path !== '' ? path.parse(frame.source.path).base + ':' + frame.line : 'Unknown Source';
        this.iconPath = new vscode.ThemeIcon('debug-stackframe-focused');
        if (frame.source?.path) {
            this.command = {
                title: 'Select Source Line',
                command: 'stackScopes.revealSourceLine',
                arguments: [frame.source?.path, frame.line > 0 ? frame.line - 1 : 0]
            };
        }
    }
    pushChain(chain: any[]) {
        if (chain.length > 0) {
            this.chains.push(chain);
        }
    }
    getChildren() : vscode.ProviderResult<ReferenceDataItem[]> {
        return new Promise(async (resolve, reject) => {
            try {
                let children = new Map<string, FoldReference>();
                this.chains.forEach(chain => {
                    if (chain.length > 0) {
                        const path = chain.slice(0, chain.length - 1).map(item => item.name).join('>');
                        if (!children.has(path)) {
                            children.set(path, new FoldReference(chain.slice(0, chain.length - 1), this));
                        }
                        children.get(path)?.pushVariable(chain[chain.length - 1]);
                    }
                });
                resolve(Array.from(children.values()));
            } catch (error) {
                console.log(error);
                reject(error);
            }
        });
    }
    getSnapshot() : StackSnapshot {
        return this.parent.getSnapshot();
    }
    getTag() : string | undefined {
        return utils.makeFrameTag(this.frame.id);
    }
    getParent() : vscode.ProviderResult<ReferenceDataItem> {
        return this.parent;
    }
}

export class FoldReference extends ReferenceDataItem {
    private variables: any[] = [];
    private children: Promise<ReferenceDataItem[]> | undefined = undefined;
    constructor(public readonly path: any[], public readonly parent: ReferenceDataItem) {
        super(FoldReference.makeName(path), vscode.TreeItemCollapsibleState.Expanded);
        this.contextValue = 'reference.fold';
        this.tooltip = path.map(item => item.name).join(' > ');
        if (path.length >= 16) {
            this.tooltip += ' ...';
        }
    }
    private static makeName(path: any[]) {
        if (path.length === 1) {
            return path[0].name;
        } else if (path.length >= 16) {
            return path.slice(0, 4).map(item => item.name).join(' > ') + ' ...';
        } else if (path.length > 4) {
            return path.slice(0, 3).map(item => item.name).join(' > ') + ' ... ' + path[path.length - 1].name;
        }
        return path.map(item => item.name).join(' > ');
    }
    pushVariable(variable: any) {
        this.variables.push(variable);
    }
    getChildren() : vscode.ProviderResult<ReferenceDataItem[]> {
        return new Promise(async (resolve, reject) => {
            try {
                const items: ReferenceDataItem[] = [];
                this.variables.forEach(variable => {
                    const child = new VariableReference(variable, this);
                    items.push(child);
                });
                resolve(items);
            } catch (error) {
                console.log(error);
                reject(error);
            }
        });
    }
    getSnapshot() : StackSnapshot {
        return this.parent.getSnapshot();
    }
    getTag() : string | undefined {
        return undefined;
    }
    getParent() : vscode.ProviderResult<ReferenceDataItem> {
        return this.parent;
    }
}

export class VariableReference extends ReferenceDataItem {
    constructor(public readonly variable: any, public readonly parent: ReferenceDataItem) {
        super(variable.name + ':', vscode.TreeItemCollapsibleState.Collapsed);
        this.description = variable.value;
        this.contextValue = variable.name === 'this' ? 'reference.this' : 'reference.variable';
        this.tooltip = variable.value;
        this.iconPath = new vscode.ThemeIcon('tag', new vscode.ThemeColor('debugIcon.breakpointCurrentStackframeForeground'));
    }
    getChildren() : vscode.ProviderResult<ReferenceDataItem[]> {
        return new Promise(async (resolve, reject) => {
            try {
                const items: ReferenceDataItem[] = [];
                Object.keys(this.variable).forEach(key => {
                    items.push(new PropertyReference(key, this.variable[key].toString(), this));
                });
                resolve(items);
            } catch (error) {
                console.log(error);
                reject(error);
            }
        });
    }
    getSnapshot() : StackSnapshot {
        return this.parent.getSnapshot();
    }
    getTag() : string | undefined {
        return this.variable.name === 'this' ? utils.makeObjectTag(this.variable.value) : undefined;
    }
    getParent() : vscode.ProviderResult<ReferenceDataItem> {
        return this.parent;
    }
}

export class PropertyReference extends ReferenceDataItem {
    constructor(public readonly name: string, public readonly value: string, public readonly parent: ReferenceDataItem) {
        super(name + ':', vscode.TreeItemCollapsibleState.None);
        this.description = value;
        this.contextValue = 'reference.property';
        this.tooltip = value;
    }
    getChildren() : vscode.ProviderResult<ReferenceDataItem[]> {
        return undefined;
    }
    getSnapshot() : StackSnapshot {
        return this.parent.getSnapshot();
    }
    getTag() : string | undefined {
        return undefined;
    }
    getParent() : vscode.ProviderResult<ReferenceDataItem> {
        return this.parent;
    }
}