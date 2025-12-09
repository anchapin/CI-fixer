
import * as Diff from 'diff';

export const getStats = (original: string, modified: string) => {
    // Safe access to diffLines whether it's on default or root object
    const differ = (Diff as any).diffLines || (Diff as any).default?.diffLines;
    if (!differ) return { added: 0, removed: 0 };

    const diff = differ(original, modified);
    let added = 0, removed = 0;
    diff.forEach((part: Diff.Change) => {
        if (part.added) added += part.count || 0;
        if (part.removed) removed += part.count || 0;
    });
    return { added, removed };
};

export const getContextualDiff = (original: string, modified: string, contextLines: number = 3) => {
    // Safe access to diffLines whether it's on default or root object
    const differ = (Diff as any).diffLines || (Diff as any).default?.diffLines;
    const diff = differ ? differ(original, modified) : [];
    
    const result: { value: string, added?: boolean, removed?: boolean, isSpacer?: boolean, originalIndex: number }[] = [];

    diff.forEach((part: Diff.Change, index: number) => {
        const partWithIndex = { ...part, originalIndex: index };
        if (part.added || part.removed) {
            result.push(partWithIndex);
            return;
        }

        const lines = part.value.split('\n');
        // Remove trailing empty string from split if it exists, typical with split('\n') on text ending with \n
        if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

        if (lines.length <= contextLines * 2) {
             result.push(partWithIndex);
        } else {
             const head = lines.slice(0, contextLines).join('\n') + '\n';
             result.push({ ...partWithIndex, value: head });
             result.push({ value: `... ${lines.length - (contextLines * 2)} unchanged lines hidden ...\n`, isSpacer: true, originalIndex: -1 });
             const tail = lines.slice(-contextLines).join('\n') + (index === diff.length - 1 ? '' : '\n'); 
             result.push({ ...partWithIndex, value: tail });
        }
    });
    return { diffFull: diff, diffRender: result };
};
