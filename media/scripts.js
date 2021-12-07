class Frame {
    constructor(api, id, frame, module, func, obj) {
        this.api = api;
        this.id = id;
        this.frame = frame;
        this.module = module;
        this.func = func;
        this.obj = obj;
    }

    createFrameDomElement() {
        const line = document.createElement('tr');
        line.className = 'frame-line';
        line.setAttribute('frame', this.id);
        line.addEventListener('click', event => {
            if (event.ctrlKey || event.buttons === 2) {
                const elements = document.querySelectorAll('[tag=' + event.target.getAttribute('tag') + ']');
                if (event.target.style.backgroundColor === '') {
                    const color = '#' + Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0');
                    elements.forEach(element => {
                        element.style.backgroundColor = color;
                    });
                } else {
                    elements.forEach(element => {
                        element.style.backgroundColor = '';
                    });
                }
            } else {
                if (event.target.className !== 'resizer') {
                    this.api.postMessage({ command: 'select', frame: this.id });
                }
            }
        });

        const frameCell = document.createElement("td");
        frameCell.className = 'frame';
        frameCell.style.color = this.frame.value === 'top' ? 'goldenrod' : undefined;
        frameCell.setAttribute('title', this.frame.label);
        frameCell.setAttribute('tag', this.frame.tag);
        frameCell.id = 'frame-badge-' + this.id;
        frameCell.textContent = '\u1405';
        frameCell.addEventListener('click', event => {
            if (!event.ctrlKey && event.buttons === 0) {
                frameCell.textContent = frameCell.textContent === '\u1401' ? '\u1405' : '\u1401';
                const scope = document.getElementById('frame-scope-' + this.id);
                if (scope) {
                    if (frameCell.textContent === '\u1405') {
                        scope.style.display = 'none';
                    } else {
                        scope.style.display = 'table-cell';
                        if (scope.childElementCount === 0) {
                            this.api.postMessage({ command: 'get-frame-scope', frame: this.id });
                        } else {
                            document.dispatchEvent(new CustomEvent("populated", { detail: { scope: scope }}));
                        }
                    }
                } else {
                    throw new Error('element "frame-scope-' + this.id + '" not found');
                }
                event.stopPropagation();
            }
        });

        const moduleCell = document.createElement("td");
        moduleCell.className = 'module';
        moduleCell.setAttribute('title', this.module.label);
        moduleCell.setAttribute('tag', this.module.tag);
        moduleCell.textContent = this.module.value;

        const moduleResizer = document.createElement("td");
        moduleResizer.className = 'resizer';
        moduleResizer.setAttribute('tag', this.module.tag);

        const funcCell = document.createElement("td");
        funcCell.className = 'function';
        funcCell.setAttribute('title', this.func.label);
        funcCell.setAttribute('tag', this.func.tag);
        funcCell.textContent = this.func.value;

        const funcResizer = document.createElement("td");
        funcResizer.className = 'resizer';
        funcResizer.setAttribute('tag', this.func.tag);

        const objCell = document.createElement("td");
        objCell.className = 'object';
        objCell.setAttribute('title', this.obj.label);
        objCell.setAttribute('tag', this.obj.tag);
        objCell.textContent = this.obj.value;

        line.appendChild(frameCell);
        line.appendChild(moduleCell);
        line.appendChild(moduleResizer);
        line.appendChild(funcCell);
        line.appendChild(funcResizer);
        line.appendChild(objCell);

        let startX = 0;
        let startWidth = 0;
        let cell = null;

        const onMouseMove = event => {
            cell.style.width = (startWidth + event.clientX - startX) + 'px';
            event.stopPropagation();
        };

        const onMouseUp = event => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            event.stopPropagation();
        };

        moduleResizer.addEventListener('mousedown', event => {
            cell = moduleCell.parentElement.parentElement.firstChild.nextSibling.firstChild.nextSibling;
            startX = event.clientX;
            startWidth = parseInt(document.defaultView.getComputedStyle(cell).width, 10);
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            event.stopPropagation();
        });

        funcResizer.addEventListener('mousedown', event => {
            cell = funcCell.parentElement.parentElement.firstChild.nextSibling.firstChild.nextSibling.nextSibling.nextSibling;
            startX = event.clientX;
            startWidth = parseInt(document.defaultView.getComputedStyle(cell).width, 10);
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            event.stopPropagation();
        });

        return line;
    }

    createScopeDomElement() {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.id = 'frame-scope-' + this.id;
        cell.className = 'frame-scope';
        cell.setAttribute('colspan', 6);
        cell.userData = { frameId: this.id };

        row.appendChild(cell);

        return row;
    }
}

