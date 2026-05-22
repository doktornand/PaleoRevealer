/**
 * Tests unitaires - Rule Engine
 */

const { HierarchicalRuleEngine } = require('../src/core/rule_engine');

function runTests() {
    console.log('=== Tests Rule Engine ===\n');

    const engine = new HierarchicalRuleEngine('./config/hierarchical_rules.json');

    // Test 1: Conversion architecture
    console.log('Test 1: Conversion architecture 16→32 bit');
    try {
        const context = {
            source_arch: 'x86_16',
            target_arch: 'x86_32',
            source_format: 'MZ',
            target_format: 'PE'
        };

        const result = engine.evaluate(context);

        const hasArchTransform = result.transformations.some(
            t => t.rule === 'arch_x86_16_to_32'
        );
        console.assert(hasArchTransform, 'Transformation architecture attendue');
        console.log('✓ Test 1 passé\n');
    } catch (e) {
        console.error('✗ Test 1 échoué:', e.message);
    }

    // Test 2: Mode SCADA
    console.log('Test 2: Mode SCADA/IoT');
    try {
        const context = {
            source_arch: 'x86_16',
            target_arch: 'x86_32',
            source_format: 'MZ',
            target_format: 'PE',
            domain: 'SCADA',
            sub_domain: 'IoT_MAINTENANCE'
        };

        const result = engine.evaluate(context);

        const hasIoTTransform = result.transformations.some(
            t => t.rule === 'domain_scada_iot'
        );
        console.assert(hasIoTTransform, 'Transformation IoT attendue');
        console.log('✓ Test 2 passé\n');
    } catch (e) {
        console.error('✗ Test 2 échoué:', e.message);
    }

    // Test 3: Résolution de conflits
    console.log('Test 3: Résolution de conflits par priorité');
    try {
        const context = {
            source_arch: 'x86_16',
            target_arch: 'x86_32',
            has_segments: true,
            target_flat: true
        };

        const result = engine.evaluate(context);

        // CRITICAL doit l'emporter sur MEDIUM
        const criticalRules = result.transformations.filter(
            t => t.rule && t.rule.startsWith('arch_')
        );
        console.assert(criticalRules.length > 0, 'Règles CRITICAL appliquées');
        console.log('✓ Test 3 passé\n');
    } catch (e) {
        console.error('✗ Test 3 échoué:', e.message);
    }

    // Test 4: Fallback
    console.log('Test 4: Fallback sur contexte inconnu');
    try {
        const context = {
            source_arch: 'unknown_arch',
            target_arch: 'unknown_target'
        };

        const result = engine.evaluate(context);

        console.assert(result.metadata.fallbackTriggers > 0, 'Fallback attendu');
        console.assert(result.manualReview.length > 0, 'Review manuelle attendue');
        console.log('✓ Test 4 passé\n');
    } catch (e) {
        console.error('✗ Test 4 échoué:', e.message);
    }

    // Test 5: Rapport
    console.log('Test 5: Génération de rapport');
    try {
        const context = {
            source_arch: 'x86_16',
            target_arch: 'x86_32',
            source_format: 'MZ',
            target_format: 'PE',
            domain: 'SCADA',
            sub_domain: 'IoT_MAINTENANCE'
        };

        engine.evaluate(context);
        const report = engine.generateReport();

        console.assert(report.totalRules > 0, 'Règles appliquées attendues');
        console.assert(typeof report.summary === 'object', 'Résumé attendu');
        console.log('✓ Test 5 passé\n');
    } catch (e) {
        console.error('✗ Test 5 échoué:', e.message);
    }

    console.log('=== Tests terminés ===');
}

runTests();
