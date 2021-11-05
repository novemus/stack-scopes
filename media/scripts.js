const NORMAL_BACKGROUND = 'var(--vscode-editor-background)';

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
        line.className = 'line';
        line.addEventListener('click', event => {
            if(!event.ctrlKey) {
                this.api.postMessage({ command: 'select', frame: this.id });
            } else {
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
            }
        });

        const frameCell = document.createElement("td");
        frameCell.className = 'frame';
        frameCell.style.color = this.frame.value === '\u25BA' ? 'goldenrod' : undefined;
        frameCell.setAttribute('title', this.frame.label);
        frameCell.setAttribute('tag', this.frame.tag);
        frameCell.id = 'frame-badge-' + this.id;
        frameCell.textContent = this.frame.value;
        frameCell.addEventListener('click', event => {
            if (!event.ctrlKey) {
                if (frameCell.textContent === '\u25BC') {
                    frameCell.textContent = '\u25BA';
                } else if (frameCell.textContent === '\u25B9') {
                    frameCell.textContent = '\u25BF';
                } else if (frameCell.textContent === '\u25BA') {
                    frameCell.textContent = '\u25BC';
                } else {
                    frameCell.textContent = '\u25B9';
                }
                const scope = document.getElementById('frame-scope-' + this.id);
                if (scope) {
                    if (frameCell.textContent === '\u25BA' || frameCell.textContent === '\u25B9') {
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

        const funcCell = document.createElement("td");
        funcCell.className = 'function';
        funcCell.setAttribute('title', this.func.label);
        funcCell.setAttribute('tag', this.func.tag);
        funcCell.textContent = this.func.value;

        const objCell = document.createElement("td");
        objCell.className = 'object';
        objCell.setAttribute('title', this.obj.label);
        objCell.setAttribute('tag', this.obj.tag);
        objCell.textContent = this.obj.value;

        line.appendChild(frameCell);
        line.appendChild(moduleCell);
        line.appendChild(funcCell);
        line.appendChild(objCell);

        return line;
    }

    createScopeDomElement() {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.id = 'frame-scope-' + this.id;
        cell.setAttribute('colspan', 4);
        cell.style.display = 'none';

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
        caption.textContent = 'Thread #' + this.thread;
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

        document.addEventListener('click', event => {
            if(event.ctrlKey && !this.drawAll) {
                this.showColorized();
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
                const tagged = block.querySelectorAll('[tag]');
                const colorized = [...tagged].find(element => element.style.backgroundColor !== '');
                if (!colorized) {
                    block.style.display = 'none';
                } else {
                    block.style.display = 'inline-block';
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

            if (scroll) {
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
        const badgeId = 'frame-badge-' + reference.frame.id;
        const scopeId = 'frame-scope-' + reference.frame.id;
        const badge = document.getElementById(badgeId);
        if (!badge) {
            throw new Error('element "' + badgeId + '" not found');
        }

        if (badge.textContent === '\u25BA' || badge.textContent === '\u25B9') {
            if (reference.chain || reference.variable) {
                const callback = event => {
                    if (event.detail.scope.id === scopeId) {
                        this.expandPath(reference);
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

        const scope = document.getElementById(scopeId);
        if (reference.chain) {
            for(const variable of reference.chain) {
                const badge = scope.querySelector(`[evaluate-name="${variable.evaluateName}"]`);
                if (!badge) {
                    throw new Error('badge element "' + variable.evaluateName + '" not found');
                }
                if (badge.textContent === '+') {
                    const callback = event => {
                        if (event.detail.scope.getAttribute('evaluate-name') === variable.evaluateName) {
                            this.expandPath(reference);
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
            };
        }
        if (reference.variable) {
            const badge = scope.querySelector(`[evaluate-name="${reference.variable.evaluateName}"]`);
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
            variable.className = 'line';
    
            const badge = document.createElement('div');
            badge.className = 'var-badge';
            badge.setAttribute('evaluate-name', item.evaluateName);
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
                scope.setAttribute('evaluate-name', item.evaluateName);
                scope.style.display = 'none';
                scope.style.paddingLeft = '10px';
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
