# WhatsApp validation — 2026-09-12

Environment: signed-in WhatsApp Web, NodeLane Act MV3 extension, WA-JS 4.6.0.
All live message writes used the account's self-chat. An official WhatsApp
channel was temporarily followed to verify channel operations, then unfollowed.
No contact phone numbers, message IDs, private message bodies, or session data
are recorded here.

## Live coverage

| Area | Result |
| --- | --- |
| Account readiness | Authenticated and ready through MCP |
| Chat listing, details, search/history anchors | Live reads succeeded; LID returned by sends was used for subsequent message operations |
| Text send, edit, quote, forward | Live writes and message reads succeeded, including Chinese, emoji and newlines |
| Reaction add/remove and star/unstar | Initially returned uncertain results despite visible success; repaired and both directions verified |
| Archive/unarchive and pin/unpin | Both directions verified; original state restored |
| Chat mute/unmute | Missing derived property caused incorrect state; expiration-based projection repaired and verified |
| Mark unread | Missing acknowledgement count repaired; manual unread state verified |
| Clear manual unread | Final adapter verified with an explicit unread → read cycle; marker removed |
| Contact profile and group details/members | Read APIs succeeded; saved contacts and populated group membership were unavailable in this account |
| Communities, Status feeds and own Status | Empty cache responses verified; populated content and writes not tested |
| Channel directory search | Live results returned; directory did not expose pagination metadata, so hasMore remains unknown |
| Channel follow/unfollow and mute/unmute | Both directions verified; test follow removed |
| Channel details | Removed a call to an unexported WA-JS function; cached channel read verified |
| Channel history | No synced updates returned in this browser; not proof of full channel-history support |
| Local message deletion | Final adapter returned deleted=true; subsequent history confirmed cleanup |
| Self-chat revoke | WA-JS falsely reported success without removal; adapter now rejects self-chat revoke before writing |

## Repairs

- Observe resulting star and reaction state instead of treating an early return
  object as the final result. Reads expose only the account's own reaction.
- Derive mute state from expiration when `isMuted` is absent. Preserve unknown
  state rather than claiming a chat is unmuted.
- Read actual unread state after mutations, including the manual unread marker.
  The current native module has separate `markSeen` and `sendSeen` actions.
- Read channels through the public chat API: `ensureNewsletter` is internal to
  WA-JS and is not exported under `WPP.newsletter`.
- Confirm local deletion through the chat collection, since the global message
  store can retain deleted models. Allow bounded asynchronous state propagation.
- Require a revoked message tombstone before claiming revoke success; never
  trust WA-JS's unconditional `isRevoked` return flag alone.
- Mutations are sent once. Observations may poll; failed or uncertain writes are
  never automatically replayed.

The return-value behavior was checked against the pinned upstream implementations:
[starMessage](https://github.com/wppconnect-team/wa-js/blob/v4.6.0/src/chat/functions/starMessage.ts),
[markIsRead](https://github.com/wppconnect-team/wa-js/blob/v4.6.0/src/chat/functions/markIsRead.ts),
and [deleteMessage](https://github.com/wppconnect-team/wa-js/blob/v4.6.0/src/chat/functions/deleteMessage.ts).

## Automated coverage

- `npm run check`: TypeScript validation.
- `npm test`: 144 checks, including the WhatsApp regressions.
- `npx tsx --test tests/whatsapp.test.ts`: 27 dedicated regression checks.
- `npm run test:browser`: real Chromium, extension, stdio MCP, bootstrap and
  MAIN-world execution against synthetic website fixtures. Includes WhatsApp
  readiness, mute projection, delayed star state, and no replay on reconnect.
  The compact output revision also tests a 240-character preview, secret
  exclusion, inherited chat context, and exact continuation of 7000 characters.
- `git diff --check`: no whitespace errors.

These checks do not claim full live validation of group joining/creation,
participant administration, community mutations, contact saving/blocking,
Status publication/deletion, channel creation/publication, or revoke to another
person. Git publication and production release are outside this validation.

## Compact output revision

The adapter already used field allowlists, minified JSON, 10-item default pages,
240-character previews, and bounded output caching. The subsequent optimization
removes repeated generic URLs from list items (inherit `result.url`), and repeated
chat IDs from history items (inherit `result.chat_id`). Unique channel links,
full executable IDs, authors, timestamps, delivery acknowledgements, media
metadata, and explicit mutation results remain available. Omitted `unread` in
chat lists follows `unread_count != 0` when that count exists. Missing mute state
still means unknown, and is never collapsed into false.

History omits `starred=false` and `text_truncated=false`. Only `protocol` and
`e2e_notification` entries are hidden by default; `include_system=true` restores
them. Group changes, media, and revoked-message records remain visible. Filtering
may yield an empty page with `hasMore=true`: continue from `next_before`.

`message` supports `text_offset`/`next_text_offset` for exact long-text retrieval
beyond 6000 characters. Offsets are UTF-16 code units and generated boundaries
never split a surrogate pair. Metadata-only requests (`max_body_chars=0`) do not
produce a non-advancing continuation. Text is preserved verbatim, not rewritten
or summarized. About/description truncation is also explicitly indicated.

In a deterministic fixture of 10 short messages, serialized JSON shrank from
2265 to 1335 characters (41.1%) versus the previous compact adapter output.
This is a character measurement for that fixture, not a universal token saving.
The optimization was verified using unit and Chromium/MCP fixture tests; the
earlier live-account coverage above does not claim a live test of this revision.
