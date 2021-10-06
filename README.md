# README

The `stack-scopes` is extension for [Visual Studio Code](https://code.visualstudio.com). It provides additional `Scopes` view on the Debug side bar for `cppdbg` and `cppvsdbg` debug profiles and offers `Stack Graph` window for convenient analysis of application stacks.

## Usage

The `Scopes` view represents stack frames grouped by locations of their scopes. This allows you to quickly find stack frames of interesting code, especially for snapshots with a large number of threads, check for mutual access to a specific context, find recursive calls, watch several frame scopes at the same time.

![Scopes](https://raw.githubusercontent.com/novemus/stack-scopes/master/resources/scopes.gif)

The main purpose of the `Stack Graph` window is to provide a possibility to analyze stacks for mutual use of modules, functions and even objects. For this you can apply color highlighting to elements you are interested in. Just click desired element in the graph with the `ctrl` key pressed or click appropriate icon on an item of the `Scopes` tree view. Click again to cancel the highlighting of the element.

![Graph](https://raw.githubusercontent.com/novemus/stack-scopes/master/resources/graph.gif)

Both the `Scopes` view and the `Stack Graph` window support revealing reference code in the source files when clicking on frame items. To achieve this on the `Stack Graph`, you need to split the editor space and move the graph window to a secondary cell.

![Reveal](https://raw.githubusercontent.com/novemus/stack-scopes/master/resources/reveal.gif)

## Requirements

Depends on `ms-vscode.cpptools` extension.

## Installation

To install latest version of the extension from source, in addition to [Visual Studio Code](https://code.visualstudio.com), [Git](https://git-scm.com) and [Node](https://nodejs.org) must be installed on your system.

1. Clone `stack-scopes` repository.
```console
git clone https://github.com/novemus/stack-scopes.git && cd stack-scopes
```
2. Install `vsce` package.
```console
npm install -g vsce
```
3. Build `vsix` package.
```console
npm install && vsce package -o stack-scopes.vsix
```
4. Install `stack-scopes` vsix package.
```console
code --install-extension stack-scopes.vsix
```

## License

MIT © Novemus Band

## Release Notes

* v1.0.0

First release of the `stack-scopes` extension.
