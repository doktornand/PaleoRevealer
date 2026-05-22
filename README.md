# Scadassembler v2.0

Convertisseur ASM16/DOS vers ASM32/Win32 avec support des formats executables et regles hierarchiques.

## Fonctionnalites

- **Parser MZ complet**: Analyse des fichiers .EXE MS-DOS (header, relocation table, segments)
- **Parser COM**: Support des fichiers .COM (format plat 64K)
- **Generateur PE**: Construction de binaires PE Win32 valides
- **Moteur de regles hierarchiques**: Cascade de 11 categories de regles avec resolution de conflits
- **Plugins specialises**:
  - Emulation instructions BCD (AAA, DAA, etc.)
  - Resolution des far calls (CALLF, JMPF, RETF)
  - Bridge IoT (ports serie, parallele, timers)
  - Dispatch des interruptions DOS/BIOS
- **UI Web interactive**: Editeur avec coloration, conversion temps reel, drag & drop

## Installation

```bash
npm install
```

## Utilisation CLI

```bash
# Conversion simple
node cli.js programme.asm

# Mode SCADA avec rapport
node cli.js --scada --report --format masm device_driver.asm

# Conversion .EXE (MZ) vers PE
node cli.js --mz-to-pe -o output.exe old_program.exe

# Conversion .COM vers PE
node cli.js --com-to-pe -o output.exe old_tsr.com
```

## Options

| Option | Description |
|--------|-------------|
| `-o, --output <file>` | Fichier de sortie |
| `-f, --format <fmt>` | Format cible: masm, nasm, pe |
| `-s, --subsystem <sys>` | Sous-systeme: CONSOLE, WINDOWS |
| `--scada` | Mode SCADA/IoT (mappings materiels) |
| `--report` | Generer rapport JSON |
| `--no-comments` | Supprimer commentaires |
| `--debug` | Informations de debug |
| `--com-to-pe` | Convertir .COM vers PE |
| `--mz-to-pe` | Convertir .EXE (MZ) vers PE |

## Pipeline de conversion (5 phases)

1. **Chargement**: Detection format, parsing binaire (.COM/.EXE) ou source (.ASM)
2. **Analyse**: CFG, dataflow, detection patterns SCADA/IoT
3. **Transformation**: Application des regles hierarchiques JSON
4. **Emission**: Generation MASM/NASM/PE
5. **Validation**: Verification coherence, marquage reviews manuelles

## Architecture

```
src/
├── loader/       # Parsers binaires (MZ, COM) et generateur PE
├── core/         # Pipeline, moteur de regles, analyse
├── backends/     # Generateurs MASM, NASM, PE
└── plugins/      # Emulateurs et bridges specialises

config/
├── hierarchical_rules.json   # Regles de conversion
├── executable_formats.json   # Formats supportes
├── pe_templates.json         # Templates PE
└── iot_mappings.json         # Mappings materiels IoT
```

## Tests

```bash
npm test
npm run test:mz
npm run test:rules
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Format MZ](docs/MZ_FORMAT.md)
- [Schema des regles](docs/RULES_SCHEMA.md)

## Licence

MIT
