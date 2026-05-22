/**
 * PE Builder - Générateur de fichiers PE Win32 (Portable Executable)
 * 
 * Construit un squelette PE valide pour les programmes convertis depuis DOS
 * Supporte les sous-systèmes CONSOLE et WINDOWS
 */

class PEBuilder {
    constructor(options = {}) {
        this.subsystem = options.subsystem || 'CONSOLE'; // CONSOLE | WINDOWS
        this.machine = options.machine || 0x14C; // i386
        this.imageBase = options.imageBase || 0x00400000;
        this.sectionAlignment = 0x1000;
        this.fileAlignment = 0x200;
        this.entryPoint = options.entryPoint || 0x1000;
        this.sections = [];
        this.imports = [];
        this.relocations = [];
    }

    /**
     * Ajoute une section au PE
     */
    addSection(name, characteristics, data) {
        const nameBytes = Buffer.alloc(8);
        nameBytes.write(name, 0, 8, 'ascii');

        const virtualSize = this._align(data.length, this.sectionAlignment);
        const rawSize = this._align(data.length, this.fileAlignment);

        const section = {
            name: nameBytes,
            virtualSize: virtualSize,
            virtualAddress: this._getNextVirtualAddress(),
            rawSize: rawSize,
            rawOffset: this._getNextRawOffset(),
            relocations: 0,
            lineNumbers: 0,
            relocationsOffset: 0,
            lineNumbersOffset: 0,
            characteristics: characteristics,
            data: this._padData(data, rawSize)
        };

        this.sections.push(section);
        return section;
    }

    /**
     * Ajoute une importation DLL
     */
    addImport(dllName, functions) {
        this.imports.push({ dll: dllName, functions });
    }

    /**
     * Ajoute une relocation
     */
    addRelocation(rva, type = 3) { // IMAGE_REL_BASED_HIGHLOW
        this.relocations.push({ rva, type });
    }

    /**
     * Construit le fichier PE complet
     */
    build() {
        const dosHeader = this._buildDOSHeader();
        const dosStub = this._buildDOSStub();
        const peSignature = Buffer.from('PE\x00\x00', 'ascii');
        const coffHeader = this._buildCOFFHeader();
        const optionalHeader = this._buildOptionalHeader();
        const sectionHeaders = this._buildSectionHeaders();
        const importDirectory = this._buildImportDirectory();

        // Assemblage final
        let pe = Buffer.concat([
            dosHeader,
            dosStub,
            peSignature,
            coffHeader,
            optionalHeader,
            ...sectionHeaders,
            ...this.sections.map(s => s.data)
        ]);

        // Patch des offsets dans le header DOS
        pe.writeUInt32LE(dosHeader.length + dosStub.length, 0x3C); // e_lfanew

        return pe;
    }

    _buildDOSHeader() {
        const header = Buffer.alloc(64);
        header.write('MZ', 0, 2, 'ascii'); // e_magic
        header.writeUInt16LE(0x90, 2); // e_cblp
        header.writeUInt16LE(3, 4); // e_cp
        header.writeUInt16LE(0, 6); // e_crlc
        header.writeUInt16LE(4, 8); // e_cparhdr (64 bytes = 4 paragraphs)
        header.writeUInt16LE(0, 10); // e_minalloc
        header.writeUInt16LE(0xFFFF, 12); // e_maxalloc
        header.writeUInt16LE(0, 14); // e_ss
        header.writeUInt16LE(0xB8, 16); // e_sp
        header.writeUInt16LE(0, 18); // e_csum
        header.writeUInt16LE(0, 20); // e_ip
        header.writeUInt16LE(0, 22); // e_cs
        header.writeUInt16LE(0x40, 24); // e_lfarlc
        header.writeUInt16LE(0, 26); // e_ovno
        // e_lfanew à l'offset 0x3C (60)
        header.writeUInt32LE(0, 60); // Sera patché après
        return header;
    }

    _buildDOSStub() {
        // Programme DOS minimal: "This program cannot be run in DOS mode."
        return Buffer.from([
            0x0E, 0x1F, 0xBA, 0x0E, 0x00, 0xB4, 0x09, 0xCD,
            0x21, 0xB8, 0x01, 0x4C, 0xCD, 0x21,
            ...Buffer.from('This program cannot be run in DOS mode.\r\n\x00')
        ]);
    }

    _buildCOFFHeader() {
        const header = Buffer.alloc(20);
        header.writeUInt16LE(this.machine, 0); // Machine (i386)
        header.writeUInt16LE(this.sections.length, 2); // NumberOfSections
        header.writeUInt32LE(Math.floor(Date.now() / 1000), 4); // TimeDateStamp
        header.writeUInt32LE(0, 8); // PointerToSymbolTable
        header.writeUInt32LE(0, 12); // NumberOfSymbols
        header.writeUInt16LE(0xE0, 16); // SizeOfOptionalHeader (PE32)
        header.writeUInt16LE(0x102, 18); // Characteristics (EXECUTABLE_IMAGE | 32BIT_MACHINE)
        return header;
    }

