# Phase 01 — Canva feasibility gate

**Status: blocked for API automation; no production change made.**

## Inspection

- Opened the supplied short link `https://canva.link/bgiepgr891xcw85`. It resolves to a Canva design titled **Sop Betea - Website** at design ID `DAHWLQBOc2A`.
- Created a separate Canva copy, titled **Bản sao của Sop Betea**, at [the test copy](https://www.canva.com/design/DAHXKISxANw/XDG3lljJ0k-IzFSFyBBLdQ/edit). The original design was not edited and neither design was published.
- The editor reports the copy is saved and has 8 pages. The inspected recipe page contains ordinary static text objects and 12oz/17oz/23oz size labels. No Autofill dataset/field configuration was visible in the inspected editor state.
- The source design footer states that the document belongs to UNI and prohibits copying, quoting, distributing, or using it without written permission. The copy remains unchanged. Confirm the owner’s right to adapt this design before any future edits or use as a template.
- Canva displays “Dùng thử miễn phí trong 30 ngày” and a Pro/Brand prompt. No trial was activated. This does not establish the account’s Autofill entitlement.

## What was not proven

- No Canva developer app/OAuth authorization was available in this workspace, so no API token was obtained and no Autofill dataset/job was created. Job status, `update_design`, and template field names are therefore unverified.
- The design copy has not been published. Because the final publish action belongs to the owner, the production employee URL cannot be proven to remain `https://canva.link/bgiepgr891xcw85` without the owner reviewing and publishing a test copy. Do not replace the employee URL automatically.
- The copy shows 23oz, while the owner-confirmed recipe mapping is L=22oz. That content needs owner verification before it is changed or republished.

## Gate result

Keep Canva sync/publish out of rollout until (1) the owner confirms written permission to adapt the source design, (2) the Canva account has usable API/OAuth and Autofill access without an unapproved paid trial, and (3) the owner can verify whether publishing preserves the employee URL. These gates do not prevent building the independent Betea cost engine or staff-safe SOP data model. The test copy link above is retained only for the owner’s review; it has not been edited.
