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
                    this.makeBunchForVariable(item as VariableScope);
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
    async makeBunchForVariable(scope: VariableScope) {
        const snapshot = scope.getSnapshot();
        const session = this._sessions.get(snapshot.id);
        if (session) {
            const input = await vscode.window.showInputBox({
                placeHolder: 'Specify the search depth. 1 - search only in frame scopes.',
                validateInput: text => {
                    if (text.length === 0) {
                        return 'type a number more than 0';
                    } else if (text.length > 0) {
                        const depth = parseInt(text);
                        if (isNaN(depth) || depth <= 0) {
                            return 'type a number more than 0';
                        };
                    }
                    return undefined;
                }
            });

            const depth = parseInt(input as string);
            if (isNaN(depth)) {
                return;
            }

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

                session.addBunch(name, references);
                this._onDidChangeTreeData.fire();
            });
        }
    }
    removeBunch(bunch: SearchReference) {
        const snapshot = bunch.getSnapshot();
        const session = this._sessions.get(snapshot.id);
        if (session) {
            session.deleteBunch(bunch.name);
            this._onDidChangeTreeData.fire();
        }
    }
    clear() {
        for (const session of this._sessions.values()) {
            session.children.clear();
        }
        this._onDidChangeTreeData.fire();
    }
}

export abstract class ReferenceDataItem extends vscode.TreeItem {
    abstract getParent() : vscode.ProviderResult<ReferenceDataItem>;
    abstract getChildren() : vscode.ProviderResult<ReferenceDataItem[]>;
    abstract getSnapshot() : StackSnapshot;
    abstract getTag() : string | undefined;
    abstract getReference() : Reference | undefined;
}

export class DebugSessionReference extends ReferenceDataItem {
    public readonly children: Map<string, SearchReference> = new Map<string, SearchReference>();
    constructor(public readonly snapshot: StackSnapshot) {
        super(snapshot.name, vscode.TreeItemCollapsibleState.Expanded);
        this.contextValue = 'reference.session';
        this.id = snapshot.id;
        this.tooltip = snapshot.name;
        this.iconPath = new vscode.ThemeIcon('callstack-view-session', new vscode.ThemeColor('debugIcon.stopForeground'));
    }
    addBunch(name: string, references: Reference[]) {
        this.children.set(name, new SearchReference(name, references, this));
    }
    deleteBunch(name: string) {
        this.children.delete(name);
    }
    getChildren() : vscode.ProviderResult<ReferenceDataItem[]> {
        return Promise.resolve(Array.from(this.children.values()));
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
    getReference() : Reference | undefined {
        return undefined;
    }
}

export class SearchReference extends ReferenceDataItem {
    private children: vscode.ProviderResult<ReferenceDataItem[]>;
    constructor(public readonly name: string, public readonly references: Reference[], public readonly parent: DebugSessionReference) {
        super(name, vscode.TreeItemCollapsibleState.Expanded);
        this.contextValue = 'reference.references';
        this.tooltip = name;
        this.iconPath = new vscode.ThemeIcon('references', new vscode.ThemeColor('debugIcon.pauseForeground'));

        FoldReference.longPathLength = longReferencePath();
        FoldReference.shortPathLength = shortReferencePath();
    }
    getChildren() : vscode.ProviderResult<ReferenceDataItem[]> {
        if (!this.children) {
            this.children = new Promise(async (resolve, reject) => {
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
        return this.children;
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
    getReference() : Reference | undefined {
        return undefined;
    }
}

export class FrameReference extends ReferenceDataItem {
    private references: Reference[] = [];
    private children: vscode.ProviderResult<ReferenceDataItem[]>;
    constructor(public readonly frame: any, public readonly thread: any, public readonly parent: SearchReference) {
        super(frame.name, vscode.TreeItemCollapsibleState.Expanded);
        this.contextValue = 'reference.frame';
        this.description = 'Frame #' + frame.id;
        this.tooltip = 'Thread #' + thread.id;
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
        if (!this.children) {
            this.children = new Promise(async (resolve, reject) => {
                try {
                    let folds = new Map<string, ReferenceDataItem>();
                    let variables: ReferenceDataItem[] = [];
                    this.references.forEach(reference => {
                        if (reference.chain?.length === 0 && reference.variable) {
                            variables.push(new VariableReference(reference.variable, this));
                        } else if (reference.chain && reference.chain.length > 0) {
                            const path = reference.chain.map(c => c.name).join('>');
                            if (!folds.has(path)) {
                                folds.set(path, new FoldReference(reference.chain, this));
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
        return this.children;
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
    getReference() : Reference | undefined {
        return { frame: this.frame, thread: this.thread };
    }
}

export class FoldReference extends ReferenceDataItem {
    public static longPathLength: number = longReferencePath();
    public static shortPathLength: number = shortReferencePath();
    private variables: any[] = [];
    private children: vscode.ProviderResult<ReferenceDataItem[]>;
    constructor(public readonly chain: any[], public readonly parent: ReferenceDataItem) {
        super(FoldReference.makeShortPathLabel(chain), vscode.TreeItemCollapsibleState.Expanded);
        this.contextValue = 'reference.fold';
        this.tooltip = FoldReference.makeLongPathLabel(chain);
    }
    private static makeShortPathLabel(chain: any[]): string {
        if (chain.length >= FoldReference.longPathLength) {
            return chain.slice(0, FoldReference.shortPathLength).map(c => c.name).join(' > ') + ' ...';
        } else if (chain.length === 1) {
            return chain[0].name;
        } else if (chain.length > FoldReference.shortPathLength) {
            return chain.slice(0, FoldReference.shortPathLength - 1).map(c => c.name).join(' > ') + ' ... ' + chain[chain.length - 1].name;
        }
        return chain.map(c => c.name).join(' > ');
    }
    private static makeLongPathLabel(chain: any[]): string {
        if (chain.length >= FoldReference.longPathLength) {
            return chain.slice(0, FoldReference.longPathLength).map(c => c.name).join(' > ') + ' ...';
        }
        return chain.map(c => c.name).join(' > ');
    }
    pushVariable(variable: any) {
        this.variables.push(variable);
    }
    getChildren() : vscode.ProviderResult<ReferenceDataItem[]> {
        if (!this.children) {
            this.children = new Promise(async (resolve, reject) => {
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
        return this.children;
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
    getReference() : Reference | undefined {
        const reference = this.parent.getReference();
        if (reference) {
            return { ...reference, chain: this.chain };
        }
        return { chain: this.chain };
    }
}

export class VariableReference extends ReferenceDataItem {
    private children: vscode.ProviderResult<ReferenceDataItem[]>;
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
        if (!this.children) {
            this.children = new Promise(async (resolve, reject) => {
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
        return this.children;
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
    getReference() : Reference {
        const reference = this.parent.getReference();
        if (reference) {
            if (this.parent instanceof VariableReference) {
                const chain = reference.chain ? [...reference.chain, reference.variable] : [reference.variable];
                return {
                    thread: reference.thread,
                    frame: reference.frame,
                    chain: chain.slice(0, FoldReference.longPathLength),
                    variable: this.variable
                };
            }
            return { ...reference, variable: this.variable };
        }
        return { variable: this.variable };
    }
}
