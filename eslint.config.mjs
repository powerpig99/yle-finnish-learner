import js from '@eslint/js';
import globals from 'globals';

export default [
    // Recommended ESLint rules
    js.configs.recommended,

    {
        // Global configuration
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.webextensions,
                ...globals.node,
            }
        },

        rules: {
            // Your existing rule
            'max-len': ['error', {
                code: 100,
                ignoreUrls: true,
                ignoreStrings: true,
                ignoreTemplateLiterals: true,
                ignoreComments: true
            }],

            // Code quality rules
            'no-unused-vars': ['warn', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_'
            }],
            'no-console': 'off', // Browser extensions need console
            'no-undef': 'error',
            'prefer-const': 'warn',
            'no-var': 'warn',

            // Best practices
            'eqeqeq': ['error', 'always'],
            'curly': ['error', 'all'],
            'no-eval': 'error',
            'no-implied-eval': 'error',
            'no-with': 'error',
            'no-loop-func': 'warn',
            'no-return-await': 'warn',

            // ES6+ features
            'arrow-spacing': 'warn',
            'prefer-arrow-callback': 'warn',
            'prefer-template': 'warn',
            'template-curly-spacing': 'warn',
            'object-shorthand': 'warn',
        }
    },

    {
        // Test files configuration
        files: ['tests/**/*.js', 'tests/**/*.test.js'],
        languageOptions: {
            globals: {
                ...globals.jest,
                ...globals.node,
            }
        },
        rules: {
            'no-unused-vars': 'off', // Tests often have unused variables
            'max-len': 'off', // Tests can have long lines
        }
    },

    {
        // Ignore patterns
        ignores: [
            'node_modules/**',
            'coverage/**',
            'website/**',
            'landing-page/**',
            '*.min.js',
            '**/dist/**',
            '**/build/**',
            // Legacy injected scripts (inject.js runs in page context, not extension context)
            'inject.js'
        ]
    }
];
