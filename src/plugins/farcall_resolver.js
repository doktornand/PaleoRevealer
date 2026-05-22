/**
 * Far Call Resolver - Resolution des far calls/jumps (CALLF, JMPF, RETF)
 * 
 * En mode 16-bit segmente, les far calls changent de segment (CS:IP).
 * En mode 32-bit FLAT, il faut simuler ce comportement.
 */

class FarCallResolver {
    constructor() {
        this.dispatchTables = new Map();
        this.segmentMappings = new Map();
    }

    analyzeCallGraph(functions, segments) {
        const farCalls = [];

        for (const func of functions) {
            const farCallOpcodes = this._detectFarCallOpcodes(func.code);

            for (const call of farCallOpcodes) {
                const targetSegment = call.segment;
                const targetOffset = call.offset;
                const sourceSegment = func.segment;
                const sameGroup = this._isSameSegmentGroup(sourceSegment, targetSegment, segments);

                farCalls.push({
                    source: { segment: sourceSegment, function: func.name },
                    target: { segment: targetSegment, offset: targetOffset },
                    type: sameGroup ? 'INTRA_GROUP' : 'INTER_GROUP',
                    strategy: sameGroup ? 'NEAR_CALL_WITH_CONTEXT' : 'DISPATCH_TABLE',
                    confidence: sameGroup ? 0.8 : 0.5
                });
            }
        }

        return farCalls;
    }

    generateReplacement(farCall, options = {}) {
        const { type, source, target } = farCall;

        if (type === 'INTRA_GROUP') {
            return this._generateIntraGroupReplacement(source, target);
        } else {
            return this._generateInterGroupReplacement(source, target, options);
        }
    }

    _generateIntraGroupReplacement(source, target) {
        return {
            strategy: 'NEAR_CALL_WITH_CONTEXT',
            code: [
                `; Far call remplace: ${source.segment}:${source.function} -> ${target.segment}:${target.offset.toString(16)}`,
                'pushad',
                `; Sauvegarde du contexte segment simule`,
                'mov eax, [current_CS]',
                'push eax',
                `mov eax, ${target.segment}h`,
                'mov [current_CS], eax',
                `call near ptr target_${target.segment}_${target.offset.toString(16)}`,
                'pop eax',
                'mov [current_CS], eax',
                'popad'
            ],
            data_section: [
                `current_CS DWORD ${source.segment}h`
            ],
            notes: 'Utilise une variable current_CS pour simuler le registre de segment'
        };
    }

    _generateInterGroupReplacement(source, target, options) {
        const dispatchId = `dispatch_${source.segment}_${target.segment}`;

        if (!this.dispatchTables.has(dispatchId)) {
            this.dispatchTables.set(dispatchId, new Map());
        }

        const table = this.dispatchTables.get(dispatchId);
        const entryId = table.size;
        table.set(entryId, target);

        return {
            strategy: 'DISPATCH_TABLE',
            code: [
                `; Far call via table de dispatch: ${source.segment} -> ${target.segment}`,
                'pushad',
                `mov eax, ${entryId}`,
                `call [${dispatchId} + eax * 4]`,
                'popad'
            ],
            data_section: [
                `${dispatchId} LABEL DWORD`,
                ...Array.from(table.values()).map((t, i) => 
                    `    DWORD OFFSET target_${t.segment}_${t.offset.toString(16)}`
                )
            ],
            notes: 'Table de dispatch pour appels inter-segments'
        };
    }

    _detectFarCallOpcodes(code) {
        const calls = [];
        for (let i = 0; i < code.length - 4; i++) {
            if (code[i] === 0x9A) {
                const offset = code.readUInt16LE(i + 1);
                const segment = code.readUInt16LE(i + 3);
                calls.push({ type: 'CALLF', segment, offset, instructionOffset: i });
            } else if (code[i] === 0xEA) {
                const offset = code.readUInt16LE(i + 1);
                const segment = code.readUInt16LE(i + 3);
                calls.push({ type: 'JMPF', segment, offset, instructionOffset: i });
            }
        }
        return calls;
    }

    _isSameSegmentGroup(seg1, seg2, segments) {
        return Math.abs(seg1 - seg2) < 0x1000;
    }

    generateGlobalDispatchTables() {
        const tables = [];

        for (const [id, table] of this.dispatchTables) {
            tables.push({
                id,
                entries: Array.from(table.entries()).map(([idx, target]) => ({
                    index: idx,
                    target: `${target.segment}:${target.offset.toString(16)}`
                }))
            });
        }

        return tables;
    }
}

module.exports = { FarCallResolver };
