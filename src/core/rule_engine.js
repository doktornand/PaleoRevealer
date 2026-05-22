/**
 * Rule Engine - Moteur de règles hiérarchiques pour Scadassembler v2
 * 
 * Implémente la stratégie "hierarchical_cascade" avec résolution de conflits
 * par priorité (priority_override).
 */

const fs = require('fs');
const path = require('path');

class HierarchicalRuleEngine {
    constructor(configPath = './config/hierarchical_rules.json') {
        this.rules = this._loadRules(configPath);
        this.cascadeOrder = this.rules.rule_engine.cascade_order;
        this.priorityLevels = this.rules.rule_engine.priority_levels;
        this.appliedRules = [];
        this.conflicts = [];
        this.fallbacks = [];
    }

    _loadRules(configPath) {
        const data = fs.readFileSync(configPath, 'utf8');
        return JSON.parse(data);
    }

    /**
     * Évalue un contexte de conversion contre toutes les règles
     * @param {Object} context - Contexte de conversion (format, arch, domain, etc.)
     * @returns {Object} Résultat avec transformations appliquées
     */
    evaluate(context) {
        this.appliedRules = [];
        this.conflicts = [];
        this.fallbacks = [];

        const result = {
            transformations: [],
            warnings: [],
            manualReview: [],
            metadata: {
                rulesEvaluated: 0,
                rulesApplied: 0,
                conflictsResolved: 0,
                fallbackTriggers: 0
            }
        };

        // Parcours en cascade des catégories de règles
        for (const categoryName of this.cascadeOrder) {
            const category = this.rules[categoryName];
            if (!category) continue;

            const categoryResult = this._evaluateCategory(category, categoryName, context);

            result.transformations.push(...categoryResult.transformations);
            result.warnings.push(...categoryResult.warnings);
            result.manualReview.push(...categoryResult.manualReview);

            result.metadata.rulesEvaluated += categoryResult.evaluated;
            result.metadata.rulesApplied += categoryResult.applied;
        }

        // Application des fallback si aucune règle n'a matché
        if (result.transformations.length === 0) {
            const fallback = this._applyFallback(context);
            if (fallback) {
                result.manualReview.push(fallback);
                result.metadata.fallbackTriggers++;
            }
        }

        result.metadata.conflictsResolved = this.conflicts.length;
        return result;
    }

    /**
     * Évalue une catégorie de règles
     */
    _evaluateCategory(category, categoryName, context) {
        const result = {
            transformations: [],
            warnings: [],
            manualReview: [],
            evaluated: 0,
            applied: 0
        };

        const priority = category._priority || 'LOW';
        const rules = category.rules || [];

        for (const rule of rules) {
            result.evaluated++;

            const matchResult = this._matchRule(rule, context);
            if (matchResult.matched) {
                result.applied++;

                // Vérification des conflits avec les règles déjà appliquées
                const conflicts = this._detectConflicts(rule, matchResult.bindings);
                if (conflicts.length > 0) {
                    const resolution = this._resolveConflicts(rule, conflicts, priority);
                    this.conflicts.push(...resolution.conflicts);

                    if (!resolution.keepRule) {
                        continue;
                    }
                }

                this.appliedRules.push({
                    category: categoryName,
                    priority: priority,
                    rule: rule.id,
                    bindings: matchResult.bindings
                });

                // Extraction des transformations
                const transforms = this._extractTransformations(rule, matchResult.bindings);
                result.transformations.push(...transforms);

                // Extraction des warnings
                if (rule.warnings) {
                    result.warnings.push(...rule.warnings.map(w => ({
                        rule: rule.id,
                        message: w
                    })));
                }

                // Patterns complexes nécessitant review manuelle
                if (this._requiresManualReview(rule, context)) {
                    result.manualReview.push({
                        rule: rule.id,
                        reason: this._getManualReviewReason(rule),
                        confidence: matchResult.confidence
                    });
                }
            }
        }

        return result;
    }

