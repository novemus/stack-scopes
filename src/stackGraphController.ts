import * as vscode from 'vscode';
import * as utils from './utils';
import { StackSnapshotReviewer, StackSnapshot, Reference, VariableInfo } from './debugSessionInterceptor';

class Section {
    public label: string | undefined = '';
    public value: string | undefined = '';
    public tag: string | undefined = '';
};

class Frame {
    public id: number = 0;
    public frame: Section = new Section();
    public module: Section = new Section();
    public func: Section = new Section();
    public obj: Section = new Section();
};

class Stack {
    public thread: number = 0;
    public frames: Frame[] = [];
    constructor(thread: number) {
        this.thread = thread;
    }
}

class DrawMode {
    public drawOnlyColorized: boolean = false;
    public colorizeMatches: boolean = false;
}

export class StackGraphController implements StackSnapshotReviewer {
    private graphs: Map<string, vscode.WebviewPanel> = new Map<string, vscode.WebviewPanel>();
    private modes: Map<vscode.WebviewPanel, DrawMode> = new Map<vscode.WebviewPanel, DrawMode>();
    
    constructor(private readonly context: vscode.ExtensionContext) {
    }

    async onSnapshotRemoved(snapshot: StackSnapshot) {
        const panel = this.graphs.get(snapshot.id);
        if (panel) {
            panel.dispose();
        }
    }

    async onSnapshotCreated(snapshot: StackSnapshot) {
        const panel = this.graphs.get(snapshot.id);
        if (panel) {
            panel.webview.postMessage({ command: 'populate', stacks: await this.buildStacks(snapshot) });
        }
    }

    async colorizeByTag(snapshot: StackSnapshot, tag: string) {
        if (!this.graphs.has(snapshot.id)) {
            await this.openGraph(snapshot);
        }
        const panel = this.graphs.get(snapshot.id);
        if (panel) {
            panel.reveal();
            panel.webview.postMessage({ command: 'colorize-by-tag', tag: tag });
        }
    }

    async revealReference(snapshot: StackSnapshot, reference: Reference) {
        if (!this.graphs.has(snapshot.id)) {
            await this.openGraph(snapshot);
        }
        const panel = this.graphs.get(snapshot.id);
        if (panel) {
            panel.reveal();
            panel.webview.postMessage({ command: 'expand-path', reference: reference });
        }
    }

    async colorizeMatchesForActiveGraph(snapshots: StackSnapshot[]) {
        this.graphs.forEach(async (panel, id) => {
            if (panel.active) {
                const active = snapshots.find(s => s.id === id);
                if (active) {
                    const select = await vscode.window.showQuickPick(
                        snapshots
                            .filter(s => s.id !== active.id && s.procId === active.procId && s.procName === active.procName)
                            .map(s => { return { label: s.name, snapshot: s }; }), {
                        title: 'Compare With...'
                    });
                    const target = select?.snapshot;

                    if (target !== undefined) {
                        const matches = [] as object[];
                        const threads = await active.threads() || [];
                        for (const thread of threads) {
                            const frames = await active.frames(thread.id);
                            const samples = await target.frames(thread.id);
                            if (frames !== undefined && samples !== undefined) {
                                const match = {
                                    thread: thread.id,
                                    frames: [] as number[]
                                };
                                for (let i = 1; i <= frames.length && i <= samples.length; ++i) {
                                    if (samples[samples.length - i].instructionPointerReference === frames[frames.length - i].instructionPointerReference) {
                                        const frameObj = await active.getFrameVariable(frames[frames.length - i].id, 'this');
                                        const sampleObj = await target.getFrameVariable(samples[samples.length - i].id, 'this');
                                        if (frameObj && sampleObj && frameObj.memoryReference === sampleObj.memoryReference) {
                                            match.frames.push(frames[frames.length - i].id);
                                        } else if (frameObj === undefined && sampleObj === undefined) {
                                            match.frames.push(frames[frames.length - i].id);
                                        } else {
                                            break;
                                        }
                                    } else {
                                        break;
                                    }
                                }
                                matches.push(match);
                            }
                        };
                        panel.webview.postMessage({ command: 'colorize-matches', matches });
                        let mode = this.modes.get(panel) || new DrawMode();
                        mode.colorizeMatches = true;
                        this.modes.set(panel, mode);
                        vscode.commands.executeCommand('setContext', 'stackScopes.colorizeMatches', mode.colorizeMatches);
                    }
                }
            }
        });
    }

    async clearMatchesForActiveGraph() {
        this.graphs.forEach(panel => {
            if (panel.active) {
                panel.webview.postMessage({ command: 'clear-matches' });
                let mode = this.modes.get(panel) || new DrawMode();
                mode.colorizeMatches = false;
                this.modes.set(panel, mode);
                vscode.commands.executeCommand('setContext', 'stackScopes.colorizeMatches', mode.colorizeMatches);
            }
        });
    }

    async drawAllStacksOnActiveGraph() {
        this.graphs.forEach(panel => {
            if (panel.active) {
                let mode = this.modes.get(panel) || new DrawMode();
                mode.drawOnlyColorized = false;
                this.modes.set(panel, mode);
                panel.webview.postMessage({ command: 'show-all' });
                vscode.commands.executeCommand('setContext', 'stackScopes.drawOnlyColorized', mode.drawOnlyColorized);
            }
        });
    }

