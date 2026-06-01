# KeepTally Edge Case Summary for Business Review

Generated: 2026-06-01

## Plain-English Summary

KeepTally is being prepared for user testing as an inventory counting and warehouse support system. The most important goal is simple: when someone counts inventory, scans an item, or uses voice mode, the system should clearly show what happened, save the correct inventory change, and leave enough history for the business to trust the result.

The application is already stronger than the original prototype. It now has better login checks, stronger database checks, a test-ready VPS setup, a min/max stock model, expanded test inventory, OpenAI voice support, and faster TypeScript checks for development.

The next improvement area is traceability. Voice count mode should not only update the inventory number. It should also keep a clean record of the full count session: what the user said, what item was matched, whether the user confirmed it, whether it saved, and whether anything failed.

## What We Are Improving First

The first recommended upgrade is a voice count audit trail.

In business terms, this means every voice count session can become a small digital record showing:

- Who performed the count.
- Which location was counted.
- Which mode was used.
- Which item was heard.
- What quantity was heard.
- Whether the user confirmed or rejected the count.
- Whether the inventory was updated, verified, skipped, or failed.
- When the session started and ended.

This helps the business answer questions after the fact, such as:

- Did the operator actually confirm the count?
- Was the item matched correctly?
- Did the system save the count?
- Which items were skipped?
- Did the voice system fail, or did the inventory save fail?

## Why This Matters

For inventory and accounting, the final number is not always enough. The business also needs confidence in how that number was created.

Without a session trail, voice mode can update inventory, but management may not be able to fully review the steps that led to the change. With a session trail, KeepTally becomes easier to trust during audits, user testing, and future customer demos.

## Recommended Stabilization Priorities

1. Add durable voice count sessions and event history.
2. Show clearer voice diagnostics in the app so testers know whether OpenAI, browser audio, or fallback audio is being used.
3. Make all location lists come from the database so users do not see stale or mismatched location names.
4. Add public HTTPS smoke tests for login, voice, and core workflows.
5. Add stronger admin recovery protections so the last admin cannot be locked out.
6. Track AI usage and cost by customer once multiple users or accounts begin testing.
7. Add read-only agent summaries that can suggest reorder needs, data cleanup, and daily housekeeping.
8. Add short-lived caching only after measuring which database reads are repeated most often.

## Current Business Risk Level

The app is suitable for continued test-environment hardening, but it should not be treated as production-ready yet.

The biggest remaining risks are:

- Voice sessions need a durable audit trail.
- Testers need clearer feedback when audio, transcription, or saving fails.
- Location data should be fully database-driven.
- Admin recovery and public HTTPS workflow checks should be automated.
- AI cost tracking should exist before broad customer usage.

## Bottom Line

KeepTally is moving from a prototype into a structured test application. The next round of work is about trust: making sure every important workflow is visible, recoverable, auditable, and easy for a non-technical tester to understand.
