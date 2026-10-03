# Coworking contributions and the product branch

The full experience remains on `feature/coworking-lobby`. Smaller draft PRs on this fork form a dependency stack. They are review packages, not submissions to the original repository yet.

| Branch | PR base | Responsibility |
| --- | --- | --- |
| `upstream/lobby-foundation` | Fork `main` | Independent room/map, authenticated travel, standalone startup, voice lifecycle |
| `upstream/lobby-guests` | Foundation | Invitations, scoped social visits, HTTP/WS authorization, explicit public views |
| `upstream/lobby-social` | Guests | Exclusive desks, intentions/status, roster, quiet/talk audio, session moderation |
| `feature/coworking-lobby` | Fork `main` | Working product; integrates the stack and later product-specific features |

Each layer compiles and runs on its own. Public links arrive only with their complete permission boundary. The guest layer is the largest because every route, command and response path needs enforcement.

## Getting upstream feedback

Offer the foundation first, using the prepared [proposal](upstream-lobby-proposal.md). Establish maintainer interest before asking upstream to adopt the guest model or richer product roadmap. No proposal has been sent automatically.

Before submitting to the original repository, fetch its latest `main` and replay the relevant package onto it. These drafts use the fork's `main`, which differs from current upstream. They are not advertised as conflict-free upstream patches.

If upstream accepts only the foundation, the complete guest/coworking experience remains usable on the fork. Acceptance of every layer is not a dependency for evolving the product.

## Where new work starts

A reusable fix starts on its owning layer: map/arrival on foundation, revocation on guests, occupancy on social. Make and test it in a new worktree, then merge through the dependency chain:

```text
foundation -> guests -> social -> product
```

Review each draft against its immediate parent. Avoid implementing the same fix independently on several branches.

Product-specific work starts from the product branch in a dedicated feature module: session schedules, focus timers, host themes, office portals or discovery. Promote it into an upstream package once its behavior is stable and upstream wants it. Product-only commits stay out of the smaller packages.

## After an upstream layer is merged

Upstream may squash a package. Preserve backup refs for the old parent tips, then transplant only the child layer's commits onto the accepted upstream commit:

```sh
git fetch upstream
git rebase --onto upstream/main OLD_FOUNDATION_TIP upstream/lobby-guests
git rebase --onto upstream/lobby-guests OLD_GUEST_TIP upstream/lobby-social
```

Use dedicated worktrees, retain backup branches, push rewritten drafts with `--force-with-lease`, and retarget the child PR's base. Keep the product branch's history; merge the updated stack/upstream into it and resolve overlap there rather than rebasing every product feature for each review.

## Contributor contract

- A space owns presence/access; a map owns geometry/seats/zones; a project owns repositories/workers.
- Server and client resolve lobby geometry through `shared/lobby-map.ts`. Project map choices must not move lobby visitors or release their chairs.
- Register runtime features through the existing protocol, handler, state and lifecycle registries. Scenery belongs in `client/world/`; runtime features need an install function in `client/features/`.
- Public commands need an explicit guest allowlist entry. Responses need explicit policy and field selection in `server/guests/visibility.ts`; new message names are not automatically public.
- Preserve microphone intent: quiet/host restrictions compose with personal mute and push-to-talk. Host unmute never enables a microphone.
- Cover permission boundaries, transitions and cleanup, and check typecheck, build, size and the relevant browser flow.

Further roster UI extraction, a single seat-state service, indexed guest validation and broader collaborator capabilities can be separate PRs. Federation and replacement voice infrastructure remain later product work.
