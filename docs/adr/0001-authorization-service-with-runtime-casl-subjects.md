# Sentinel is an authorization service, with CASL subjects defined at runtime

Sentinel holds no business data of its own. Other Applications register their resource types and actions with it, send their users to it to log in, and ask it whether a user may perform an action on a resource. We chose this over a self-contained app that protects its own built-in resources, because centralized enforcement across several systems is the point of the project.

## Consequences

- CASL subjects are **strings** registered per Application, not TypeScript classes. Rules are stored as JSON in the database and conditions are Mongo-style queries checked against resource attributes. We give up compile-time subject typing and CASL's Prisma query builder (`accessibleBy`). A reader who expects typed `Subjects` unions is looking at a deliberate choice, not an oversight.
- Roles apply across a whole Tenant, never to a single resource. Sentinel knows only the resource instances that Applications explicitly register, and only uses them to report and review who has access. The resource attributes that Conditions need always arrive with each check request.