    async drawOnlyColorizedStacksOnActiveGraph() {
        this.graphs.forEach(panel => {
            if (panel.active) {
                let mode = this.modes.get(panel) || new DrawMode();
                mode.drawOnlyColorized = true;
                panel.webview.postMessage({ command: 'show-colorized' });
                vscode.commands.executeCommand('setContext', 'stackScopes.drawOnlyColorized', mode.drawOnlyColorized);
            }
        });
    }

    async openGraph(snapshot: StackSnapshot) {
        if (this.graphs.has(snapshot.id)) {
            return this.graphs.get(snapshot.id)?.reveal();
        }

        const panel = vscode.window.createWebviewPanel(
            'stackGraph',
            snapshot.name,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                enableFindWidget: true
            }
        );

        this.graphs.set(snapshot.id, panel);
        this.modes.set(panel, new DrawMode());

        panel.onDidDispose(() => {
            this.graphs.delete(snapshot.id);
            this.modes.delete(panel);
            this.updateContext();
        });

        panel.onDidChangeViewState(() => {
            this.updateContext();
        });

        panel.webview.html = this.getHtmlSkeleton(panel);
        panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'select':
                        {
                            vscode.commands.executeCommand(
                                'stackScopes.revealFrameScopeTreeItem', snapshot.id, parseInt(message.frame), panel.viewColumn !== vscode.ViewColumn.One
                            );
                            break;
                        }
                    case 'get-frame-scope':
                        {
                            panel.webview.postMessage({
                                command: 'populate-scope',
                                scope: {
                                    id: message.frame,
                                    scope: 'frame',
                                    variables: await snapshot.getFrameVariables(message.frame)
                                }
                            });
                            break;
                        }
                    case 'get-variable-scope':
                        {
                            panel.webview.postMessage({
                                command: 'populate-scope',
                                scope: {
                                    id: message.variable,
                                    scope: 'variable',
                                    variables: await snapshot.getVariables(message.variable)
                                }
                            });
                            break;
                        }
                    case 'search-references':
                        {
                            const info: VariableInfo = {
                                getSnapshot() : StackSnapshot {
                                    return snapshot;
                                },
                                getFrameId() : number {
                                    return message.frame;
                                },
                                getVariable() : any {
                                    return message.variable;
                                }
                            };
                            vscode.commands.executeCommand('stackScopes.searchReferences', info);
                            break;
                        }
                }
            }
        );

        this.updateContext();

        panel.webview.postMessage({ command: 'populate', stacks: await this.buildStacks(snapshot) });
    }

    private async buildStacks(snapshot: StackSnapshot): Promise<Stack[]> {
        const stacks: Stack[] = [];
        const threads = await snapshot.threads() || [];

        for (const thread of threads) {
            const stack = new Stack(thread.id);
            const frames = await snapshot.frames(thread.id) || [];

            for (const frame of frames) {
                const frm = new Frame();
                frm.id = frame.id;

                frm.frame.value = snapshot.topThread === thread.id && frames[0] === frame ? 'top' : 'low';
                frm.frame.label = '#' + frame.id;
                frm.frame.tag = utils.makeFrameTag(frame.id);

                frm.module.value = frame.name.substring(0, Math.min(frame.name.indexOf('!'), frame.name.length));
                frm.module.label = frm.module.value;
                frm.module.tag = utils.makeModuleTag(frame.moduleId);

                frm.func.value = frame.name.substring(Math.max(frame.name.indexOf('!') + 1, 0));
                frm.func.label = frm.func.value;
                frm.func.tag = utils.makeFunctionTag(frm.func.value, frame.source?.path);

                const variabe = frame.name.match(/.+::.+/) ? await snapshot.getFrameVariable(frame.id, 'this') : undefined;
                if (variabe?.memoryReference) {
                    frm.obj.value = '{...}';
                    frm.obj.label = "this: " + variabe.memoryReference;
                    frm.obj.tag = utils.makeObjectTag(variabe.memoryReference);
                } else {
                    frm.obj.value = '...';
                    frm.obj.tag = utils.makeVoidTag(frame.id);
                }

                stack.frames.push(frm);
            }
            stacks.push(stack);
        }
        return stacks;
    }

    private updateContext() {
        if (this.graphs.size === 0) {
            vscode.commands.executeCommand('setContext', 'stackScopes.drawOnlyColorized', undefined);
            vscode.commands.executeCommand('setContext', 'stackScopes.colorizeMatches', undefined);
            vscode.commands.executeCommand('setContext', 'stackScopes.stackGraph', undefined);
        } else {
            let active = false;
            this.graphs.forEach(panel => {
                if (panel.active) {
                    vscode.commands.executeCommand('setContext', 'stackScopes.drawOnlyColorized', this.modes.get(panel)?.drawOnlyColorized);
                    vscode.commands.executeCommand('setContext', 'stackScopes.colorizeMatches', this.modes.get(panel)?.colorizeMatches);
                }
                active = active || panel.active;
            });
            vscode.commands.executeCommand('setContext', 'stackScopes.stackGraph', active);
        }
    }

    private getHtmlSkeleton(panel: vscode.WebviewPanel): string {
        const scripstUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'scripts.js'));
        const stylesUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'styles.css'));
        const nonce = getNonce();

        return `<!DOCTYPE html>
            <html>
                <head>
                    <meta charset="UTF-8">
                    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${panel.webview.cspSource}; script-src 'nonce-${nonce}';">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <link href="${stylesUri}" rel="stylesheet">
                </head>
                <body>
                    <div id="container" class="container"></div>
                    <div id="context-menu" class="context-menu">Search for References</div>
                    <script nonce="${nonce}" src="${scripstUri}"></script>
                </body>
            </html>`;
    }
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}