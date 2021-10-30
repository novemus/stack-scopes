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
            vscode.commands.registerCommand('stackScopes.revealReferences', (item: ReferenceDataItem) => {
                if (item instanceof SearchReference) {
                    this.revealReferences(item as SearchReference);
                }
            })
        );
        context.subscriptions.push(
            vscode.commands.registerCommand('stackScopes.clearReferenceTree', () => {
                this.clear();
            })
        );
        context.subscriptions.push(vscode.commands.registerCommand('stackScopes.unfoldReferenceItem', async (item: ReferenceDataItem) => {
            if (item) {
                const frame = item as FrameReference;
                if (frame) {
                    frame.unfold();
                }
                const variable = item as VariableReference;
                if (variable) {
                    variable.unfold();
                }
                this._onDidChangeTreeData.fire();
            }
        }));
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
    async revealReferences(bunch: SearchReference) {
        bunch.revealReferences();
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
        const session = this._sessions.get(snapshot.id);
        if (session) {
            session.bunches.delete(bunch.name);
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
    abstract revealReferences(): void;
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
    revealReferences() {
        for(const bunch of this.bunches.values()) {
            bunch.revealReferences();
        }
    }
    getParent() : vscode.ProviderResult<ReferenceDataItem> {
        return undefined;
    }
}

export class SearchReference extends ReferenceDataItem {
    private children: Promise<ReferenceDataItem[]> | undefined = undefined;
    constructor(public readonly name: string, public readonly references: Reference[], public readonly parent: DebugSessionReference) {
        super(name, vscode.TreeItemCollapsibleState.Expanded);
        this.contextValue = 'reference.references';
        this.tooltip = name;
        this.iconPath = new vscode.ThemeIcon('references', new vscode.ThemeColor('debugIcon.pauseForeground'));
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
                        map.get(reference.frame.id)?.pushChain(reference.chain);
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
    revealReferences() {
        this.children?.then(children => {
            children.forEach(child => child.revealReferences());
        });
    }
    getParent() : vscode.ProviderResult<ReferenceDataItem> {
        return this.parent;
    }
}

export class FrameReference extends ReferenceDataItem {
    private unfolded: boolean = true;
    private chains: any[][] = [];
    private children: Promise<ReferenceDataItem[]> | undefined = undefined;
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
            if (this.chains.find(c => c.length === 1) === undefined){
                this.unfolded = false;
            }
        }
    }
    unfold() {
        this.unfolded = true;
        this.children = undefined;
        this.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
    }
    getChildren() : vscode.ProviderResult<ReferenceDataItem[]> {
        if (!this.children) {
            this.children = new Promise(async (resolve, reject) => {
                try {
                    if (this.unfolded) {
                        const items: VariableReference[] = [];
                        const variables = await this.getSnapshot().getFrameVariables(this.frame.id) || [];
                        for (const variable of variables) {
                            items.push(new VariableReference(variable, this));
                        }
                        this.chains.forEach(chain => {
                            const child = items.find(item => chain[0].variablesReference === item.variable.variablesReference);
                            if (child) {
                                if (chain.length > 1) {
                                    child.pushChain(chain.slice(1));
                                } else {
                                    child.iconPath = new vscode.ThemeIcon('tag', new vscode.ThemeColor('debugIcon.breakpointCurrentStackframeForeground'));
                                }
                            }
                        });
                        resolve(items);
                    } else {
                        const items: ReferenceDataItem[] = [];
                        items.push(new FoldReference(this.chains, this));
                        resolve(items);
                    }
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
    revealReferences() {
        this.children?.then(children => {
            children.forEach(child => child.revealReferences());
        });
    }
    getParent() : vscode.ProviderResult<ReferenceDataItem> {
        return this.parent;
    }
}

export class FoldReference extends ReferenceDataItem {
    private children: Promise<ReferenceDataItem[]> | undefined = undefined;
    constructor(public readonly chains: any[][], public readonly parent: ReferenceDataItem) {
        super('', vscode.TreeItemCollapsibleState.Expanded);
        this.contextValue = 'reference.fold';
        this.iconPath = new vscode.ThemeIcon('more');
        this.command = {
            title: 'Unfold Reference Item',
            command: 'stackScopes.unfoldReferenceItem',
            arguments: [this.parent as ReferenceDataItem]
        };
    }
    getChildren() : vscode.ProviderResult<ReferenceDataItem[]> {
        if (!this.children) {
            this.children = new Promise(async (resolve, reject) => {
                try {
                    const items: ReferenceDataItem[] = [];
                    this.chains.forEach(chain => {
                        const child = new VariableReference(chain[chain.length - 1], this);
                        child.iconPath = new vscode.ThemeIcon('tag', new vscode.ThemeColor('debugIcon.breakpointCurrentStackframeForeground'));
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
    revealReferences() {
        this.children?.then(children => {
            children.forEach(child => child.revealReferences());
        });
    }
    getParent() : vscode.ProviderResult<ReferenceDataItem> {
        return this.parent;
    }
}

export class VariableReference extends ReferenceDataItem {
    private unfolded: boolean = true;
    private chains: any[][] = [];
    private children: Promise<ReferenceDataItem[]> | undefined = undefined;
    constructor(public readonly variable: any, public readonly parent: ReferenceDataItem) {
        super(variable.name + ':', variable.variablesReference ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
        this.description = variable.value;
        this.contextValue = variable.name === 'this' ? 'reference.this' : 'reference.variable';
        this.tooltip = variable.type;
    }
    pushChain(chain: any[]) {
        if (chain.length > 0) {
            this.chains.push(chain);
            if (this.chains.find(c => c.length === 1) === undefined) {
                this.unfolded = false;
            }
            this.collapsibleState = this.variable.variablesReference
                ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None;
        }
    }
    unfold() {
        this.unfolded = true;
        this.children = undefined;
        this.collapsibleState = this.variable.variablesReference
            ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None;
    }
    getChildren() : vscode.ProviderResult<ReferenceDataItem[]> {
        if (!this.children) {
            this.children = new Promise(async (resolve, reject) => {
                try {
                    if (this.unfolded) {
                        const items: VariableReference[] = [];
                        const variables = await this.getSnapshot().getVariables(this.variable.variablesReference) || [];
                        for (const variable of variables) {
                            items.push(new VariableReference(variable, this));
                        }
                        this.chains.forEach(chain => {
                            const child = items.find(item => chain[0].variablesReference === item.variable.variablesReference);
                            if (child) {
                                if (chain.length > 1) {
                                    child.pushChain(chain.slice(1));
                                } else {
                                    child.iconPath = new vscode.ThemeIcon('tag', new vscode.ThemeColor('debugIcon.breakpointCurrentStackframeForeground'));
                                }
                            }
                        });
                        resolve(items);
                    } else {
                        const items: ReferenceDataItem[] = [];
                        items.push(new FoldReference(this.chains, this));
                        resolve(items);
                    }
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
    async revealReferences() {
        this.children?.then(children => {
            children.forEach(child => child.revealReferences());
        });
        if (this.iconPath) {
            vscode.commands.executeCommand('stackScopes.revealReferenceTreeItem', this.parent);
        }
    }
    getParent() : vscode.ProviderResult<ReferenceDataItem> {
        return this.parent;
    }
}
