// Moved from synty-sprite-generator apps/server/src/models.ts ModelError (P3, ali3b/sloponator#14). The HTTP
// status stays as a code the CLI can map (404 = not in the library, 409 = not ready, 400 = a bad spec).

export class ModelError extends Error {
  constructor(message: string, readonly status = 400, readonly code?: string) {
    super(message);
  }
}
