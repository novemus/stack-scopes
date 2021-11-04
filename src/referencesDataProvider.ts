import * as vscode from 'vscode';
import * as path from 'path';
import * as utils from './utils';
import { Reference, longReferencePath, shortReferencePath, searchResultLimit } from './debugSessionInterceptor';
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

                const limit: number = searchResultLimit();
                let stage: number = 0;
                let found: number = 0;

                const references = await snapshot.searchReferences(parseInt(pointer), depth, {
                    abort: () => {
                        return token.isCancellationRequested || found >= limit; 
                    },
                    done: (part: number) => {
                        stage = Math.round(Math.min(stage + part, 100));
                        progress.report({ increment: stage, message: stage + '%' });
                    },
                    yield: (count: number) => {
                        found += count;
                    }
                });

                if (found >= limit) {
                    vscode.window.showInformationMessage(`Found ${found} references. The limit of search results has been reached. You can change the limit in the extension settings, but do it with caution, as this will consume additional memory.`);
                }

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

        FoldReference.longPathLength = longReferencePath();
        FoldReference.shortPathLength = shortReferencePath();
    }
    getChildren() : vscode.ProviderResult<ReferenceDataItem[]> {
        return new Promise(async (resolve, reject) => {
            try {
                const map: Map<number, FrameReference> = new Map<number, FrameReference>();
                this.references.forEach(reference => {
                    if (!map.has(reference.frame.id)) {
                        map.set(reference.frame.id, new FrameReference(reference.frame, reference.thread, this));
                    }
                    map.get(reference.frame.id)?.pushReference(reference);
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
    private references: Reference[] = [];
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
    pushReference(reference: Reference) {
        this.references.push(reference);
    }
    getChildren() : vscode.ProviderResult<ReferenceDataItem[]> {
        return new Promise(async (resolve, reject) => {
            try {
                let folds = new Map<string, ReferenceDataItem>();
                let variables: ReferenceDataItem[] = [];
                this.references.forEach(reference => {
                    if (reference.path?.length === 0 && reference.variable) {
                        variables.push(new VariableReference(reference.variable, this));
                    } else if (reference.path && reference.path?.length > 0) {
                        const path = reference.path.join('>');
                        if (!folds.has(path)) {
                            folds.set(path, new FoldReference(reference.path, this));
                        }
                        const fold = folds.get(path) as FoldReference;
                        fold.pushVariable(reference.variable);
                    }
                });
                resolve(variables.concat(Array.from(folds.values())));
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
    public static longPathLength: number = longReferencePath();
    public static shortPathLength: number = shortReferencePath();
    private variables: any[] = [];
    constructor(public readonly path: string[], public readonly parent: ReferenceDataItem) {
        super(FoldReference.makeShortPathLabel(path), vscode.TreeItemCollapsibleState.Expanded);
        this.contextValue = 'reference.fold';
        this.tooltip = FoldReference.makeLongPathLabel(path);
    }
    private static makeShortPathLabel(path: any[]): string {
        if (path.length >= FoldReference.longPathLength) {
            return path.slice(0, FoldReference.shortPathLength).join(' > ') + ' ...';
        } else if (path.length === 1) {
            return path[0];
        } else if (path.length > FoldReference.shortPathLength) {
            return path.slice(0, FoldReference.shortPathLength - 1).join(' > ') + ' ... ' + path[path.length - 1];
        }
        return path.join(' > ');
    }
    private static makeLongPathLabel(path: any[]): string {
        if (path.length >= FoldReference.longPathLength) {
            return path.slice(0, FoldReference.longPathLength).join(' > ') + ' ...';
        }
        return path.join(' > ');
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
        super(variable.name + ':', variable.variablesReference ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
        this.description = variable.value;
        this.contextValue = variable.name === 'this' ? 'reference.this' : 'reference.variable';
        this.tooltip = variable.type;
        if (parent instanceof FoldReference || parent instanceof FrameReference) {
            this.iconPath = new vscode.ThemeIcon('tag', new vscode.ThemeColor('debugIcon.breakpointCurrentStackframeForeground'));
        }
    }
    getChildren() : vscode.ProviderResult<ReferenceDataItem[]> {
        return new Promise(async (resolve, reject) => {
            try {
                const items: ReferenceDataItem[] = [];
                const variables = await this.getSnapshot().getVariables(this.variable.variablesReference) || [];
                for (const variable of variables) {
                    items.push(new VariableReference(variable, this));
                }
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
