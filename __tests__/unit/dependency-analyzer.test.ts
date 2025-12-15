
import { describe, it, expect } from 'vitest';
import {
    parseDependencies,
    getImmediateDependencies,
    buildDependencyGraph,
    getRelatedFiles,
    findTestFiles,
    analyzeFileRelationships,
    DependencyGraph
} from '../../services/dependency-analyzer';
import { CodeFile } from '../../types';

describe('Dependency Analyzer', () => {
    describe('parseDependencies', () => {
        it('should parse TypeScript imports', async () => {
            const content = `
                import { foo } from './foo';
                import bar from '../components/bar.js';
                import * as baz from './utils/baz';
            `;
            const deps = await parseDependencies('/src/file.ts', content, 'typescript');
            expect(deps).toEqual(['/src/foo', '/components/bar', '/src/utils/baz']);
        });

        it('should parse CommonJS requires', async () => {
            const content = `
                const foo = require('./foo');
                const bar = require('../bar');
            `;
            const deps = await parseDependencies('/src/file.js', content, 'javascript');
            expect(deps).toEqual(['/src/foo', '/bar']);
        });

        it('should parse Python imports', async () => {
            const content = `
                from .submodule import foo
                import .sibling
            `;
            const deps = await parseDependencies('/src/module/__init__.py', content, 'python');
            // Assuming normalization for python handles these relative imports
            // The current implementation is simple:
            // .submodule -> /src/module/submodule
            // .sibling -> /src/module/sibling
            expect(deps).toEqual(['/src/module/submodule', '/src/module/sibling']);
        });

        it('should ignore external imports', async () => {
            const content = `
                import { foo } from 'react';
                import bar from 'lodash';
            `;
            const deps = await parseDependencies('/src/file.ts', content, 'typescript');
            expect(deps).toEqual([]);
        });
    });

    describe('buildDependencyGraph', () => {
        const files: CodeFile[] = [
            {
                name: '/src/a.ts',
                content: "import b from './b';",
                language: 'typescript'
            },
            {
                name: '/src/b.ts',
                content: "import c from './c';",
                language: 'typescript'
            },
            {
                name: '/src/c.ts',
                content: "",
                language: 'typescript'
            }
        ];

        it('should build a dependency graph', async () => {
            const graph = await buildDependencyGraph(files);

            // Forward
            expect(graph.nodes.get('/src/a.ts')).toContain('/src/b.ts');
            expect(graph.nodes.get('/src/b.ts')).toContain('/src/c.ts');

            // Reverse
            expect(graph.reverse.get('/src/b.ts')).toContain('/src/a.ts');
            expect(graph.reverse.get('/src/c.ts')).toContain('/src/b.ts');
        });
    });

    describe('getRelatedFiles', () => {
        const graph: DependencyGraph = {
            nodes: new Map([
                ['A', ['B']],
                ['B', ['C']],
                ['C', []]
            ]),
            reverse: new Map([
                ['B', ['A']],
                ['C', ['B']],
                ['A', []]
            ])
        };

        it('should find related files within depth', () => {
            const related = getRelatedFiles('B', graph, 1);
            expect(related).toContain('A'); // dependent
            expect(related).toContain('C'); // dependency
            expect(related.length).toBe(2);
        });

        it('should find transitive related files with depth 2', () => {
            // If we start at A (depends on B), and maxDepth is 2
            // A -> B (depth 1)
            // B -> C (depth 2)
            const related = getRelatedFiles('A', graph, 2);
            expect(related).toContain('B');
            expect(related).toContain('C');
        });
    });

    describe('findTestFiles', () => {
        const allFiles = [
            '/src/foo.ts',
            '/src/foo.test.ts',
            '/src/__tests__/foo.spec.ts',
            '/src/bar.ts'
        ];

        it('should find co-located test files', () => {
            const tests = findTestFiles('/src/foo.ts', allFiles);
            expect(tests).toContain('/src/foo.test.ts');
        });

        it('should find test files in __tests__', () => {
            const tests = findTestFiles('/src/foo.ts', allFiles);
            expect(tests).toContain('/src/__tests__/foo.spec.ts');
        });

        it('should not match unrelated files', () => {
            const tests = findTestFiles('/src/bar.ts', allFiles);
            expect(tests).toHaveLength(0);
        });
    });

    describe('analyzeFileRelationships', () => {
        it('should aggregate information', async () => {
            const files: CodeFile[] = [
                {
                    name: '/src/a.ts',
                    content: "import b from './b';",
                    language: 'typescript'
                },
                {
                    name: '/src/b.ts',
                    content: "",
                    language: 'typescript'
                }
            ];
            const allFilePaths = ['/src/a.ts', '/src/b.ts', '/src/a.test.ts'];
            const graph = await buildDependencyGraph(files);

            const result = analyzeFileRelationships('/src/a.ts', graph, allFilePaths);

            expect(result.source).toBe('/src/a.ts');
            expect(result.dependencies).toContain('/src/b.ts');
            expect(result.testFiles).toContain('/src/a.test.ts');
        });
    });
});
