# Format MZ (MS-DOS Executable)

## Spécification

Le format MZ est le format exécutable standard de MS-DOS, nommé d'après Mark Zbikowski (développeur de MS-DOS).

## Structure

```
┌─────────────────────────────────────┐
│         DOS Header (64 bytes)       │
│  Offset 0:   Magic "MZ" (2 bytes)   │
│  Offset 2:   Last page bytes        │
│  Offset 4:   Pages in file          │
│  Offset 6:   Relocation count       │
│  Offset 8:   Header paragraphs      │
│  Offset 10:  Min allocation         │
│  Offset 12:  Max allocation         │
│  Offset 14:  Initial SS (relatif)   │
│  Offset 16:  Initial SP             │
│  Offset 18:  Checksum               │
│  Offset 20:  Initial IP             │
│  Offset 22:  Initial CS (relatif)   │
│  Offset 24:  Relocation offset      │
│  Offset 26:  Overlay number         │
│  Offset 28:  Reserved (8 bytes)     │
│  Offset 36:  OEM ID                 │
│  Offset 38:  OEM Info               │
│  Offset 40:  Reserved (20 bytes)    │
│  Offset 60:  PE Header offset       │
├─────────────────────────────────────┤
│      Relocation Table (variable)    │
│  Entrées de 4 bytes:                │
│    - Offset (2 bytes)               │
│    - Segment (2 bytes)              │
├─────────────────────────────────────┤
│      Program Image (variable)       │
│  Code + Données + BSS               │
└─────────────────────────────────────┘
```

## Champs importants

### Calcul de la taille du programme
```
program_size = pages_in_file * 512 - (last_page_bytes ? 512 - last_page_bytes : 0) - header_paragraphs * 16
```

### Entry Point
```
physical_address = (loading_segment + initial_CS) * 16 + initial_IP
```

### Stack
```
SS:SP = (loading_segment + initial_SS) : initial_SP
```

## Conversion vers PE

### Relocations
```
MZ relocation: segment:offset
PE relocation: RVA = segment * 16 + offset
```

### Segments → Sections
| Segment DOS | Section PE | Caractéristiques |
|-------------|------------|------------------|
| CODE | .text | CODE \| EXECUTE \| READ |
| DATA | .data | INITIALIZED_DATA \| READ \| WRITE |
| BSS | .bss | UNINITIALIZED_DATA \| READ \| WRITE |
| STACK | (intégré) | SizeOfStackReserve/Commit |
