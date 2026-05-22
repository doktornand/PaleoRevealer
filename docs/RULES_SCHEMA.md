# Schéma des Règles Hiérarchiques

## Structure générale

```json
{
  "_schema_version": "2.0",
  "rule_engine": { ... },
  "category_name": {
    "_priority": "CRITICAL|HIGH|MEDIUM|LOW|INFO",
    "_description": "...",
    "rules": [ ... ]
  }
}
```

## Règle individuelle

```json
{
  "id": "identifiant_unique",
  "name": "Nom lisible",
  "condition": {
    "field": "expected_value",
    "field_with_alternatives": "val1 | val2 | val3",
    "numeric_field": { "gt": 10, "lt": 100 },
    "regex_field": { "regex": "pattern", "flags": "i" }
  },
  "transformations": {
    "type1": { ... },
    "type2": [ "code1", "code2" ]
  },
  "warnings": [ "message1", "message2" ],
  "side_effects": [ "effet1", "effet2" ]
}
```

## Conditions

### Égalité simple
```json
"condition": {
  "source_arch": "x86_16",
  "target_arch": "x86_32"
}
```

### Alternatives (OR)
```json
"condition": {
  "instruction": "CALLF | JMPF | RETF"
}
```

### Liste de valeurs
```json
"condition": {
  "instructions": ["AAA", "AAS", "AAM", "AAD", "DAA", "DAS"]
}
```

### Comparateurs numériques
```json
"condition": {
  "complexity_score": { "gt": 8 },
  "pattern_confidence": { "lt": 0.5 }
}
```

### Expressions régulières
```json
"condition": {
  "directive": { "regex": "^\.(8086|186|286)$" }
}
```

## Transformations

### Mapping simple
```json
"transformations": {
  "register_mapping": {
    "AX": "EAX",
    "BX": "EBX"
  }
}
```

### Code généré
```json
"transformations": {
  "setup_code": [
    ".386",
    ".MODEL FLAT, STDCALL",
    "OPTION CASEMAP:NONE"
  ]
}
```

### Templates avec variables
```json
"transformations": {
  "api_call": "CreateFileA({filename}, {access}, 0, NULL, {disposition}, FILE_ATTRIBUTE_NORMAL, NULL)"
}
```

## Résolution de conflits

Quand deux règles ciblent la même transformation:

1. **priority_override**: La règle avec la priorité la plus haute l'emporte
2. **UNRESOLVED**: Même priorité → review manuelle requise

## Cascade d'évaluation

L'ordre `cascade_order` définit la séquence:
```
architecture_rules → format_rules → domain_rules → pattern_rules → 
instruction_rules → interrupt_rules → register_rules → segment_rules → 
directive_rules → macro_rules → fallback_rules
```

Chaque catégorie peut ajouter, modifier ou supprimer des transformations des catégories précédentes.