    _buildOptionalHeader() {
        const header = Buffer.alloc(224); // Standard PE32 optional header

        // Magic
        header.writeUInt16LE(0x10B, 0); // PE32
        header.writeUInt8(0, 2); // MajorLinkerVersion
        header.writeUInt8(0, 3); // MinorLinkerVersion
        header.writeUInt32LE(0, 4); // SizeOfCode
        header.writeUInt32LE(0, 8); // SizeOfInitializedData
        header.writeUInt32LE(0, 12); // SizeOfUninitializedData
        header.writeUInt32LE(this.entryPoint, 16); // AddressOfEntryPoint
        header.writeUInt32LE(0x1000, 20); // BaseOfCode
        header.writeUInt32LE(0x2000, 24); // BaseOfData
        header.writeUInt32LE(this.imageBase, 28); // ImageBase
        header.writeUInt32LE(this.sectionAlignment, 32); // SectionAlignment
        header.writeUInt32LE(this.fileAlignment, 36); // FileAlignment
        header.writeUInt16LE(6, 40); // MajorOperatingSystemVersion
        header.writeUInt16LE(0, 42); // MinorOperatingSystemVersion
        header.writeUInt16LE(0, 44); // MajorImageVersion
        header.writeUInt16LE(0, 46); // MinorImageVersion
        header.writeUInt16LE(6, 48); // MajorSubsystemVersion
        header.writeUInt16LE(0, 50); // MinorSubsystemVersion
        header.writeUInt32LE(0, 52); // Win32VersionValue
        header.writeUInt32LE(this._calculateImageSize(), 56); // SizeOfImage
        header.writeUInt32LE(this._calculateHeadersSize(), 60); // SizeOfHeaders
        header.writeUInt32LE(0, 64); // CheckSum
        header.writeUInt16LE(this.subsystem === 'WINDOWS' ? 2 : 1, 68); // Subsystem
        header.writeUInt16LE(0, 70); // DllCharacteristics
        header.writeUInt32LE(0x100000, 72); // SizeOfStackReserve
        header.writeUInt32LE(0x10000, 76); // SizeOfStackCommit
        header.writeUInt32LE(0x100000, 80); // SizeOfHeapReserve
        header.writeUInt32LE(0x1000, 84); // SizeOfHeapCommit
        header.writeUInt32LE(0, 88); // LoaderFlags
        header.writeUInt32LE(16, 92); // NumberOfRvaAndSizes

        // Data directories (16 entrées de 8 bytes)
        const dirs = [
            { rva: 0, size: 0 }, // Export
            { rva: this.imports.length > 0 ? this._getImportRVA() : 0, size: this.imports.length > 0 ? 0x3C : 0 }, // Import
            { rva: 0, size: 0 }, // Resource
            { rva: 0, size: 0 }, // Exception
            { rva: 0, size: 0 }, // Certificate
            { rva: 0, size: 0 }, // BaseRelocation
            { rva: 0, size: 0 }, // Debug
            { rva: 0, size: 0 }, // Architecture
            { rva: 0, size: 0 }, // GlobalPtr
            { rva: 0, size: 0 }, // TLS
            { rva: 0, size: 0 }, // LoadConfig
            { rva: 0, size: 0 }, // BoundImport
            { rva: 0, size: 0 }, // IAT
            { rva: 0, size: 0 }, // DelayImport
            { rva: 0, size: 0 }, // COMDescriptor
            { rva: 0, size: 0 }  // Reserved
        ];

        let dirOffset = 96;
        dirs.forEach(dir => {
            header.writeUInt32LE(dir.rva, dirOffset);
            header.writeUInt32LE(dir.size, dirOffset + 4);
            dirOffset += 8;
        });

        return header;
    }

    _buildSectionHeaders() {
        return this.sections.map(section => {
            const header = Buffer.alloc(40);
            section.name.copy(header, 0);
            header.writeUInt32LE(section.virtualSize, 8);
            header.writeUInt32LE(section.virtualAddress, 12);
            header.writeUInt32LE(section.rawSize, 16);
            header.writeUInt32LE(section.rawOffset, 20);
            header.writeUInt32LE(section.relocations, 24);
            header.writeUInt32LE(section.lineNumbers, 28);
            header.writeUInt16LE(section.relocationsOffset, 32);
            header.writeUInt16LE(section.lineNumbersOffset, 34);
            header.writeUInt32LE(section.characteristics, 36);
            return header;
        });
    }

    _buildImportDirectory() {
        if (this.imports.length === 0) return Buffer.alloc(0);

        // Construction simplifiée de la table d'importation
        // En pratique, cela nécessite des calculs d'offset précis
        const importSize = this.imports.length * 20 + 20; // Descripteurs + NULL
        return Buffer.alloc(importSize);
    }

    _getNextVirtualAddress() {
        if (this.sections.length === 0) return 0x1000;
        const last = this.sections[this.sections.length - 1];
        return last.virtualAddress + last.virtualSize;
    }

    _getNextRawOffset() {
        if (this.sections.length === 0) {
            return this._calculateHeadersSize();
        }
        const last = this.sections[this.sections.length - 1];
        return last.rawOffset + last.rawSize;
    }

    _getImportRVA() {
        // RVA de la section .idata ou fin des sections existantes
        return this._getNextVirtualAddress();
    }

    _calculateImageSize() {
        if (this.sections.length === 0) return 0x1000;
        return this._getNextVirtualAddress() + 0x1000;
    }

    _calculateHeadersSize() {
        const dosHeader = 64;
        const dosStub = this._buildDOSStub().length;
        const peSig = 4;
        const coff = 20;
        const optional = 224;
        const sectionHeaders = this.sections.length * 40;
        return this._align(dosHeader + dosStub + peSig + coff + optional + sectionHeaders, this.fileAlignment);
    }

    _align(value, alignment) {
        return Math.ceil(value / alignment) * alignment;
    }

    _padData(data, size) {
        if (data.length >= size) return data.slice(0, size);
        const padded = Buffer.alloc(size);
        data.copy(padded);
        return padded;
    }
}

module.exports = { PEBuilder };