    /**
     * Matching d'une règle contre le contexte
     */
    _matchRule(rule, context) {
        const condition = rule.condition;
        const bindings = {};
        let confidence = 1.0;

        for (const [key, expected] of Object.entries(condition)) {
            const actual = this._resolvePath(context, key);

            if (expected === undefined || actual === undefined) {
                return { matched: false };
            }

            if (typeof expected === 'string' && expected.includes('|')) {
                // Valeurs alternatives (OR)
                const alternatives = expected.split('|').map(s => s.trim());
                if (!alternatives.includes(String(actual))) {
                    return { matched: false };
                }
                bindings[key] = actual;
            } else if (Array.isArray(expected)) {
                // Liste de valeurs acceptables
                if (!expected.includes(actual)) {
                    return { matched: false };
                }
                bindings[key] = actual;
            } else if (typeof expected === 'object' && expected !== null) {
                // Conditions complexes (range, regex, etc.)
                const complexMatch = this._matchComplex(expected, actual);
                if (!complexMatch.matched) {
                    return { matched: false };
                }
                bindings[key] = actual;
                confidence *= complexMatch.confidence;
            } else {
                // Égalité stricte
                if (actual !== expected) {
                    return { matched: false };
                }
                bindings[key] = actual;
            }
        }

        return { matched: true, bindings, confidence };
    }

    /**
     * Matching de conditions complexes
     */
    _matchComplex(expected, actual) {
        // Range: "ah_range": "3Ch-46h"
        if (typeof expected === 'string' && expected.includes('-')) {
            const [min, max] = expected.split('-').map(s => parseInt(s, 16));
            const val = parseInt(actual, 16);
            if (!isNaN(min) && !isNaN(max) && !isNaN(val)) {
                return { matched: val >= min && val <= max, confidence: 1.0 };
            }
        }

        // Regex
        if (expected.regex) {
            const regex = new RegExp(expected.regex, expected.flags || '');
            const matched = regex.test(String(actual));
            return { matched, confidence: matched ? 1.0 : 0.0 };
        }

        // Comparateurs
        if (expected.gt !== undefined) {
            return { matched: actual > expected.gt, confidence: 0.9 };
        }
        if (expected.lt !== undefined) {
            return { matched: actual < expected.lt, confidence: 0.9 };
        }

        return { matched: false, confidence: 0 };
    }

    /**
     * Détecte les conflits entre une nouvelle règle et les règles déjà appliquées
     */
    _detectConflicts(newRule, newBindings) {
        const conflicts = [];

        for (const applied of this.appliedRules) {
            // Conflit si même cible de transformation mais approche différente
            if (this._hasSameTarget(newRule, applied.rule)) {
                conflicts.push({
                    existing: applied,
                    new: newRule.id,
                    target: this._getTransformationTarget(newRule)
                });
            }
        }

        return conflicts;
    }

    /**
     * Résolution des conflits par priorité
     */
    _resolveConflicts(newRule, conflicts, newPriority) {
        const newPriorityIndex = this.priorityLevels.indexOf(newPriority);
        let keepRule = true;
        const resolved = [];

        for (const conflict of conflicts) {
            const existingPriorityIndex = this.priorityLevels.indexOf(conflict.existing.priority);

            if (newPriorityIndex < existingPriorityIndex) {
                // Nouvelle règle a priorité plus haute → remplace
                resolved.push({
                    type: 'OVERRIDE',
                    winner: newRule.id,
                    loser: conflict.existing.rule,
                    reason: `Priorité ${newPriority} > ${conflict.existing.priority}`
                });
            } else if (newPriorityIndex > existingPriorityIndex) {
                // Priorité plus basse → rejetée
                keepRule = false;
                resolved.push({
                    type: 'REJECTED',
                    winner: conflict.existing.rule,
                    loser: newRule.id,
                    reason: `Priorité ${conflict.existing.priority} > ${newPriority}`
                });
            } else {
                // Même priorité → conflit non résolu automatiquement
                resolved.push({
                    type: 'UNRESOLVED',
                    rules: [conflict.existing.rule, newRule.id],
                    reason: 'Même priorité - nécessite décision manuelle'
                });
                keepRule = false;
            }
        }

        return { conflicts: resolved, keepRule };
    }

