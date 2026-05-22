# Architecture Scadassembler v2.0

## Vue d'ensemble

Scadassembler v2.0 est un convertisseur de code assembleur x86 16-bit (MS-DOS) vers x86 32-bit (Win32), spécifiquement conçu pour la migration de systèmes SCADA/IoT legacy.

## Pipeline de conversion (5 phases)

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Phase 1   │───▶│   Phase 2   │───▶│   Phase 3   │───▶│   Phase 4   │───▶│   Phase 5   │
│  Chargement │    │   Analyse   │    │Transformation│   │   Émission  │    │  Validation │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
```

### Phase 1: Chargement (Loader)

Détection et parsing des formats d'entrée:

| Format | Parser | Description |
|--------|--------|-------------|
| .COM | COMParser | Fichier plat 64K, PSP à 0100h |
| .EXE (MZ) | MZParser | Header MZ, table de relocation, segments |
| .ASM | SourceParser | Source assembleur texte |

**MZParser** extrait:
- Header DOS (28+ bytes)
- Table de relocation (segment:offset → RVA)
- Image programme (code + données)
- Entry point (CS:IP relocalisé)
- Informations de pile (SS:SP)
- Segments logiques
- Zones code/data (heuristique)

### Phase 2: Analyse

- **CFG Builder**: Construction du graphe de flux de contrôle
- **Dataflow Analyzer**: Analyse des dépendances de données
- **Pattern Detector**: Détection de patterns SCADA/IoT

### Phase 3: Transformation (Rule Engine)

Moteur de règles hiérarchiques avec cascade:

1. **architecture_rules** (CRITICAL): Changement 16→32 bit, élimination segmentation
2. **format_rules** (CRITICAL): .COM/.EXE → PE, conversion relocations
3. **domain_rules** (HIGH): Patterns SCADA/IoT spécifiques
4. **pattern_rules** (HIGH): Far calls, BCD, hooks, chaînes $
5. **instruction_rules** (MEDIUM): Conversion instruction par instruction
6. **interrupt_rules** (MEDIUM): INT 21h, 10h, 16h → APIs Win32
7. **register_rules** (MEDIUM): AX→EAX, élimination segments
8. **segment_rules** (MEDIUM): .MODEL SMALL → FLAT
9. **directive_rules** (LOW): .8086 → .386
10. **macro_rules** (LOW): Templates Win32
11. **fallback_rules** (INFO): Marquage pour review manuelle

### Phase 4: Émission (Backends)

| Backend | Sortie | Usage |
|---------|--------|-------|
| MASM | .asm | Assemblage avec ML/MASM32 |
| NASM | .asm | Assemblage avec NASM |
| PE | .exe | Binaire PE direct |

### Phase 5: Validation

- Vérification du point d'entrée
- Validation du modèle FLAT
- Présence des prototypes Win32
- Détection des reviews manuelles requises

## Structure des modules

```
src/
├── loader/
│   ├── mz_parser.js      # Parser complet format MZ
│   ├── com_parser.js     # Parser format COM
│   ├── pe_builder.js     # Générateur PE
│   └── binary_utils.js   # Utilitaires binaires
├── core/
│   ├── converter.js      # Pipeline principal
│   ├── rule_engine.js    # Moteur de règles hiérarchiques
│   ├── cfg_builder.js    # Construction du CFG
│   └── dataflow_analyzer.js
├── backends/
│   ├── masm_backend.js   # Émetteur MASM
│   ├── nasm_backend.js   # Émetteur NASM
│   └── pe_backend.js     # Émetteur PE binaire
└── plugins/
    ├── bcd_emulator.js       # Émulation instructions BCD
    ├── farcall_resolver.js   # Résolution far calls
    ├── iot_bridge.js         # Bridge IoT moderne
    └── interrupt_dispatcher.js
```

## Format JSON hiérarchique

Le fichier `config/hierarchical_rules.json` définit les règles selon le schéma:

```json
{
  "rule_engine": {
    "priority_levels": ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"],
    "matching_strategy": "hierarchical_cascade",
    "conflict_resolution": "priority_override"
  },
  "category_rules": {
    "_priority": "LEVEL",
    "rules": [
      {
        "id": "unique_id",
        "condition": { /* matching conditions */ },
        "transformations": { /* output transformations */ }
      }
    ]
  }
}
```

## Gestion des formats exécutables

### .COM → PE
- Offset 0100h → EntryPoint RVA
- PSP simulé en .data si nécessaire
- Tous les offsets internes -0x100 pour RVA

### .EXE (MZ) → PE
- Header MZ analysé (relocation table, segments)
- Segments DOS → Sections PE (.text, .data, .bss)
- Relocations MZ converties en relocations PE
- Entry point: (S0 + CS) * 16 + IP → RVA
