/** An MCP tool definition from an object schema: the name, a description, and the input as JSON Schema 2020-12. */
import type { z } from 'zod';
import { docOf } from '../meta.js';
import { toJsonSchema, type JsonSchema } from './json-schema.js';

export interface McpTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export function mcpTool(name: string, schema: z.ZodType, description?: string): McpTool {
  const { $schema: _dropped, ...inputSchema } = toJsonSchema(schema, { target: 'draft-2020-12', reused: 'inline' });
  const d = docOf(schema);
  return { name, description: description ?? d?.summary ?? d?.title ?? name, inputSchema: { type: 'object', ...inputSchema } };
}
