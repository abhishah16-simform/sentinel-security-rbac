# Sentinel

A multi-tenant authorization service: other applications delegate authentication and "can this user do this?" decisions to Sentinel, which also keeps the audit and compliance record of who could access what.

## Language

### Tenancy and identity

**Tenant**:
A customer organization whose users, roles and policies are isolated from every other Tenant. Anyone can sign up and create one, and its creator becomes its first Tenant Admin.
_Avoid_: Organization, Company, Account, Workspace

**User**:
A global identity (one person, one login) that can exist in several Tenants.
_Avoid_: Account, Member, Principal

**Membership**:
The link between a User and a Tenant; everything a User can do inside a Tenant hangs off their Membership.
_Avoid_: Tenant user, Seat

**Invitation**:
A Tenant Admin's offer of a Membership to an email address; it only becomes a Membership when the invited User accepts it.
_Avoid_: Invite link, Join request

**Suspended Tenant**:
A Tenant that a Platform Admin has frozen; its Users can neither log in to it nor pass any Access Check in it.
_Avoid_: Disabled, Locked, Banned

**Active Tenant**:
The single Tenant a User is acting in during a session; a User acts in exactly one Tenant at a time.

**Tenant Admin**:
A Membership that may manage its Tenant through Sentinel's console: Memberships, Roles, Role Assignments and Access Reviews. Every other Membership has no console access.
_Avoid_: Owner, Tenant owner, Org admin

**Platform Admin**:
An operator of Sentinel itself who registers Applications and oversees Tenants, but sits outside all of them and cannot see Tenant data by default.
_Avoid_: Super admin, Root, Sentinel admin

**Linked Identity**:
A User's account at an outside identity provider (Google or GitHub) that they can log in to Sentinel with; it is matched by the provider's own user ID, never by email.
_Avoid_: Social account, Connection, External user

**Erased User**:
A User whose personal data was removed at their request; the row stays as an anonymized tombstone so the Audit Log still resolves.
_Avoid_: Deleted user, Removed user

**Privacy Notice Acceptance**:
The record that a User accepted a given version of the privacy notice, and when.
_Avoid_: Consent (reserved for Applications), Opt-in

### Applications and resources

**Application**:
An outside system, registered once by a Platform Admin, that relies on Sentinel to log its users in and to make access decisions.
_Avoid_: Client, App, Integration, Service

**Scope**:
A named piece of access an Application asks for in a token, such as `email` or `access-check`; an Application may only request the Scopes registered for it.
_Avoid_: Permission (reserved for Roles), Claim

**Consent**:
A User's recorded approval that one Application may receive a given set of Scopes on their behalf; the User can withdraw it.
_Avoid_: Authorization, Grant

**Application Schema**:
The set of Resource Types and Actions an Application declares; it is the same for every Tenant. Entries can be added or deprecated, but never removed.

**Deprecated**:
The state of a Resource Type or Action that can no longer be used in new Permissions; existing Permissions that use it remain but are flagged.
_Avoid_: Removed, Archived, Disabled

**Enablement**:
A Tenant's decision to use a given Application; a Tenant's Users can only reach Applications the Tenant has enabled.
_Avoid_: Subscription, Installation

**Resource Type**:
A kind of thing an Application protects, such as Document or Invoice.
_Avoid_: Subject, Entity, Model

**Action**:
Something a User can attempt on a Resource Type, such as read, approve or export.
_Avoid_: Operation, Verb, Permission

**Registered Resource**:
A specific resource instance that an Application has told Sentinel about, so that Sentinel can report and review who has access to it.
_Avoid_: Object, Asset

### Access rules

**Role Template**:
A default Role that an Application ships; it is copied into a Tenant when the Tenant enables the Application, and the copy is never synced afterwards.
_Avoid_: Default role, Preset, Built-in role

**Role**:
A named set of Permissions belonging to one Tenant and one Application.
_Avoid_: Group, Profile, Policy

**Permission**:
One rule inside a Role: an Action on a Resource Type that is either allowed or denied, optionally limited by a Condition.
_Avoid_: Rule, Grant, Privilege, Ability

**Condition**:
The part of a Permission that limits which resources it applies to, based on attributes of the resource and of the User.
_Avoid_: Filter, Constraint, Predicate

**Deny Rule**:
A Permission that forbids an Action; it always overrides any Permission that allows it.
_Avoid_: Block, Restriction

**Role Assignment**:
The giving of a Role to a Membership; it applies across the whole Tenant and may have an expiry time.
_Avoid_: Grant, Binding, User role

**Temporary Role Assignment**:
A Role Assignment with an expiry time, after which it becomes an Expired Role Assignment.
_Avoid_: Temporary permission, Time-bound access, JIT access

**Expired Role Assignment**:
A Temporary Role Assignment whose expiry time has passed; it gives no access but is kept for reports and Access Reviews.
_Avoid_: Deleted assignment, Lapsed, Inactive

### Compliance

**Access Check**:
A single question an Application asks Sentinel (may this User perform this Action on this resource?) and the allow or deny answer it receives.
_Avoid_: Authorization request, Decision, Query, Can-check

**Audit Log**:
The Tenant's permanent record of authentication events, administrative changes and every Access Check.
_Avoid_: Activity log, History, Event log

**Access Review**:
A campaign over one Tenant and one Application in which each Role Assignment is either certified or revoked; any assignment still undecided when the campaign closes is revoked automatically.
_Avoid_: Access certification, Recertification, Audit

**Security Alert**:
A record raised automatically when a fixed detection rule spots risky activity in a Tenant, shown to its Tenant Admins.
_Avoid_: Incident, Notification, Warning

**Certify**:
To confirm, during an Access Review, that a Role Assignment should stay.
_Avoid_: Approve, Attest
