function hash(value: string | undefined): string {
    let hash: number = 0;
 
    if (!value || value.length === 0) {
        return hash.toString();
    } 
    for (let i = 0; i < value.length; i++) {
        let char = value.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash.toString();
}

function toHexString(value: string): string {
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
    return 'module-' + toHexString(moduleId?.toString());
}

export function makeFrameTag(frameId: any): string {
    return 'frame-' + toHexString(frameId?.toString());
}

export function makeFunctionTag(name?: string, path?: string): string {
    return 'func-' + toHexString(hash(name)) + toHexString(hash(path));
}

export function makeObjectTag(value: any): string {
    return 'obj-' + toHexString(value?.toString());
}

export function makeVoidTag(value: any): string {
    return 'void-' + toHexString(value?.toString());
}