    /**
     * Extrait les transformations d'une règle
     */
    _extractTransformations(rule, bindings) {
        const transforms = [];

        if (!rule.transformations) return transforms;

        for (const [key, value] of Object.entries(rule.transformations)) {
            transforms.push({
                type: key,
                rule: rule.id,
                data: this._substituteBindings(value, bindings),
                original: rule.condition
            });
        }

        return transforms;
    }

    /**
     * Substitute les variables de binding dans les templates
     */
    _substituteBindings(template, bindings) {
        if (typeof template === 'string') {
            let result = template;
            for (const [key, value] of Object.entries(bindings)) {
                result = result.replace(new RegExp(`\{${key}\}`, 'g'), value);
            }
            return result;
        }

        if (Array.isArray(template)) {
            return template.map(item => this._substituteBindings(item, bindings));
        }

        if (typeof template === 'object' && template !== null) {
            const result = {};
            for (const [key, value] of Object.entries(template)) {
                result[key] = this._substituteBindings(value, bindings);
            }
            return result;
        }

        return template;
    }

    /**
     * Détermine si une règle nécessite une review manuelle
     */
    _requiresManualReview(rule, context) {
        const highRiskPatterns = [
            'pattern_far_calls',
            'pattern_self_modifying',
            'pattern_interrupt_hooks',
            'pattern_dollar_strings'
        ];

        return highRiskPatterns.includes(rule.id) || 
               (rule.transformations && rule.transformations._manual_review);
    }

    _getManualReviewReason(rule) {
        const reasons = {
            'pattern_far_calls': 'Graphe d'appel complexe - nécessite analyse manuelle',
            'pattern_self_modifying': 'Code auto-modifiant - risque de sécurité',
            'pattern_interrupt_hooks': 'Hooks d'interruption - comportement critique',
            'pattern_dollar_strings': 'Chaînes DOS $ - vérifier la longueur calculée'
        };
        return reasons[rule.id] || 'Pattern complexe détecté';
    }

    /**
     * Applique les règles de fallback
     */
    _applyFallback(context) {
        const fallback = this.rules.fallback_rules;
        if (!fallback || !fallback.rules) return null;

        for (const rule of fallback.rules) {
            if (rule.condition.match === 'no_rule_applied' && this.appliedRules.length === 0) {
                this.fallbacks.push(rule.id);
                return {
                    rule: rule.id,
                    marker: rule.action.marker,
                    message: rule.action.output,
                    type: 'FALLBACK'
                };
            }
        }
        return null;
    }

    /**
     * Utilitaires
     */
    _resolvePath(obj, path) {
        return path.split('.').reduce((current, part) => current?.[part], obj);
    }

    _hasSameTarget(rule1, rule2Id) {
        // Simplification: considère qu'il y a conflit si même catégorie de transformation
        return rule1.id.split('_')[0] === rule2Id.split('_')[0];
    }

    _getTransformationTarget(rule) {
        return Object.keys(rule.transformations || {})[0] || 'unknown';
    }

    /**
     * Génère un rapport de conversion
     */
    generateReport() {
        return {
            appliedRules: this.appliedRules,
            conflicts: this.conflicts,
            fallbacks: this.fallbacks,
            summary: {
                totalRules: this.appliedRules.length,
                criticalRules: this.appliedRules.filter(r => r.priority === 'CRITICAL').length,
                highRules: this.appliedRules.filter(r => r.priority === 'HIGH').length,
                manualReviews: this.appliedRules.filter(r => 
                    ['pattern_far_calls', 'pattern_self_modifying', 'pattern_interrupt_hooks'].includes(r.rule)
                ).length
            }
        };
    }
}

module.exports = { HierarchicalRuleEngine };

// Test CLI
if (require.main === module) {
    const engine = new HierarchicalRuleEngine();

    const testContext = {
        source_arch: 'x86_16',
        target_arch: 'x86_32',
        source_format: 'MZ',
        target_format: 'PE',
        domain: 'SCADA',
        sub_domain: 'IoT_MAINTENANCE',
        has_segments: true,
        target_flat: true
    };

    const result = engine.evaluate(testContext);
    console.log(JSON.stringify(result, null, 2));
}
