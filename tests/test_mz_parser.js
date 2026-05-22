/**
 * Tests unitaires - MZ Parser
 */

const { MZParser } = require('../src/loader/mz_parser');
const fs = require('fs');

function createMinimalMZ() {
    const buf = Buffer.alloc(512);
    // Header MZ
    buf.write('MZ', 0);
    buf.writeUInt16LE(0x00, 2);   // e_cblp
    buf.writeUInt16LE(0x01, 4);   // e_cp (1 page = 512 bytes)
    buf.writeUInt16LE(0x00, 6);   // e_crlc
    buf.writeUInt16LE(0x04, 8);   // e_cparhdr (4 paragraphs = 64 bytes)
    buf.writeUInt16LE(0x00, 10);  // e_minalloc
    buf.writeUInt16LE(0xFFFF, 12); // e_maxalloc
    buf.writeUInt16LE(0x00, 14);  // e_ss
    buf.writeUInt16LE(0xB8, 16);  // e_sp
    buf.writeUInt16LE(0x00, 18);  // e_csum
    buf.writeUInt16LE(0x00, 20);  // e_ip
    buf.writeUInt16LE(0x00, 22);  // e_cs
    buf.writeUInt16LE(0x40, 24);  // e_lfarlc
    buf.writeUInt16LE(0x00, 26);  // e_ovno

    // Code: NOP + RET
    buf[64] = 0x90; // NOP
    buf[65] = 0xC3; // RET

    return buf;
}

function createMZWithRelocations() {
    const buf = Buffer.alloc(512);
    buf.write('MZ', 0);
    buf.writeUInt16LE(0x00, 2);
    buf.writeUInt16LE(0x01, 4);
    buf.writeUInt16LE(0x02, 6);   // 2 relocations
    buf.writeUInt16LE(0x08, 8);   // 8 paragraphs = 128 bytes header
    buf.writeUInt16LE(0x00, 10);
    buf.writeUInt16LE(0xFFFF, 12);
    buf.writeUInt16LE(0x00, 14);
    buf.writeUInt16LE(0xB8, 16);
    buf.writeUInt16LE(0x00, 18);
    buf.writeUInt16LE(0x00, 20);
    buf.writeUInt16LE(0x00, 22);
    buf.writeUInt16LE(0x40, 24);  // Relocation table at offset 64
    buf.writeUInt16LE(0x00, 26);

    // Relocation table (2 entries)
    buf.writeUInt16LE(0x10, 64);  // offset
    buf.writeUInt16LE(0x00, 66);  // segment
    buf.writeUInt16LE(0x20, 68);  // offset
    buf.writeUInt16LE(0x01, 70);  // segment

    // Code starts at 128
    buf[128] = 0x90;
    buf[129] = 0xC3;

    return buf;
}

function runTests() {
    console.log('=== Tests MZ Parser ===\n');

    // Test 1: Parse minimal MZ
    console.log('Test 1: Parse MZ minimal');
    try {
        const parser = new MZParser();
        const result = parser.parse(createMinimalMZ());

        console.assert(result.header.magic === 'MZ', 'Magic MZ attendu');
        console.assert(result.header.pagesInFile === 1, '1 page attendue');
        console.assert(result.header.headerParagraphs === 4, '4 paragraphs attendus');
        console.assert(result.relocationTable.length === 0, '0 relocation attendue');
        console.assert(result.programImage.length === 448, 'Image de 448 bytes attendue');
        console.log('✓ Test 1 passé\n');
    } catch (e) {
        console.error('✗ Test 1 échoué:', e.message);
    }

    // Test 2: Parse MZ avec relocations
    console.log('Test 2: Parse MZ avec relocations');
    try {
        const parser = new MZParser();
        const result = parser.parse(createMZWithRelocations());

        console.assert(result.relocationTable.length === 2, '2 relocations attendues');
        console.assert(result.relocationTable[0].offset === 0x10, 'Offset 0x10 attendu');
        console.assert(result.relocationTable[0].segment === 0x00, 'Segment 0x00 attendu');
        console.assert(result.relocationTable[1].segment === 0x01, 'Segment 0x01 attendu');
        console.log('✓ Test 2 passé\n');
    } catch (e) {
        console.error('✗ Test 2 échoué:', e.message);
    }

    // Test 3: Rapport de migration
    console.log('Test 3: Rapport de migration');
    try {
        const parser = new MZParser();
        parser.parse(createMinimalMZ());
        const report = parser.generateMigrationReport();

        console.assert(report.fileType === 'MS-DOS MZ Executable', 'Type MZ attendu');
        console.assert(report.complexity.level === 'LOW', 'Complexité LOW attendue');
        console.assert(report.conversionDifficulty.autoConvertible === true, 'Auto-convertible attendu');
        console.log('✓ Test 3 passé\n');
    } catch (e) {
        console.error('✗ Test 3 échoué:', e.message);
    }

    // Test 4: Export corpus
    console.log('Test 4: Export pour analyse corpus');
    try {
        const parser = new MZParser();
        parser.parse(createMinimalMZ());
        const corpus = parser.exportForCorpusAnalysis();

        console.assert(corpus.format === 'MZ', 'Format MZ attendu');
        console.assert(typeof corpus.instructionDistribution === 'object', 'Distribution attendue');
        console.log('✓ Test 4 passé\n');
    } catch (e) {
        console.error('✗ Test 4 échoué:', e.message);
    }

    console.log('=== Tests terminés ===');
}

runTests();
