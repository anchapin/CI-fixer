/**
 * Tracing wrapper for graph nodes
 * Simplifies adding tracing to existing node handlers
 */

import { withSpan, setAttributes } from '../../../telemetry/tracing.js';
import { GraphState, GraphContext, NodeHandler } from '../state.js';

/**
 * Wrap a node handler with basic tracing
 */
export function withNodeTracing(nodeName: string, handler: NodeHandler): NodeHandler {
    return async (state: GraphState, context: GraphContext) => {
        return withSpan(`node-${nodeName}`, async (span) => {
            setAttributes(span, {
                'node.name': nodeName,
                'node.iteration': state.iteration,
                'node.status': state.status
            });

            const result = await handler(state, context);

            setAttributes(span, {
                'node.next': result.currentNode || state.currentNode,
                'node.result_status': result.status || 'success'
            });

            return result;
        });
    };
}
