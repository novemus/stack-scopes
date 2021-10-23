import * as vscode from 'vscode';
import * as path from 'path';
import * as utils from './utils';
import { Reference } from './debugSessionInterceptor';

export class ReferencesDataProvider implements vscode.TreeDataProvider<ReferenceDataItem> {
    private _searches: Map<string, SearchReference> = new Map<string, SearchReference>();
    private _onDidChangeTreeData: vscode.EventEmitter<ReferenceDataItem | undefined | null | void> = new vscode.EventEmitter<ReferenceDataItem | undefined | null | void>(); 
    readonly onDidChangeTreeData: vscode.Event<ReferenceDataItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor() {
    }
    getTreeItem(element: ReferenceDataItem): vscode.TreeItem {
        return element;
    }
    getChildren(element?: ReferenceDataItem): vscode.ProviderResult<ReferenceDataItem[]> {
        if (element) {
            return element.getChildren();
        }
        return Promise.resolve([...this._searches.values()]);
    }
    getParent(element: ReferenceDataItem) : vscode.ProviderResult<ReferenceDataItem> {
        if (element.contextValue === 'search') {
            return undefined;
        }
        return element.getParent();
    }
    appendSearch(name: string, references: Reference[]) {
        this._searches.set(name, new SearchReference(name, references));
    }
    removeSearch(name: string) {
        this._searches.delete(name);
    }
}

export abstract class ReferenceDataItem extends vscode.TreeItem {
    abstract getChildren() : vscode.ProviderResult<ReferenceDataItem[]>;
    abstract getParent() : vscode.ProviderResult<ReferenceDataItem>;
}

export class SearchReference extends ReferenceDataItem {
    private frames: FrameReference[] = [];
    constructor(public readonly name: string, public readonly references: Reference[]) {
        super(name, vscode.TreeItemCollapsibleState.Expanded);
        this.contextValue = 'search';
        this.tooltip = name;
        this.iconPath = new vscode.ThemeIcon('search');
        this.frames = references.map(ref => new FrameReference(ref.thread, ref.frame, ref.chain, this));
    }
    getChildren() : vscode.ProviderResult<ReferenceDataItem[]> {
        return Promise.resolve([...this.frames]);
    }
    getParent() : vscode.ProviderResult<ReferenceDataItem> {
        return undefined;
    }
}

export class FrameReference extends ReferenceDataItem {
    private reference: PlaceReference | undefined;
    constructor(public readonly thread: any, public readonly frame: any, public readonly chain: any[], public readonly parent: ReferenceDataItem) {
        super(frame.name, vscode.TreeItemCollapsibleState.Expanded);
        this.contextValue = 'frame';
        this.description = 'Thread #' + thread.id;
        this.tooltip = frame.source && frame.source.path !== '' ? path.parse(frame.source.path).base + ':' + frame.line : 'Unknown Source';
        this.iconPath = new vscode.ThemeIcon('debug-stackframe-focused');
        this.reference = chain.length > 0 ? new PlaceReference(chain[0], chain.slice(1), this) : undefined;
    }
    getChildren() : vscode.ProviderResult<ReferenceDataItem[]> {
        return Promise.resolve(this.reference ? [this.reference] : []);
    }
    getParent() : vscode.ProviderResult<ReferenceDataItem> {
        return this.parent;
    }
    getTag() : string | undefined {
        return utils.makeFrameTag(this.frame.id);
    }
}

export class PlaceReference extends ReferenceDataItem {
    private reference: PlaceReference | undefined;
    constructor(public readonly place: any, public readonly chain: any[], public readonly parent: ReferenceDataItem) {
        super(place.name, vscode.TreeItemCollapsibleState.Expanded);
        this.contextValue = 'place';
        this.description = place.type;
        this.tooltip = place.value;
        if (chain.length > 0) {
            this.iconPath = new vscode.ThemeIcon('arrow-down');
        } else {
            this.iconPath = new vscode.ThemeIcon('check');
        }
        this.reference = chain.length > 0 ? new PlaceReference(chain[0], chain.slice(1), this) : undefined;
    }
    getChildren() : vscode.ProviderResult<ReferenceDataItem[]> {
        return Promise.resolve(this.reference ? [this.reference] : []);
    }
    getParent() : vscode.ProviderResult<ReferenceDataItem> {
        return this.parent;
    }
}