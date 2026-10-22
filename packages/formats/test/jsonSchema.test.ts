import { describe, expect, it } from 'vitest';
import { FORMATS, formatJsonSchema } from '../src/index.js';

describe('JSON Schemas', () => {
  for (const f of FORMATS) {
    it(`${f.id} generates a draft-7 object schema named ${f.schemaFile}`, () => {
      const s = formatJsonSchema(f);
      expect(s.$id).toBe(f.schemaFile);
      expect(s.$schema).toBe('http://json-schema.org/draft-07/schema#');
      expect(s.type).toBe('object');
      expect(Object.keys(s.properties as object).length).toBeGreaterThanOrEqual(1);
      // No anonymous definitions left behind, no refs to them.
      expect(JSON.stringify(s)).not.toMatch(/__schema/);
    });
  }
  it('the meta schema pins its schema id and lists the strike limbs', () => {
    const s = formatJsonSchema(FORMATS[0]!) as { properties: Record<string, Record<string, unknown>> };
    expect(s.properties.schema).toEqual({ type: 'string', const: 'ssg-meta/1' });
    expect(JSON.stringify(s)).toContain('"elbow_l"');
  });
});
