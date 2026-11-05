# bidwise design notes

The source is `bidwise-preview.html`: the final phone preview from the ChatGPT design session (share 6acf4e27…), in the "Focus" design.

## Screens
- **Sign in:**
  - The bidwise wordmark.
  - Work email and password fields.
  - A full-size Remember me checkbox and Forgot password.
  - Sign in, biometric sign-in, and Create account.
- **Overview:** replaced by Mobile App EH's dashboard (user decision). The reference's own layout was a pipeline hero, three stat tiles, and Upcoming Deadlines grouped Critical / Soon / Comfortable.
- **Tenders:**
  - A portal dropdown (one portal at a time, remembered; as in BM Pro, so lists stay small), then Organisations (left) | Tenders (right), search, and filter chips (Bookmarked, Closing ≤ 5d). There is no "All portals" view (user request, 2026-10-17). Archive uses the same dropdown.
  - Tenders are saved with a **star**. Organisations keep the **bookmark** icon.
- **Tender / Project detail:**
  - A compact details card, Add to Projects and the star, and the scope of work.
  - Then three document groups:
    1. **Ready for Bid**: a checklist where users can add items. Each item has an attach button. An attached item looks pressed and its box is ticked.
       A new project starts with an **empty** checklist, as in BM Pro. Tapping an attached item opens the file; its paperclip offers Open / Replace / Remove. Files attached on another device are marked "on another device".
    2. **Tender Docs**: the tender's files, corrigenda and pre-bid files. No checklist.
    3. **Docs for Preparation**: files the user adds.
- **Projects:** search, chips for All, Preparing and Submitted, and project cards with checklist progress.
- **Alerts:** Today and Earlier groups, an unread count, All / Unread, and Mark all read.
- **More:** follows BM Pro's More page as it is on the MacinCloud Mac (`~/bidmanager-web/Mobile App RN`, app 1.1.0 build 3), which is newer than the Windows copy. In the Mac's order:
  - Account card first, directly under the title (user request, 2026-10-16).
  - Sync & connection: Sync tenders (last sync), Connection check, **Archive**, Downloads.
  - Workspace: Export tenders (CSV), **Captcha** (red dot when one is waiting), App lock, **Push notifications**.
  - Clear local cache (confirmation sheet; nothing reloads until Sync tenders).
  - Appearance row, which opens a separate **Appearance** screen: theme, display (Solid / Liquid glass) and accent. This replaces BM Pro's inline Dark / Light / System control, at the user's request.
- **More's sub-screens:**
  - Archive: closed tenders, with Organisations / Tenders, search and a bookmarked-only star, most recently closed first.
  - Captcha: the waiting image, an answer field and Submit. The first valid answer wins, from the phone or the desktop.
  - Push notifications: background refresh status with Check now; Bookmarked organisations and Bookmarked tenders toggles; closing reminders 1, 2, 3 and 5 days before close.
  - Downloads: downloaded, downloading, waiting and failed files.
  - Export tenders (CSV): choose Bookmarked tenders, Tenders in projects, or Tenders of selected organisations (picked from every portal, with search, portal chips and an "Include closed tenders" switch).
- **Tab headers:** no wordmark or avatar row and no caption line; each tab opens straight on its title (user request).
- **Tab bar:** an icon-only floating island that spans the full width, with a slim margin.

## Tokens
- **Accents** are given as `[accent, tint, deep, wash, edge]`, light and dark. See `src/theme/tokens.ts`.

  | Accent | Light | Dark |
  |---|---|---|
  | Green (default) | #426932 | #c6e7a5 |
  | Indigo | #4f46c8 | #b1afff |
  | Orange | #b25615 (the reference's #b55816, nudged to reach 4.5:1 on the page) | #f3b781 |
  | Rose | #ad426c | #efa5c0 |
  | Mono | #22262d | #f3f4f6 |

  The reference's Purple and Teal were dropped at the user's request (2026-10-15). In More, accents are pill buttons with a colour dot; Mono's dot is split white and black along a diagonal.

- **Solid surfaces:**

  | | bg | card | ink | muted | line |
  |---|---|---|---|---|---|
  | Light | #f6f7f8 | #fff | #252a32 | #747d89 | #e3e6eb |
  | Dark | #1b1d22 | #272b32 | #eff1f5 | #a5aebb | #3b414b |

- **Glass:**
  - Light: background #eeebf5 with peach, lavender, orchid, apricot and periwinkle blobs; frosted white cards.
  - Dark: background #22212c with muted versions of the same blobs.
- **Urgency:**

  | | Light | Dark |
  |---|---|---|
  | Critical | #b94f53 | #f2989d |
  | Soon | #aa7a44 | #ddb17d |
  | Comfortable | #4b7f55 | #8bceaa |

- **Type:** Inter for text, Space Grotesk for headings and figures, IBM Plex Mono for IDs.
- **Logo:** the desktop app's icon (`Client UI/assets/icon.svg`): a navy gradient tile (#273352 to #0f1422) with three rising rounded bars (#5f719a, #8ca7d8, #3b6ce7 to #8db0ff) under a green (#10b981) tick badge. It is followed by the word "bidwise" in semibold. Matched to the desktop icon 2026-11-03; it replaced the slanted-slabs-on-black mark (2026-10-19), which had replaced the original "b." letter mark.
