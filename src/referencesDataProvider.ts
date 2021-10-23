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
        vscode.commands.registerCommand('stackScopes.searchReferences', (item?: ScopeDataItem) => {
            this.appendSearch(item);
        });
    }
    onSnapshotRemoved(snapshot: StackSnapshot) {
        this._sessions.delete(snapshot.id);
        this._onDidChangeTreeData.fire();

        let show = false;
        this._sessions.forEach(session => {
            if (session.bunches.size > 0) {
                show = true;
            }
        });
        vscode.commands.executeCommand('setContext', 'stackScopes.showReferences', show);
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
    async appendSearch(item?: ScopeDataItem) {
        const scope = item as VariableScope;
        const snapshot = scope.getSnapshot();
        const session = this._sessions.get(snapshot.id) as DebugSessionReference;
        if (session) {
            await session.makeBunch(scope.variable, scope.frame);
            this._onDidChangeTreeData.fire();
            vscode.commands.executeCommand('setContext', 'stackScopes.showReferences', true);
        }
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
    async makeBunch(variable: any, frame: any) {
        const evaluation = await this.snapshot.evaluateExpression(
            frame.id,
            variable.type && variable.type.match(/^.*\*\s*(const)?\s*$/) 
                ? '(size_t)' + variable.evaluateName + ',x'
                : '(size_t)&(' + variable.evaluateName + '),x'
            );
        const name = evaluation.result + ' depth=' + 3;
        const references = await this.snapshot.searchPointerReferences(Number(evaluation.result), new Reference(), 3);
        this.bunches.set(name, new SearchReference(name, references, this));
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
    private chains: Map<number, PlaceReference> = new Map<number, PlaceReference>();
    constructor(public readonly thread: any, public readonly frame: any, public readonly parent: ReferenceDataItem) {
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
        return utils.makeFrameTag(this.frame.id);
    }
}

export class PlaceReference extends ReferenceDataItem {
    private chains: Map<number, PlaceReference> = new Map<number, PlaceReference>();
    constructor(public readonly place: any, public readonly parent: ReferenceDataItem) {
        super(place.name + ':', vscode.TreeItemCollapsibleState.None);
        this.contextValue = place.name === 'this' ? 'reference.this' : 'reference.place';
        this.description = place.type;
        this.tooltip = place.value;
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
        return this.place.name === 'this' ? utils.makeObjectTag(this.place.value) : undefined;
    }
}