const NORMAL_BACKGROUND = 'var(--vscode-editor-background)';

class Frame {
    constructor(id, frame, module, func, obj) {
        this.id = id;
        this.frame = frame;
        this.module = module;
        this.func = func;
        this.obj = obj;
    }

    createFrameLineDomElement(api) {
        const line = document.createElement('tr');
        line.className = 'line';
        line.addEventListener('click', event => {
            if(!event.ctrlKey) {
                api.postMessage({ command: 'select', frame: this.id });
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
        frameCell.style.color = this.frame.value === '\u25B6' ? 'goldenrod' : undefined;
        frameCell.setAttribute('title', this.frame.label);
        frameCell.setAttribute('tag', this.frame.tag);

        const badge = document.createElement("div");
        badge.className = 'badge';
        badge.textContent = this.frame.value;
        frameCell.appendChild(badge);

        frameCell.addEventListener('click', event => {
            if (!event.ctrlKey) {
                const scope = document.getElementById('scope-' + this.id);
                if (scope) {
                    if (badge.style.transform === 'rotate(90deg)') {
                        badge.style.transform = 'rotate(0deg)';
                        scope.style.display = 'none';
                    } else {
                        badge.style.transform = 'rotate(90deg)';
                        scope.style.display = 'table-row';
                        if (scope.childElementCount === 0) {
                            api.postMessage({ command: 'get-scope', frame: this.id });
                        }
                    }
                    event.stopPropagation();
                } else {
                    throw new Error('element "scope-' + this.id + '" not found');
                }
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

    createScopeLineDomElement(api) {
        const line = document.createElement('tr');
        line.className = 'line';
        line.id = 'scope-' + this.id;
        line.style.display = 'none';
        line.addEventListener('click', event => {
            if(!event.ctrlKey) {
                api.postMessage({ command: 'select', frame: this.id });
            }
        });
        return line;
    }
}

class Stack {
    constructor(thread, frames) {
        this.thread = thread;
        this.frames = frames.map(f => new Frame(f.id, f.frame, f.module, f.func, f.obj));
    }

    createDomElement(api) {
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
            table.appendChild(frame.createFrameLineDomElement(api));
            table.appendChild(frame.createScopeLineDomElement(api));
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
                const stack = new Stack(item.thread, item.frames);
                this.stacks.push(stack);
                container.appendChild(stack.createDomElement(this.api));
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
        } else {
            elements.forEach(element => {
                element.style.backgroundColor = '';
            });
        }

        if(!this.drawAll) {
            this.showColorized();
        }
    }

    populateScope(scope) {
        const line = document.getElementById('scope-' + scope.id);
        if (!line) {
            throw new Error('element "scope-' + scope.id + '" not found');
        }

        if (line.childElementCount > 0 || scope.variables.length === 0) {
            return;
        }

        const cell = document.createElement('td');
        cell.setAttribute('colspan', 4);

        scope.variables.forEach(item => {
            const row = document.createElement('div');
            row.className = 'scope';

            const name = document.createElement("span");
            name.setAttribute('title', item.type);
            name.className = 'var-name';
            name.textContent = item.name + ':';

            const value = document.createElement("span");
            value.setAttribute('title', item.value);
            value.className = 'var-value';
            value.textContent = item.value;

            row.appendChild(name);
            row.appendChild(value);

            cell.appendChild(row);
        });
        
        line.appendChild(cell);
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
        }
    });
}());
