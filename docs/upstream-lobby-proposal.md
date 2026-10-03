# Proposed upstream contribution: an authenticated social lobby

I would like to contribute a small, permanent lobby with its own map, independent of repository floors.

The foundation adds a reserved `@lobby` space with human chairs through the existing world-builder registry, travel between lobby and projects while preserving their layouts, and `--lobby-only` startup that skips saved projects, clones and workers. It includes same-floor voice cleanup, composable mute restrictions, existing password/account authentication, hosting documentation and behavioral tests.

Public guest links, intentions, moderation, federation and discovery are outside this first package. Guest access and coworking behavior are separate draft layers on my fork; the richer product can continue there independently.

Would this foundation fit the direction of Agent Office? If so, I can rebase the focused package onto current upstream main and adapt its integration points before submitting it.

This is a prepared proposal, not a message already sent to upstream maintainers.
