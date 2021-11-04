function hash(value: string | undefined): number {
    let hash: number = 0;
 
    if (!value || value.length === 0) {
        return hash;
    } 
    for (let i = 0; i < value.length; i++) {
        let char = value.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash;
}

function toRawHexView(value: string | undefined): string {
    if (!value) {
        return '';
    }
    let result: string = '';
 
    for (let i = 0; i < value.length; i++) {
        result += value.charCodeAt(i).toString(16);
    }
    return result;
}

export function makeModuleTag(moduleId: any): string {
    return 'module-' + toRawHexView(moduleId?.toString());
}

export function makeFrameTag(frameId: any): string {
    return 'frame-' + toRawHexView(frameId?.toString());
}

export function makeFunctionTag(name?: string, path?: string): string {
    return 'func-' + toRawHexView(hash(name).toString()) + toRawHexView(hash(path).toString());
}

export function makeObjectTag(value: any): string {
    return 'obj-' + toRawHexView(value?.toString());
}

export function makeVoidTag(value: any): string {
    return 'void-' + toRawHexView(value?.toString());
}
