import * as vscode from 'vscode';
import * as fs from 'fs';
import { ScopeDataItem, StackScopesDataProvider } from './stackScopesDataProvider';
import { ReferenceDataItem, ReferencesDataProvider } from './referencesDataProvider';
import { StackGraphController } from './stackGraphController';
import { DebugSessionInterceptor } from './debugSessionInterceptor';

export function activate(context: vscode.ExtensionContext) {
	
	console.log('activating "stack-scopes" extension');

    const sessionInterceptor = new DebugSessionInterceptor(context);
    const stackDataProvider = new StackScopesDataProvider(context);
    const refsDataProvider = new ReferencesDataProvider(context);
    const stackGraphController = new StackGraphController(context);

    const stackScopesTreeView = vscode.window.createTreeView('stackScopes', {
        treeDataProvider: stackDataProvider,
        showCollapseAll: true
      });

    const referencesTreeView = vscode.window.createTreeView('references', {
        treeDataProvider: refsDataProvider,
        showCollapseAll: true
    });

    sessionInterceptor.subscribeStackSnapshot(stackDataProvider);
    sessionInterceptor.subscribeStackSnapshot(refsDataProvider);
    sessionInterceptor.subscribeStackSnapshot(stackGraphController);

    if (stackScopesTreeView) {
        context.subscriptions.push(
            vscode.commands.registerCommand('stackScopes.revealSourceLine', (source: string, line: number) => {
            fs.stat(source, (error, stats) => {
                if (error?.code) {
                    return vscode.window.showWarningMessage(error.message);
                } else if(!stats.isFile()) {
                    return vscode.window.showWarningMessage('Wrong file ' + source);
                }
                var setting: vscode.Uri = vscode.Uri.file(source);
                vscode.workspace.openTextDocument(setting).then(document => {
                    vscode.window.showTextDocument(document, 1, false).then(editor => {
                        editor.selection = new vscode.Selection(
                            editor.selection.active.with(line + 1, 0),
                            editor.selection.active.with(line, 0)
                            );
                        editor.revealRange(
                            new vscode.Range(new vscode.Position(line, 0), new vscode.Position(line, 0)),
                            vscode.TextEditorRevealType.InCenter
                            );
                    });
                }, error => {
                    console.error(error);
                });
            });
        }));
        context.subscriptions.push(
            vscode.commands.registerCommand('stackScopes.revealScopeTreeItem', (item: ScopeDataItem) => {
            if (stackScopesTreeView.visible) {
                stackScopesTreeView.reveal(item, { expand: true, select: false  });
            }
        }));
        context.subscriptions.push(
            vscode.commands.registerCommand('stackScopes.revealReferenceTreeItem', (item: ReferenceDataItem) => {
                if (referencesTreeView.visible) {
                    referencesTreeView.reveal(item, { expand: true, select: false  });
                }
            })
        );
        context.subscriptions.push(
            vscode.commands.registerCommand('stackScopes.openStackGraph', () => {
                const session = vscode.debug.activeDebugSession;
                const snapshot = session ? sessionInterceptor.getSnapshot(session.id) : undefined;
                if (snapshot) {
                    vscode.window.withProgress({
                        location: vscode.ProgressLocation.Window,
                        title: 'Building Stack Graph...',
                        cancellable: false
                    }, () => {
                        return stackGraphController.openGraph(snapshot);
                    });
                }
            })
        );
        context.subscriptions.push(
            vscode.commands.registerCommand('stackScopes.openSessionStackGraph', (item?: ScopeDataItem) => {
            const snapshot = item?.getSnapshot();
            if (snapshot) {
                vscode.window.withProgress({
                    location: vscode.ProgressLocation.Window,
                    title: 'Building Stack Graph...',
                    cancellable: false
                }, () => {
                    return stackGraphController.openGraph(snapshot);
                });
            } else {
                vscode.commands.executeCommand('stackScopes.openStackGraph');
            }
        }));
        context.subscriptions.push(
            vscode.commands.registerCommand('stackScopes.colorizeByTag', (item: ReferenceDataItem | ScopeDataItem) => {
                const snapshot = item.getSnapshot();
                const tag = item.getTag();
                if (snapshot && tag) {
                    stackGraphController.colorizeByTag(snapshot, tag);
                }
            })
        );
        context.subscriptions.push(
            vscode.commands.registerCommand('stackScopes.drawOnlyColorizedStacks', () => {
                stackGraphController.drawOnlyColorizedStacksOnActiveGraph();
            })
        );
        context.subscriptions.push(
            vscode.commands.registerCommand('stackScopes.drawAllStacks', () => {
                stackGraphController.drawAllStacksOnActiveGraph();
            })
        );
        context.subscriptions.push(
            vscode.commands.registerCommand('stackScopes.revealFrameScopeTreeItem', (snapshot: string, frame: number, openSource: boolean) => {
                if (openSource || stackScopesTreeView.visible) {
                    const item = stackDataProvider.findFrameItem(snapshot, frame);
                    if (item) {
                        if (stackScopesTreeView.visible) {
                            stackScopesTreeView.reveal(item, { expand: true, select: true });
                        }
                        if (openSource) {
                            vscode.commands.executeCommand('stackScopes.revealSourceLine', item.frame.source.path, item.frame.line > 0 ? item.frame.line - 1 : 0);
                        }
                    }
                }
            })
        );
    }
}

export function deactivate() {}