class Stack {
    constructor(api, thread, frames) {
        this.thread = thread;
        this.frames = frames.map(f => new Frame(api, f.id, f.frame, f.module, f.func, f.obj));
    }

    createDomElement() {
        const block = document.createElement('div');
        block.className = 'block';
        block.id = 'block-' + this.thread;

        const table = document.createElement("table");
        table.className = 'stack';
        table.setAttribute('border', '1');

        const caption = document.createElement("caption");
        caption.className = 'thread';

        const label = document.createElement("span");
        label.textContent = 'Thread #' + this.thread;
        label.setAttribute('thread', this.thread);
        label.className = 'thread-badge';
        label.addEventListener('click', event => {
            if (event.ctrlKey || event.buttons === 2) {
                if (table.style.borderColor !== 'var(--vscode-editorIndentGuide-background)' && table.style.borderColor !== '') {
                    table.style.borderColor = 'var(--vscode-editorIndentGuide-background)';
                } else {
                    table.style.borderColor = '#' + Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0');
                }
            }
        });

        caption.appendChild(label);
        table.appendChild(caption);

        this.frames.forEach(frame => {
            table.appendChild(frame.createFrameDomElement());
            table.appendChild(frame.createScopeDomElement());
        });
        block.appendChild(table);

        return block;
    }
}

class Context {
    constructor(api) {
        this.api = api;
        this.stacks = [];
        this.drawAll = true;

        const menu = document.getElementById("context-menu");
        menu.addEventListener('click', event => {
            menu.style.display = 'none';
            this.api.postMessage({
                command: 'search-references',
                frame: menu.userData.frameId,
                variable: menu.userData.variable
            });
        });

        document.addEventListener('click', event => {
            if(event.ctrlKey && !this.drawAll) {
                this.showColorized();
            }
            menu.style.display = 'none';
        });

        document.addEventListener('contextmenu', event => {
            if (event.target.className === 'var-line' || event.target.parentNode.className === 'var-line') {
                event.preventDefault();
                if (menu.style.display === 'block') {
                    menu.style.display = 'none';
                } else {
                    const { variable } = event.target.userData || event.target.parentNode.userData;
                    if (variable) {
                        let parent = event.target.parentNode;
                        while(parent && parent.className !== 'frame-scope') {
                            parent = parent.parentNode;
                        }
                        const { frameId } = parent?.userData;
                        if (frameId) {
                            menu.userData = { frameId, variable };
                            menu.style.left = event.pageX + "px";
                            menu.style.top = event.pageY + "px";
                            menu.style.display = 'block';
                        }
                    }
                }
            }
        });
    }

    populate(stacks) {
        this.clearAll();
        const container = document.getElementById('container');
        if (container) {
            stacks.forEach(item => {
                const stack = new Stack(this.api, item.thread, item.frames);
                this.stacks.push(stack);
                container.appendChild(stack.createDomElement());
            });
        } else {
            throw new Error('element "container" not found');
        }
    }

    showAll() {
        this.stacks.forEach(item => {
            const block = document.getElementById('block-' + item.thread);
            if (block) {
                const tagged = block.querySelectorAll('[tag]');
                const colorized = [...tagged].find(element => element.style.backgroundColor !== '');
                if (!colorized) {
                    block.style.display = 'inline-block';
                }
            } else {
                throw new Error('element "block-' + item.thread + '" not found');
            }
        });
        this.drawAll = true;
    }
    
