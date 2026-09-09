# Measurement entry date (PWA 1.0.50 / Android test92)

The user explicitly confirmed that opening measurement from September 9 with a night
profile should select September 10; a day profile should keep September 9.

- Resolve this default once on entry from the calendar-selected date and work shift.
- Do not shift it a second time in the Android bridge.
- Preserve a manually edited measurement date across refreshes.
- Preserve the original date of already-active Android work when resuming it.
- The prior midnight-to-06:59 previous-date default is superseded by this request.

Date regression tests include both shifts, month/year boundaries, different clock hours,
and refresh after a manual date selection. This change does not migrate historical sales
dates or reinterpret existing work receipts.
