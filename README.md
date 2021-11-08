# README

The `stack-scopes` is extension for [Visual Studio Code](https://code.visualstudio.com). It provides additional `Scopes` view on the Debug side bar for `cppdbg` and `cppvsdbg` debug profiles and offers `Stack Graph` window for convenient analysis of application stacks.

## Сapabilities

* [Build](#scopes-view) scopes tree view.
* [Highlight](#stack-graph) shared scopes on the stack graph.
* [Inspect](#unfold-frame-context) any number of frame contexts.
* [Reveal](#reveal-reference-code) reference source code.
* [Evaluate](#evaluate-dynamic-arrays-elements) elements of dynamically allocated arrays.
* [Search](#search-for-references-to-variables) for references to variables.

## Scopes view ##

The `Scopes` view represents stack frames grouped by locations of their scopes. This allows you to quickly find stack frames of interesting code, especially for snapshots with a large number of threads, check for mutual access to a specific context, find recursive calls, watch several frame scopes at the same time.

![Scopes](https://raw.githubusercontent.com/novemus/stack-scopes/master/resources/scopes.gif)

## Stack Graph ##

The main purpose of the `Stack Graph` window is to provide a possibility to analyze stacks for mutual use of modules, functions and even objects. For this you can apply color highlighting to elements you are interested in. Just press the `ctrl` key or the right mouse button and click the desired item on the stack graph. Also you can click appropriate icon on an item of the `Scopes` or `References` tree view. Click again to cancel the highlighting of the element.

![Graph](https://raw.githubusercontent.com/novemus/stack-scopes/master/resources/graph.gif)

## Unfold frame context ##

You can unfold the context of any frame on the scope tree or right on the graph. Click on the frame badge to expand or collapse the context widget.

![Unfold](https://raw.githubusercontent.com/novemus/stack-scopes/master/resources/unfold.gif)

## Reveal reference code ##

Both the `Scopes` view and the `Stack Graph` window support revealing reference code in the source files when clicking on frame items. To achieve this on the `Stack Graph`, you need to split the editor space and move the graph window to a secondary cell.

![Reveal](https://raw.githubusercontent.com/novemus/stack-scopes/master/resources/reveal.gif)

## Evaluate dynamic arrays elements ##

By default, you see only first element of the dynamically allocated arrays in the scope tree, because the debugger does not know the size of the array. You can evaluate following possible elements of the array variable under its tree item.

![Evaluate](https://raw.githubusercontent.com/novemus/stack-scopes/master/resources/evaluate.gif)

## Search for references to variables ##

You can search for references to any variable in the frame scopes, as well as inside other variables accessible from stack frames. The search results depend on the quality of the debugging information and also on how the variables are [represented](https://code.visualstudio.com/docs/cpp/natvis) by the debugging adapter. Also, the search is not performed in manually [evaluated](#evaluate-dynamic-arrays-elements) variables.

![Search](https://raw.githubusercontent.com/novemus/stack-scopes/master/resources/search.gif)

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

## Bugs and improvements

Feel free to [report](https://github.com/novemus/stack-scopes/issues) bugs and [suggest](https://github.com/novemus/stack-scopes/issues) new features and improvements. 

## License

MIT © Novemus Band
