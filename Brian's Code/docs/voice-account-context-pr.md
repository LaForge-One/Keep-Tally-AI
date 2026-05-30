# Voice account context PR

## Summary

This PR scopes voice parsing item candidates to the active request account and allowed locations while preserving existing voice response shapes.

## Manual test cases

- Voice transcribe still returns `{ transcript }` for authorized voice users.
- Voice speak still returns an audio response for authorized voice users.
- Voice custom parse only includes active-account items in the AI prompt.
- Restricted users cannot voice-parse item candidates from unauthorized locations.
- Admin and `view_all_locations` users can voice-parse item candidates across account locations.
- Legacy rows with null `locationId` continue to work through string-location fallback.
- Existing parse response shapes remain unchanged.

## Notes

- No schema changes are included.
- No UI changes are included.
- Voice transcription and text-to-speech behavior are unchanged.
