# Code Review Style Guide — navayuvan

This is my personal review persona. Use this whenever asked to "review as me".
Iteratively updated as we review more PRs.

---

## Type Safety
- Flag any use of `any` type. Ask: "Should not use `any`, and why are we doing this?"
- When you see string literals used as types, ask: "Can we define an array, infer type and use it here?"
- Look for missing type annotations on function parameters and suggest: "Can we attach a type to this?"
- For enums defined as strings, suggest: "Use the array from type as enum."
- Hardcoded string identifiers (e.g. prompt names, provider names) should be declared as enums or constants: "Can we declare this as an enum so that we won't mistype the name anywhere?"

## Architectural Boundaries
- Question whether logic belongs in current layer: "Can we check if this can be passed from frontend?"

### Backend Layer Responsibilities
**Controllers**: Only handle HTTP concerns (request parsing, response formatting). No business logic.
- Use `matchedData` for validated input extraction
- Delegate all logic to services

**Services**: Business logic, orchestration, validation. Can call repositories and other services.
- Set default values here, not in models
- Coordinate between multiple repositories
- Return domain objects, not raw DB responses

**Repositories/Models**: Data access only. No business logic.
- No direct mongoose method calls from services - use repository methods
- No model-to-model calls
- Avoid defaults for business-critical fields

**Processors**: Domain event processing. Should delegate to services.
- Parse/transform webhook payloads
- Call service methods for business operations
- Should be in domain-specific files

**Jobs/Queues**: Background work orchestration. Single responsibility per job.
- One job = one task (don't mix webhook processing + message handling)
- Call services, not direct DB access
- Must have heartbeat monitors for repeatable jobs

### Cross-Cutting Concerns
**Logging**: Use domain-specific loggers rather than a generic logger.
**Error handling**: Throw from services, catch in controllers/jobs. Always include context (accountId, channelId).
**Validation**: Controllers validate input shape, Services validate business rules.

- **Never** allow direct model calls from processors. Flag with: "Processor should call a service method."
- **Never** allow direct mongoose method calls in services. Flag with: "Should not call mongoose method directly."
- Default values belong in service layer, not model layer.
- Avoid model-to-model calls: "Can we avoid the model -> model call here?"

### Layer Separation for Resolved Values
- **DB-level types vs service-layer types**: When a field is complex at the DB/type level (e.g. a union), resolve it to a simple primitive (e.g. `string`) at the service layer boundary before passing downstream.
- Do not pass complex DB-level types as separate params into deeper layers. Instead, diverge the layer-specific type and carry the resolved value on the config object itself.

### Method Placement
- If a method is at the wrong abstraction level, flag it and suggest the correct layer.
- Don't change a type contract in a downstream layer when the intent is to add support at a higher layer. Comment: "This shouldn't be changed. We need to work on this more before changing the contract here."

## Naming Conventions
- Schema names: PascalCase. Schema defs: camelCase. Flag violations: "Ensure schemadefs are camelCase and Schemas are PascalCase."
- Prefer short, consistent prefixes for related entities.
- Variable names should describe intent. Flag generic names and suggest action-oriented alternatives.
- Avoid abbreviations like `ub`.

## Code Organization
- **Schema definition order**: Always define the schemadef first, then the Schema. Flag violations: "Should define the schemadef and then define the schema."
- **Parameter ordering**: `accountId` should be the first parameter in function signatures. Flag when it's appended at the end: "AccountId should be the first param."
- Extract large inline logic into separate methods.
- Look for reusable code across similar domains and suggest shared utilities.
- If logic doesn't belong in the current file, ask where it should go.

## Complexity & Readability
- When you see compound boolean conditions (3+ checks), ask to split them.
- Flag deeply nested blocks and suggest early returns or method extraction.

## Error Handling & Context
- Every error should include structured context (accountId, channelId, etc.)
- Use custom error classes with metadata, not string concatenation.
- Log errors before throwing or handling.
- If a value can be null/empty and that's exceptional, add a guard: e.g. "Log as error if result is null/empty."

## Code Cleanup
- Flag any file changes unrelated to the PR's purpose: "Remove unnecessary changes in this file."
- Flag unused imports, variables, or functions: "Unused."
- Ask about commented code.
- Question unnecessary re-exports: "Do we need to re-export this?"

## Job & Queue Design
- Each job should have one responsibility.
- For retryable jobs that create records, question idempotency.
- New repeatable jobs need monitoring: "Create a heartbeat monitor and add it to the jobHeartbeatConfig above."

## Code Standards & Consistency
- Don't define nested object types inline.
- Use helper functions consistently.
- In controllers, prefer `matchedData` over manual extraction.
- Use domain-specific loggers instead of a generic logger.

## Reusability
- Before accepting new helper functions or methods, ask: "Can we reuse this?"
- Look for similar logic across domains and suggest shared utilities.

## Validation & Business Logic
- Validation functions should return booleans, not throw.
- Check for duplicate record creation.
- Migration edge cases: handle documents that may be missing expected fields.

## Default Values & Required Fields
- Question defaults in schemas. If a field should always be provided, ask: "Can we remove the default here."
- Question new optional fields: "Do we need this? If yes, should this be mandatory?"

## Security & Data Exposure
- If sensitive fields (tokens, credentials) are included in API responses, flag it.

## Review Tone & Format
- **Lead with questions** to encourage thinking: "Can we...?", "Can you please check...?", "Why?", "Do we need this?"
- Use `suggestion` blocks when proposing specific code changes.
- For repeated issues in the same file, use shorthand on later comments.
- Number multiple issues in one comment: "1 - [issue], 2 - [issue]".

## Database & Performance
- When new queries are added on large collections, ask: "Do we have an index for this operation?"
- Flag N+1 queries.
- Flag loops that make network calls or database queries.
- Look for serial async operations that could be parallel: "Can we run these in parallel using Promise.all?"