    showColorized() {
        this.stacks.forEach(item => {
            const block = document.getElementById('block-' + item.thread);
            if (block) {
                if (block.firstChild.style.borderColor !== 'var(--vscode-editorIndentGuide-background)' && block.firstChild.style.borderColor !== '') {
                    block.style.display = 'inline-block';
                } else if (block.firstChild.firstChild.firstChild.style.color === 'var(--vscode-editorLink-activeForeground)') {
                    block.style.display = 'inline-block';
                } else {
                    const tagged = block.querySelectorAll('[tag]');
                    const colorized = [...tagged].find(element => element.style.backgroundColor !== '');
                    if (!colorized) {
                        block.style.display = 'none';
                    } else {
                        block.style.display = 'inline-block';
                    }
                }
            } else {
                throw new Error('element "block-' + item.thread + '" not found');
            }
        });

        this.drawAll = false;
    }
    
    clearAll() {
        const container = document.getElementById('container');
        if (container) {
            while (container.firstChild) { 
                container.removeChild(container.firstChild);
            }
        }
        this.stacks = [];
    }

    colorizeMatches(matches) {
        const color = 'var(--vscode-editorLink-activeForeground)';
        matches.forEach(match => {
            const thread = document.querySelector('[thread="' + match.thread + '"]');
            if (thread) {
                thread.style.color = color;
                match.frames.forEach(id => {
                    const frame = document.querySelector('[frame="' + id + '"]');
                    if (frame) {
                        frame.style.color = color;
                    }
                });
            }
        });

        if(!this.drawAll) {
            this.showColorized();
        }
    }

    clearMatches() {
        const threads = document.querySelectorAll('[thread]');
        threads.forEach(thread => {
            thread.style.color = '';
        });
        const frames = document.querySelectorAll('[frame]');
        frames.forEach(frame => {
            frame.style.color = '';
        });

        if(!this.drawAll) {
            this.showColorized();
        }
    }

    colorizeByTag(tag) {
        const elements = document.querySelectorAll('[tag=' + tag + ']');
        if (elements && elements[0].style.backgroundColor === '') {
            const color = '#' + Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0');
            elements.forEach(element => {
                element.style.backgroundColor = color;
            });

            if(!this.drawAll) {
                this.showColorized();
            }

            let scroll = undefined;
            elements.forEach(element => {
                const y = element.getBoundingClientRect().y;
                if (scroll === undefined) {
                    scroll = y;
                } else {
                    scroll = Math.min(scroll, y);
                }
            });

            if (scroll !== undefined && (scroll < 0 || scroll > window.innerHeight)) {
                window.scrollBy(0, scroll);
            }
        } else {
            elements.forEach(element => {
                element.style.backgroundColor = '';
            });

            if(!this.drawAll) {
                this.showColorized();
            }
        }
    }

    expandPath(reference) {
        if (reference.frame) {
            const badgeId = 'frame-badge-' + reference.frame.id;
            const badge = document.getElementById(badgeId);
            if (!badge) {
                throw new Error('element "' + badgeId + '" not found');
            }

            if (badge.textContent === '\u1405') {
                if (reference.chain || reference.variable) {
                    const scopeId = 'frame-scope-' + reference.frame.id;
                    const callback = event => {
                        if (event.detail.scope.id === scopeId) {
                            this.expandPath({ chain: reference.chain, variable: reference.variable });
                            document.removeEventListener('populated', callback);
                            clearTimeout(timeout);
                        }
                    };
                    document.addEventListener('populated', callback);
                    var timeout = setTimeout(() => {
                        document.removeEventListener('populated', callback);
                        console.log('expand timeout');
                    }, 2000);
                }
                return badge.click();
            }
        }

        if (reference.chain) {
            for(const variable of reference.chain) {
                if (variable.variablesReference !== 0) {
                    const badgeId = 'var-badge-' + variable.variablesReference;
                    const badge = document.getElementById(badgeId);
                    if (!badge) {
                        throw new Error('element "' + badgeId + '" not found');
                    }
                    if (badge.textContent === '+') {
                        const scopeId = 'var-scope-' + variable.variablesReference;
                        const callback = event => {
                            if (event.detail.scope.id === scopeId) {
                                this.expandPath({ chain: reference.chain.slice(1), variable: reference.variable });
                                document.removeEventListener('populated', callback);
                                clearTimeout(timeout);
                            }
                        };
                        document.addEventListener('populated', callback);
                        var timeout = setTimeout(() => {
                            document.removeEventListener('populated', callback);
                            console.log('expand timeout');
                        }, 2000);
                        return badge.click();
                    }
                }
            };
        }

        if (reference.variable && reference.variable.variablesReference !== 0) {
            const badgeId = 'var-badge-' + reference.variable.variablesReference;
            const badge = document.getElementById(badgeId);

            const y = badge.getBoundingClientRect().y;
            if (y < 0 || y > window.innerHeight) {
                window.scrollBy(0, y);
            }

            if (badge && badge.textContent === '+') {
                return badge.click();
            }     
        }
    }

