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
    getParent(element: ReferenceDataItem) : vscode.ProviderResult<ReferenceDataItem> {
        if (element.contextValue === 'references') {
            return undefined;
        }
        return element.getParent();
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
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Window,
                title: 'Search references for "' + (scope.variable.name ? scope.variable.name : scope.variable.evaluateName) + '"',
                cancellable: true
            }, async (progress, token) => {

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
                const references = await snapshot.searchPointerReferences(parseInt(pointer), depth, {
                    stage: value => {
                        const percent = 100.0 - value / depth * 100;
                        progress.report({ increment: percent, message: percent + '%' });
                    }, broken: () => {
                        return token.isCancellationRequested;
                    }
                });

                const item = session.pushBunch(name, references);

                this._onDidChangeTreeData.fire();
                vscode.commands.executeCommand('setContext', 'stackScopes.showReferences', true);
                vscode.commands.executeCommand('stackScopes.revealReferenceTreeItem', item);
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
    abstract getChildren() : vscode.ProviderResult<ReferenceDataItem[]>;
    abstract getParent() : vscode.ProviderResult<ReferenceDataItem>;
    abstract getSnapshot() : StackSnapshot;
    abstract getTag() : string | undefined;
}

export class DebugSessionReference extends ScopeDataItem {
    public readonly bunches: Map<string, SearchReference> = new Map<string, SearchReference>();
    constructor(public readonly snapshot: StackSnapshot) {
        super(snapshot.name, vscode.TreeItemCollapsibleState.Expanded);
        this.contextValue = 'reference.session';
        this.id = snapshot.id;
        this.tooltip = snapshot.name;
        this.iconPath = new vscode.ThemeIcon('callstack-view-session', new vscode.ThemeColor('debugIcon.stopForeground'));
    }
    pushBunch(name: string, references: Reference[]) : SearchReference {
        const bunch = new SearchReference(name, references, this);
        this.bunches.set(name, bunch);
        return bunch;
    }
    getChildren() : vscode.ProviderResult<ReferenceDataItem[]> {
        const children = [];
        for (const child of this.bunches.values()) {
            children.push(child);
        }
        return Promise.resolve(children);
    }
    getParent() : vscode.ProviderResult<ReferenceDataItem> {
        return undefined;
    }
    getSnapshot() : StackSnapshot {
        return this.snapshot;
    }
    getTag() : string | undefined {
        return undefined;
    }
}

export class SearchReference extends ReferenceDataItem {
    private frames: Map<number, FrameReference> = new Map<number, FrameReference>();
    constructor(public readonly name: string, public readonly references: Reference[], public readonly parent: ReferenceDataItem) {
        super(name, vscode.TreeItemCollapsibleState.Expanded);
        this.contextValue = 'reference.references';
        this.tooltip = name;
        this.iconPath = new vscode.ThemeIcon('references', new vscode.ThemeColor('debugIcon.pauseForeground'));
        references.forEach(ref => {
            if (!this.frames.has(ref.frame.id)) {
                this.frames.set(ref.frame.id, new FrameReference(ref.thread, ref.frame, this));
            }
            const frame = this.frames.get(ref.frame.id) as FrameReference;
            frame.pushReference(ref.chain);
        });
    }
    getChildren() : vscode.ProviderResult<ReferenceDataItem[]> {
        const children = [];
        for (const child of this.frames.values()) {
            children.push(child);
        }
        return Promise.resolve(children);
    }
    getParent() : vscode.ProviderResult<ReferenceDataItem> {
        return this.parent;
    }
    getSnapshot() : StackSnapshot {
        return this.parent.getSnapshot();
    }
    getTag() : string | undefined {
        return undefined;
    }
}

export class FrameReference extends ReferenceDataItem {
    private chains: Map<string, PlaceReference> = new Map<string, PlaceReference>();
    constructor(public readonly thread: any, public readonly frame: any, public readonly parent: ReferenceDataItem) {
        super(frame.name, vscode.TreeItemCollapsibleState.Collapsed);
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
    pushReference(chain: any[]) {
        if (chain.length === 0) {
            return;
        }
        if (!this.chains.has(chain[0].name)) {
            this.chains.set(chain[0].name, new PlaceReference(chain[0], this));
        }
        const place = this.chains.get(chain[0].name) as PlaceReference;
        if (chain.length > 1) {
            place.pushReference(chain.slice(1));
            place.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        } else if (chain.length === 1) {
            place.iconPath = new vscode.ThemeIcon('tag', new vscode.ThemeColor('debugIcon.breakpointCurrentStackframeForeground'));
        }
    }
    getChildren() : vscode.ProviderResult<ReferenceDataItem[]> {
        const children = [];
        for (const child of this.chains.values()) {
            children.push(child);
        }
        return Promise.resolve(children);
    }
    getParent() : vscode.ProviderResult<ReferenceDataItem> {
        return this.parent;
    }
    getSnapshot() : StackSnapshot {
        return this.parent.getSnapshot();
    }
    getTag() : string | undefined {
        return utils.makeFrameTag(this.frame.id);
    }
}

export class PlaceReference extends ReferenceDataItem {
    private chains: Map<number, PlaceReference> = new Map<number, PlaceReference>();
    constructor(public readonly variable: any, public readonly parent: ReferenceDataItem) {
        super(variable.name + ':', vscode.TreeItemCollapsibleState.None);
        this.contextValue = variable.name === 'this' ? 'reference.this' : 'reference.place';
        this.description = variable.type;
        this.tooltip = variable.value;
    }
    pushReference(chain: any[]) {
        if (chain.length === 0) {
            return;
        }
        if (!this.chains.has(chain[0].variablesReference)) {
            this.chains.set(chain[0].variablesReference, new PlaceReference(chain[0], this));
        }
        const place = this.chains.get(chain[0].variablesReference) as PlaceReference;
        if (chain.length > 1) {
            place.pushReference(chain.slice(1));
            place.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        } else if (chain.length === 1) {
            place.iconPath = new vscode.ThemeIcon('tag', new vscode.ThemeColor('debugIcon.breakpointCurrentStackframeForeground'));
        }
    }
    getChildren() : vscode.ProviderResult<ReferenceDataItem[]> {
        const children = [];
        for (const child of this.chains.values()) {
            children.push(child);
        }
        return Promise.resolve(children);
    }
    getParent() : vscode.ProviderResult<ReferenceDataItem> {
        return this.parent;
    }
    getSnapshot() : StackSnapshot {
        return this.parent.getSnapshot();
    }
    getTag() : string | undefined {
        return this.variable.name === 'this' ? utils.makeObjectTag(this.variable.value) : undefined;
    }
}