    populateScope(data) {
        if (data.variables.length === 0) {
            return;
        }

        const id = (data.scope === 'frame' ? 'frame-scope-' : 'var-scope-') + data.id;
        const container = document.getElementById(id);
        if (!container) {
            throw new Error('element "' + id + '" not found');
        }

        if (container.childElementCount > 0) {
            return;
        }

        data.variables.forEach(item => {
            const variable = document.createElement('div');
            variable.className = 'var-line';
            variable.userData = { variable: item };

            const badge = document.createElement('div');
            badge.className = 'var-badge';
            badge.id = 'var-badge-' + item.variablesReference;
            badge.innerHTML = item.variablesReference ? '+' : '&ensp;';
    
            const name = document.createElement('span');
            name.setAttribute('title', item.type);
            name.className = 'var-name';
            name.textContent = item.name + ':';
    
            const value = document.createElement('span');
            value.setAttribute('title', item.value);
            value.className = 'var-value';
            value.textContent = item.value;
    
            variable.appendChild(badge);
            variable.appendChild(name);
            variable.appendChild(value);
            container.appendChild(variable);

            if (item.variablesReference) {
                const scope = document.createElement('div');
                scope.id = 'var-scope-' + item.variablesReference;
                scope.className = 'var-scope';
                scope.setAttribute('variable', item.variablesReference);

                container.appendChild(scope);

                badge.addEventListener('click', event => {
                    if (!event.ctrlKey) {
                        if (badge.textContent === '-') {
                            badge.textContent = '+';
                            scope.style.display = 'none';
                        } else {
                            badge.textContent = '-';
                            scope.style.display = 'block';
                        }
                        if (scope.childElementCount === 0) {
                            this.api.postMessage({ command: 'get-variable-scope', variable: item.variablesReference });
                        } else {
                            document.dispatchEvent(new CustomEvent("populated", { detail: { scope: scope }}));
                        }
                        event.stopPropagation();
                    }
                });
            }
        });

        document.dispatchEvent(new CustomEvent("populated", { detail: { scope: container }}));
    }
}

(function () {
    const api = acquireVsCodeApi();
    const context = new Context(api);

    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.command) {
            case 'populate': {
                console.log('populate context');
                context.populate(message.stacks);
                break;
            }
            case 'show-all': {
                console.log('show all frames');
                context.showAll();
                break;
            }
            case 'show-colorized': {
                console.log('show colorized frames');
                context.showColorized();
                break;
            }
            case 'colorize-by-tag': {
                console.log('colorize by tag');
                context.colorizeByTag(message.tag);
                break;
            }
            case 'colorize-matches': {
                console.log('colorize matches');
                context.colorizeMatches(message.matches);
                break;
            }
            case 'clear-matches': {
                console.log('clear matches');
                context.clearMatches();
                break;
            }
            case 'populate-scope': {
                console.log('populate scope');
                context.populateScope(message.scope);
                break;
            }
            case 'expand-path': {
                console.log('expand path');
                context.expandPath(message.reference);
                break;
            }
        }
    });
}());
